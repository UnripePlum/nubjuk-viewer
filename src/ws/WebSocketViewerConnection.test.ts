// WebSocketViewerConnection regression tests.
// 핵심: lifecycle / 백오프 / heartbeat / visibility / schema 검증 / dispose 정리.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  WebSocketViewerConnection,
  type VisibilityListener,
  type WsEvent,
  type WsLike,
} from "./WebSocketViewerConnection";
import type { ConnectionState, ProtocolErrorEvent } from "./ViewerConnection";
import type { EspMessage } from "@/types/protocol";

// ───── TestWebSocket — minimal WsLike impl ─────

type EvType = "open" | "close" | "message" | "error";

class TestWebSocket implements WsLike {
  static instances: TestWebSocket[] = [];
  static last(): TestWebSocket {
    return TestWebSocket.instances[TestWebSocket.instances.length - 1];
  }
  static reset() {
    TestWebSocket.instances = [];
  }

  url: string;
  readyState = 0; // CONNECTING
  sent: string[] = [];
  closeCalls: { code?: number; reason?: string }[] = [];

  private listeners: Record<EvType, Set<(e: WsEvent) => void>> = {
    open: new Set(),
    close: new Set(),
    message: new Set(),
    error: new Set(),
  };

  constructor(url: string) {
    this.url = url;
    TestWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  // 실 브라우저처럼 close()는 close event를 fire (synchronous로 단순화).
  close(code?: number, reason?: string): void {
    if (this.readyState === 3) return;
    this.closeCalls.push({ code, reason });
    this.readyState = 3;
    this.fire("close", { code: code ?? 1000, reason: reason ?? "" });
  }

  addEventListener(t: EvType, h: (e: WsEvent) => void): void {
    this.listeners[t].add(h);
  }
  removeEventListener(t: EvType, h: (e: WsEvent) => void): void {
    this.listeners[t].delete(h);
  }

  // ── test helpers ──
  simulateOpen() {
    this.readyState = 1;
    this.fire("open", {});
  }
  simulateMessage(data: string) {
    this.fire("message", { data });
  }
  simulateClose(code = 1006, reason = "") {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.fire("close", { code, reason });
  }
  simulateError() {
    this.fire("error", {});
  }

  private fire(t: EvType, ev: WsEvent) {
    // copy to avoid mid-iter mutation
    [...this.listeners[t]].forEach((h) => h(ev));
  }
}

class TestVisibility implements VisibilityListener {
  private hidden = false;
  private handlers = new Set<() => void>();
  setHidden(v: boolean) {
    this.hidden = v;
  }
  fire() {
    [...this.handlers].forEach((h) => h());
  }
  isHidden() {
    return this.hidden;
  }
  subscribe(h: () => void) {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }
}

// ───── helpers ─────

const D = "test-dev";
const BOOT = "test-boot";

function helloJson(): string {
  return JSON.stringify({
    v: 1,
    type: "hello",
    ts_ms: 0,
    device_id: D,
    boot_id: BOOT,
    payload: {
      fw_version: "test",
      schema_v: 1,
      current_state: "idle",
      capabilities: [],
      uptime_ms: 0,
    },
  });
}

// ───── tests ─────

describe("WebSocketViewerConnection", () => {
  let conn: WebSocketViewerConnection;
  let visibility: TestVisibility;
  const URL_X = "ws://test/viewer";

  beforeEach(() => {
    vi.useFakeTimers();
    TestWebSocket.reset();
    visibility = new TestVisibility();
    conn = new WebSocketViewerConnection({
      factory: (url) => new TestWebSocket(url),
      pingIntervalMs: 1000,
      heartbeatTimeoutMs: 5000,
      backoffSchedule: [100, 200, 500, 1000],
      visibility,
    });
  });

  afterEach(() => {
    conn.disconnect();
    vi.useRealTimers();
  });

  it("connect → connecting state, ws 생성", async () => {
    const states: ConnectionState[] = [];
    conn.onConnectionChange((s) => states.push(s));
    await conn.connect(URL_X);
    expect(states).toEqual([{ kind: "connecting", url: URL_X }]);
    expect(TestWebSocket.instances).toHaveLength(1);
    expect(TestWebSocket.last().url).toBe(URL_X);
  });

  it("ws open → connected + subscribe 자동 송신", async () => {
    await conn.connect(URL_X);
    TestWebSocket.last().simulateOpen();
    expect(conn.getState().kind).toBe("connected");
    expect(TestWebSocket.last().sent).toHaveLength(1);
    const subscribe = JSON.parse(TestWebSocket.last().sent[0]);
    expect(subscribe).toMatchObject({
      v: 1,
      type: "subscribe",
      payload: { client_kind: "web", debug: true },
    });
  });

  it("ping interval (10s default → 1s for test) → 주기적으로 ping 송신", async () => {
    await conn.connect(URL_X);
    const ws = TestWebSocket.last();
    ws.simulateOpen();
    expect(ws.sent).toHaveLength(1); // subscribe
    vi.advanceTimersByTime(1000);
    expect(ws.sent).toHaveLength(2);
    expect(JSON.parse(ws.sent[1])).toMatchObject({ type: "ping" });
    vi.advanceTimersByTime(1000);
    expect(ws.sent).toHaveLength(3);
  });

  it("heartbeat 30s (5s for test) 무메시지 → ws 강제 close(4001)", async () => {
    await conn.connect(URL_X);
    const ws = TestWebSocket.last();
    ws.simulateOpen();
    vi.advanceTimersByTime(5000);
    expect(ws.closeCalls.some((c) => c.reason === "heartbeat_timeout")).toBe(true);
  });

  it("incoming 메시지 → heartbeat reset", async () => {
    await conn.connect(URL_X);
    const ws = TestWebSocket.last();
    ws.simulateOpen();
    vi.advanceTimersByTime(4000);
    ws.simulateMessage(helloJson());
    vi.advanceTimersByTime(4000);
    // 8s 경과지만 last message 후 4s — heartbeat fire 안 됨
    expect(ws.closeCalls.filter((c) => c.reason === "heartbeat_timeout")).toHaveLength(0);
  });

  it("parse 실패 → onProtocolError(parse)", async () => {
    const errors: ProtocolErrorEvent[] = [];
    conn.onProtocolError((e) => errors.push(e));
    await conn.connect(URL_X);
    const ws = TestWebSocket.last();
    ws.simulateOpen();
    ws.simulateMessage("not valid json{{{");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ kind: "parse" });
  });

  it("schema 위반 (unknown type) → onProtocolError(schema)", async () => {
    const errors: ProtocolErrorEvent[] = [];
    conn.onProtocolError((e) => errors.push(e));
    await conn.connect(URL_X);
    const ws = TestWebSocket.last();
    ws.simulateOpen();
    ws.simulateMessage(
      JSON.stringify({
        v: 1,
        type: "unknown_type",
        ts_ms: 0,
        device_id: D,
        boot_id: BOOT,
        payload: {},
      }),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ kind: "schema" });
    expect(errors[0].message).toContain("unknown_type");
  });

  it("envelope version 위반 → onProtocolError(schema)", async () => {
    const errors: ProtocolErrorEvent[] = [];
    conn.onProtocolError((e) => errors.push(e));
    await conn.connect(URL_X);
    TestWebSocket.last().simulateOpen();
    TestWebSocket.last().simulateMessage(
      JSON.stringify({ v: 2, type: "hello", ts_ms: 0, device_id: D, boot_id: BOOT, payload: {} }),
    );
    expect(errors[0].kind).toBe("schema");
  });

  it("valid message → onMessage", async () => {
    const msgs: EspMessage[] = [];
    conn.onMessage((m) => msgs.push(m));
    await conn.connect(URL_X);
    TestWebSocket.last().simulateOpen();
    TestWebSocket.last().simulateMessage(helloJson());
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ type: "hello", boot_id: BOOT });
  });

  it("close 1006 → reconnecting → backoff 후 reopen", async () => {
    await conn.connect(URL_X);
    TestWebSocket.last().simulateOpen();
    TestWebSocket.last().simulateClose(1006);
    expect(conn.getState()).toMatchObject({ kind: "reconnecting", nextAttemptMs: 100 });
    vi.advanceTimersByTime(100);
    expect(TestWebSocket.instances).toHaveLength(2);
    expect(conn.getState().kind).toBe("connecting");
  });

  it("backoff schedule 100/200/500/1000 (capped) — 연속 실패 (open 없이)", async () => {
    await conn.connect(URL_X);
    const expected = [100, 200, 500, 1000, 1000, 1000];
    for (let i = 0; i < expected.length; i++) {
      // open 없이 곧바로 close 1006 (connection refused 시나리오)
      TestWebSocket.last().simulateClose(1006);
      const s = conn.getState();
      expect(s.kind).toBe("reconnecting");
      if (s.kind === "reconnecting") {
        expect(s.nextAttemptMs).toBe(expected[i]);
      }
      vi.advanceTimersByTime(expected[i]);
    }
  });

  it("open 성공 → backoff reset, 이후 close → backoff 처음(100)부터", async () => {
    await conn.connect(URL_X);
    // 두 번 실패해서 backoff index 진행
    TestWebSocket.last().simulateClose(1006);
    vi.advanceTimersByTime(100);
    TestWebSocket.last().simulateClose(1006);
    vi.advanceTimersByTime(200);
    // 다음 시도에서 open 성공
    TestWebSocket.last().simulateOpen();
    expect(conn.getState().kind).toBe("connected");
    // 이후 close → backoff index 리셋되어 100부터
    TestWebSocket.last().simulateClose(1006);
    expect(conn.getState()).toMatchObject({ kind: "reconnecting", nextAttemptMs: 100 });
  });

  it("close 4xxx → rejected, 재연결 X", async () => {
    await conn.connect(URL_X);
    TestWebSocket.last().simulateOpen();
    TestWebSocket.last().simulateClose(4002, "schema_mismatch");
    expect(conn.getState()).toMatchObject({ kind: "rejected" });
    vi.advanceTimersByTime(10_000);
    expect(TestWebSocket.instances).toHaveLength(1);
  });

  it("disconnect → ws.close(1000), state=disconnected, 재연결 X", async () => {
    await conn.connect(URL_X);
    const ws = TestWebSocket.last();
    ws.simulateOpen();
    conn.disconnect();
    expect(ws.closeCalls.some((c) => c.code === 1000)).toBe(true);
    expect(conn.getState()).toMatchObject({ kind: "disconnected", reason: "manual" });
    vi.advanceTimersByTime(10_000);
    expect(TestWebSocket.instances).toHaveLength(1);
  });

  it("disconnect 후 timer 모두 정리 (ping/heartbeat fire 안 함)", async () => {
    await conn.connect(URL_X);
    const ws = TestWebSocket.last();
    ws.simulateOpen();
    const sentBefore = ws.sent.length;
    conn.disconnect();
    vi.advanceTimersByTime(10_000);
    expect(ws.sent.length).toBe(sentBefore); // ping 안 감
  });

  it("visibility hidden → 백오프 timer 일시 중지 (reopen X)", async () => {
    await conn.connect(URL_X);
    TestWebSocket.last().simulateOpen();
    TestWebSocket.last().simulateClose(1006);
    expect(conn.getState().kind).toBe("reconnecting");
    visibility.setHidden(true);
    visibility.fire();
    vi.advanceTimersByTime(10_000);
    expect(TestWebSocket.instances).toHaveLength(1); // reopen 안 함
  });

  it("visibility visible 복귀 → 즉시 재시도", async () => {
    await conn.connect(URL_X);
    TestWebSocket.last().simulateOpen();
    TestWebSocket.last().simulateClose(1006);
    visibility.setHidden(true);
    visibility.fire();
    vi.advanceTimersByTime(10_000);
    expect(TestWebSocket.instances).toHaveLength(1);
    visibility.setHidden(false);
    visibility.fire();
    expect(TestWebSocket.instances).toHaveLength(2); // 즉시 reopen
  });

  it("subscribe handler → dispose 후 더 이상 호출 안 됨", async () => {
    let count = 0;
    const sub = conn.onConnectionChange(() => count++);
    await conn.connect(URL_X);
    expect(count).toBe(1); // connecting state
    sub.dispose();
    TestWebSocket.last().simulateOpen();
    expect(count).toBe(1); // connected state는 안 받음
  });

  it("send while not connected → no-op (실 ws.send 호출 X)", async () => {
    conn.send({ v: 1, type: "ping", payload: {} });
    expect(TestWebSocket.instances).toHaveLength(0);
  });

  it("multi-handler — 각 Subscription 독립 dispose", async () => {
    const a: ConnectionState[] = [];
    const b: ConnectionState[] = [];
    const subA = conn.onConnectionChange((s) => a.push(s));
    conn.onConnectionChange((s) => b.push(s));
    await conn.connect(URL_X);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    subA.dispose();
    TestWebSocket.last().simulateOpen();
    expect(a).toHaveLength(1); // dispose됨
    expect(b).toHaveLength(2); // 살아있음
  });
});
