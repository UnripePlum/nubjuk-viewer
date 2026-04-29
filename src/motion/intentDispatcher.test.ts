// IntentDispatcher regression tests — stale cid 거부 + ESP-as-truth 라우팅 락인.

import { describe, it, expect, beforeEach } from "vitest";
import { IntentDispatcher } from "./intentDispatcher";
import { MockMotionController } from "@/controller/MockMotionController";
import { ViewerStore } from "@/store/viewerStore";
import type {
  ConnectionState,
  ProtocolErrorEvent,
  Subscription,
  ViewerConnection,
} from "@/ws/ViewerConnection";
import type { EspMessage, IntentName, MotionFailReason, ViewerCommand } from "@/types/protocol";

const D = "test-dev";
const BOOT = "test-boot";

function startedMsg(cid: string, intent: IntentName = "sit", expectedMs = 700): EspMessage {
  return {
    v: 1,
    type: "motion_started",
    ts_ms: 0,
    device_id: D,
    boot_id: BOOT,
    correlation_id: cid,
    payload: { intent, expected_duration_ms: expectedMs },
  };
}
function completedMsg(cid: string, actualMs = 700): EspMessage {
  return {
    v: 1,
    type: "motion_completed",
    ts_ms: 0,
    device_id: D,
    boot_id: BOOT,
    correlation_id: cid,
    payload: { actual_duration_ms: actualMs },
  };
}
function failedMsg(cid: string, reason: MotionFailReason = "timeout"): EspMessage {
  return {
    v: 1,
    type: "motion_failed",
    ts_ms: 0,
    device_id: D,
    boot_id: BOOT,
    correlation_id: cid,
    payload: { reason },
  };
}

class TestViewerConnection implements ViewerConnection {
  private msgs = new Set<(m: EspMessage) => void>();
  private conns = new Set<(s: ConnectionState) => void>();
  private errs = new Set<(e: ProtocolErrorEvent) => void>();

  push(msg: EspMessage) {
    this.msgs.forEach((h) => h(msg));
  }
  pushErr(err: ProtocolErrorEvent) {
    this.errs.forEach((h) => h(err));
  }

  async connect(): Promise<void> {}
  disconnect(): void {}
  getState(): ConnectionState {
    return { kind: "idle" };
  }
  send(_msg: ViewerCommand): void {}
  onMessage(h: (m: EspMessage) => void): Subscription {
    this.msgs.add(h);
    return { dispose: () => this.msgs.delete(h) };
  }
  onConnectionChange(h: (s: ConnectionState) => void): Subscription {
    this.conns.add(h);
    return { dispose: () => this.conns.delete(h) };
  }
  onProtocolError(h: (e: ProtocolErrorEvent) => void): Subscription {
    this.errs.add(h);
    return { dispose: () => this.errs.delete(h) };
  }
}

describe("IntentDispatcher", () => {
  let conn: TestViewerConnection;
  let motion: MockMotionController;
  let store: ViewerStore;
  let dispatcher: IntentDispatcher;

  beforeEach(() => {
    conn = new TestViewerConnection();
    motion = new MockMotionController();
    store = new ViewerStore();
    dispatcher = new IntentDispatcher(conn, motion, store);
  });

  it("motion_started → motion.play emits started", () => {
    conn.push(startedMsg("cid_1", "sit", 700));
    const evs = motion.getEvents();
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({
      type: "started",
      correlationId: "cid_1",
      intent: "sit",
      expectedMs: 700,
    });
  });

  it("motion_completed (matching cid) → motion.settle({completed})", () => {
    conn.push(startedMsg("cid_1"));
    conn.push(completedMsg("cid_1", 680));
    const evs = motion.getEvents();
    expect(evs).toHaveLength(2);
    expect(evs[1]).toMatchObject({
      type: "completed",
      correlationId: "cid_1",
      actualMs: 680,
    });
  });

  it("motion_completed stale cid → recordProtocolError, settle 호출 X (직접 검증)", () => {
    conn.push(startedMsg("cid_1"));
    conn.push(completedMsg("cid_OTHER", 700));
    // P2 fix: getSettleCalls()로 settle 호출 *시도 자체*가 없었음을 검증
    expect(motion.getSettleCalls()).toHaveLength(0);
    expect(motion.getEvents()).toHaveLength(1);
    expect(motion.getEvents()[0]).toMatchObject({ type: "started", correlationId: "cid_1" });
    const s = store.getSnapshot();
    expect(s.protocolErrors.count).toBe(1);
    expect(s.protocolErrors.recent[0]).toContain("stale motion_completed");
    expect(s.protocolErrors.recent[0]).toContain("cid_OTHER");
  });

  it("motion_failed (matching cid) → motion.settle({failed, reason})", () => {
    conn.push(startedMsg("cid_1"));
    conn.push(failedMsg("cid_1", "hardware"));
    const evs = motion.getEvents();
    expect(evs).toHaveLength(2);
    expect(evs[1]).toMatchObject({
      type: "failed",
      correlationId: "cid_1",
      reason: "hardware",
    });
  });

  it("motion_failed stale cid → recordProtocolError, settle 호출 X (직접 검증)", () => {
    conn.push(startedMsg("cid_1"));
    conn.push(failedMsg("cid_OTHER", "timeout"));
    // P2 fix: settle 호출 자체가 없었음을 직접 검증
    expect(motion.getSettleCalls()).toHaveLength(0);
    expect(motion.getEvents()).toHaveLength(1);
    expect(motion.getEvents()[0]).toMatchObject({ type: "started", correlationId: "cid_1" });
    const s = store.getSnapshot();
    expect(s.protocolErrors.count).toBe(1);
    expect(s.protocolErrors.recent[0]).toContain("stale motion_failed");
  });

  it("motion_completed before any motion_started → settle no-op (active=null), 에러 X", () => {
    // currentCid가 null인 상태 — stale 검증은 currentCid &&로 가드되어 통과 → settle
    // settle도 active=null이라 no-op. 에러 기록 없음. (설계상 OK — 없는 motion 종료는 무시)
    conn.push(completedMsg("cid_1", 700));
    expect(motion.getEvents()).toHaveLength(0);
    expect(store.getSnapshot().protocolErrors.count).toBe(0);
  });

  it("conn protocol error → store.recordProtocolError", () => {
    conn.pushErr({ kind: "schema", message: "bad envelope" });
    const s = store.getSnapshot();
    expect(s.protocolErrors.count).toBe(1);
    expect(s.protocolErrors.recent[0]).toContain("[schema]");
    expect(s.protocolErrors.recent[0]).toContain("bad envelope");
  });

  it("dispose() unsubscribes all subs — 후속 메시지 처리 안 함", () => {
    dispatcher.dispose();
    conn.push(startedMsg("cid_1"));
    expect(motion.getEvents()).toHaveLength(0);
  });
});
