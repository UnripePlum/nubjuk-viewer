// ViewerStore regression tests — boot_id reset, hello session reset, motion event 라우팅.

import { describe, it, expect, beforeEach } from "vitest";
import { ViewerStore } from "./viewerStore";
import type { EspMessage, FsmState, IntentName } from "@/types/protocol";

const D = "test-dev";

function helloMsg(bootId: string, current_state: FsmState = "idle"): EspMessage {
  return {
    v: 1,
    type: "hello",
    ts_ms: 0,
    device_id: D,
    boot_id: bootId,
    payload: {
      fw_version: "test",
      schema_v: 1,
      current_state,
      capabilities: [],
      uptime_ms: 0,
    },
  };
}
function stateMsg(
  bootId: string,
  cid: string,
  from: FsmState,
  to: FsmState,
): EspMessage {
  return {
    v: 1,
    type: "state",
    ts_ms: 0,
    device_id: D,
    boot_id: bootId,
    correlation_id: cid,
    payload: { from, to, reason: null },
  };
}
function intentMsg(bootId: string, cid: string, intent: IntentName): EspMessage {
  return {
    v: 1,
    type: "intent",
    ts_ms: 0,
    device_id: D,
    boot_id: bootId,
    correlation_id: cid,
    payload: { intent, slots: {}, confidence: 0.9, raw_text: "test" },
  };
}

describe("ViewerStore", () => {
  let store: ViewerStore;

  beforeEach(() => {
    store = new ViewerStore();
  });

  it("hello first → bootId set + currentState mirror", () => {
    store.applyEspMessage(helloMsg("boot_a", "idle"));
    const s = store.getSnapshot();
    expect(s.bootId).toBe("boot_a");
    expect(s.currentState).toBe("idle");
  });

  it("hello bootId 변경 → 전체 reset (stateLog/lastIntent/activeMotion clear)", () => {
    store.applyEspMessage(helloMsg("boot_a"));
    store.applyEspMessage(stateMsg("boot_a", "cid_1", "idle", "listening"));
    store.applyEspMessage(intentMsg("boot_a", "cid_1", "sit"));
    store.applyMotionEvent({
      type: "started",
      correlationId: "cid_1",
      intent: "sit",
      expectedMs: 700,
    });

    expect(store.getSnapshot().stateLog).toHaveLength(1);
    expect(store.getSnapshot().lastIntent).not.toBeNull();
    expect(store.getSnapshot().activeMotion).not.toBeNull();

    // ESP 재부팅 — 새 boot_id
    store.applyEspMessage(helloMsg("boot_b", "idle"));
    const s = store.getSnapshot();
    expect(s.bootId).toBe("boot_b");
    expect(s.stateLog).toHaveLength(0);
    expect(s.lastIntent).toBeNull();
    expect(s.activeMotion).toBeNull();
    expect(s.motionStatus).toBeNull();
  });

  it("hello same bootId → session reset (stateLog/lastIntent clear, bootId 유지)", () => {
    store.applyEspMessage(helloMsg("boot_a"));
    store.applyEspMessage(stateMsg("boot_a", "cid_1", "idle", "listening"));
    store.applyEspMessage(intentMsg("boot_a", "cid_1", "sit"));

    store.applyEspMessage(helloMsg("boot_a")); // re-hello same boot
    const s = store.getSnapshot();
    expect(s.bootId).toBe("boot_a");
    expect(s.stateLog).toHaveLength(0);
    expect(s.lastIntent).toBeNull();
    expect(s.activeMotion).toBeNull();
  });

  it("applyMotionEvent started → activeMotion 설정 + status='started'", () => {
    store.applyMotionEvent({
      type: "started",
      correlationId: "cid_1",
      intent: "sit",
      expectedMs: 700,
    });
    const s = store.getSnapshot();
    expect(s.activeMotion).toMatchObject({
      name: "sit",
      durationMs: 700,
      correlationId: "cid_1",
    });
    expect(s.motionStatus).toBe("started");
  });

  it("applyMotionEvent completed (matching cid) → currentPose nextPose로 advance", () => {
    store.applyMotionEvent({
      type: "started",
      correlationId: "cid_1",
      intent: "sit",
      expectedMs: 700,
    });
    store.applyMotionEvent({
      type: "completed",
      correlationId: "cid_1",
      actualMs: 680,
    });
    const s = store.getSnapshot();
    expect(s.motionStatus).toBe("completed");
    expect(s.currentPose).toBe("sit"); // persistent → adopt
  });

  it("applyMotionEvent completed (mismatched cid) → no-op", () => {
    store.applyMotionEvent({
      type: "started",
      correlationId: "cid_1",
      intent: "sit",
      expectedMs: 700,
    });
    store.applyMotionEvent({
      type: "completed",
      correlationId: "cid_OTHER",
      actualMs: 700,
    });
    const s = store.getSnapshot();
    expect(s.motionStatus).toBe("started"); // unchanged
    expect(s.currentPose).toBe("idle"); // not advanced
  });

  it("applyMotionEvent failed (matching cid) → status='failed' + reason", () => {
    store.applyMotionEvent({
      type: "started",
      correlationId: "cid_1",
      intent: "sit",
      expectedMs: 700,
    });
    store.applyMotionEvent({
      type: "failed",
      correlationId: "cid_1",
      reason: "hardware",
    });
    const s = store.getSnapshot();
    expect(s.motionStatus).toBe("failed");
    expect(s.motionFailReason).toBe("hardware");
    expect(s.currentPose).toBe("idle"); // pose 유지 (실패 시 advance X)
  });

  it("applyMotionEvent cancelled when terminal → no-op (race guard)", () => {
    store.applyMotionEvent({
      type: "started",
      correlationId: "cid_1",
      intent: "sit",
      expectedMs: 700,
    });
    store.applyMotionEvent({
      type: "completed",
      correlationId: "cid_1",
      actualMs: 700,
    });
    expect(store.getSnapshot().motionStatus).toBe("completed");

    // 늦은 cancelled (예: stop()) → completed 덮어쓰지 않음
    store.applyMotionEvent({
      type: "cancelled",
      correlationId: "cid_1",
      reason: "stop_called",
    });
    expect(store.getSnapshot().motionStatus).toBe("completed");
  });

  it("recordProtocolError → count + recent (cyclic 8개)", () => {
    store.recordProtocolError("first");
    store.recordProtocolError("second");
    const s = store.getSnapshot();
    expect(s.protocolErrors.count).toBe(2);
    expect(s.protocolErrors.recent).toEqual(["first", "second"]);
  });

  it("disconnected → connection만 reset, history 유지", () => {
    store.applyEspMessage(helloMsg("boot_a"));
    store.applyEspMessage(stateMsg("boot_a", "cid_1", "idle", "listening"));
    expect(store.getSnapshot().stateLog).toHaveLength(1);

    store.setConnectionState({ kind: "disconnected", reason: "manual" });
    const s = store.getSnapshot();
    expect(s.connectionState).toMatchObject({ kind: "disconnected" });
    expect(s.bootId).toBe("boot_a"); // history 유지
    expect(s.stateLog).toHaveLength(1);
  });
});
