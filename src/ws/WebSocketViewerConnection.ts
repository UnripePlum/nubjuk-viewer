// WebSocketViewerConnection — 실 ESP 연결용 transport.
// ViewerConnection 인터페이스 만족 (시그니처 잠금).
//
// 책임:
//   - 단일 WebSocket 연결 lifecycle (connecting / connected / reconnecting / rejected / disconnected)
//   - 백오프 1s → 2s → 5s → 10s (capped)
//   - subscribe 자동 송신 (connect 후)
//   - ping 10s 주기
//   - heartbeat 30s 누락 시 강제 disconnect → reconnect
//   - close 4xxx → rejected (재연결 X)
//   - tab visibility hidden → 백오프 일시 중지 / visible → 즉시 재시도
//   - schema/parse 실패 → onProtocolError
//   - dispose: 모든 timer + listener 정리
//
// DOM/global 의존성은 Options로 주입 가능 (테스트용).

import type {
  EspMessage,
  ViewerCommand,
} from "@/types/protocol";
import type {
  ConnectionState,
  ProtocolErrorEvent,
  Subscription,
  ViewerConnection,
} from "./ViewerConnection";

// ───── Options + 외부 의존성 주입 ─────

export type WsLike = {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open" | "close" | "message" | "error", handler: (ev: WsEvent) => void): void;
  removeEventListener(type: "open" | "close" | "message" | "error", handler: (ev: WsEvent) => void): void;
};

export interface WsEvent {
  data?: unknown;
  code?: number;
  reason?: string;
}

export type WsFactory = (url: string) => WsLike;

export interface VisibilityListener {
  isHidden(): boolean;
  subscribe(handler: () => void): () => void; // returns dispose
}

export interface WebSocketViewerConnectionOptions {
  factory?: WsFactory;
  pingIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  backoffSchedule?: number[];
  visibility?: VisibilityListener | null; // null → 비활성 (테스트용 / SSR)
  clientKind?: "web" | "unity";
  debug?: boolean;
}

const DEFAULT_PING_MS = 10_000;
const DEFAULT_HEARTBEAT_MS = 30_000;
const DEFAULT_BACKOFF: readonly number[] = [1_000, 2_000, 5_000, 10_000];
const REJECTED_CLOSE_CODE_MIN = 4000;

const defaultFactory: WsFactory = (url) => {
  if (typeof WebSocket === "undefined") {
    throw new Error("WebSocket global not available; pass options.factory in non-browser env");
  }
  return new WebSocket(url) as unknown as WsLike;
};

const browserVisibility: VisibilityListener = {
  isHidden() {
    if (typeof document === "undefined") return false;
    return document.visibilityState === "hidden";
  },
  subscribe(handler) {
    if (typeof document === "undefined") return () => {};
    const fn = () => handler();
    document.addEventListener("visibilitychange", fn);
    return () => document.removeEventListener("visibilitychange", fn);
  },
};

// ───── helpers ─────

type Handler<T> = (v: T) => void;
function createSubSet<T>() {
  const set = new Set<Handler<T>>();
  return {
    add(h: Handler<T>): Subscription {
      set.add(h);
      return { dispose: () => set.delete(h) };
    },
    emit(v: T) {
      set.forEach((h) => h(v));
    },
  };
}

const ESP_MESSAGE_TYPES = new Set<string>([
  "hello",
  "state",
  "intent",
  "motion_started",
  "motion_completed",
  "motion_failed",
  "error",
  "heartbeat",
]);

function validateEspMessage(raw: unknown): { ok: true; msg: EspMessage } | { ok: false; reason: string } {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "not an object" };
  const o = raw as Record<string, unknown>;
  if (o.v !== 1) return { ok: false, reason: `unexpected envelope version: ${String(o.v)}` };
  if (typeof o.type !== "string" || !ESP_MESSAGE_TYPES.has(o.type)) {
    return { ok: false, reason: `unknown message type: ${String(o.type)}` };
  }
  if (typeof o.ts_ms !== "number") return { ok: false, reason: "ts_ms not number" };
  if (typeof o.device_id !== "string") return { ok: false, reason: "device_id not string" };
  if (typeof o.boot_id !== "string") return { ok: false, reason: "boot_id not string" };
  if (!o.payload || typeof o.payload !== "object") return { ok: false, reason: "payload missing" };
  return { ok: true, msg: raw as EspMessage };
}

// ───── 구현 ─────

export class WebSocketViewerConnection implements ViewerConnection {
  private readonly factory: WsFactory;
  private readonly pingIntervalMs: number;
  private readonly heartbeatTimeoutMs: number;
  private readonly backoffSchedule: readonly number[];
  private readonly visibility: VisibilityListener | null;
  private readonly clientKind: "web" | "unity";
  private readonly debug: boolean;

  private state: ConnectionState = { kind: "idle" };
  private url: string | null = null;
  private ws: WsLike | null = null;

  private wantsConnected = false; // connect() ↔ disconnect() 의도 트래킹
  private backoffIdx = 0;

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private visibilityDispose: (() => void) | null = null;

  private readonly msgSubs = createSubSet<EspMessage>();
  private readonly connSubs = createSubSet<ConnectionState>();
  private readonly errSubs = createSubSet<ProtocolErrorEvent>();

  // 활성 ws에 attached된 핸들러 — close/dispose 시 detach
  private wsListeners: {
    open: (e: WsEvent) => void;
    close: (e: WsEvent) => void;
    message: (e: WsEvent) => void;
    error: (e: WsEvent) => void;
  } | null = null;

  constructor(opts: WebSocketViewerConnectionOptions = {}) {
    this.factory = opts.factory ?? defaultFactory;
    this.pingIntervalMs = opts.pingIntervalMs ?? DEFAULT_PING_MS;
    this.heartbeatTimeoutMs = opts.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_MS;
    this.backoffSchedule = opts.backoffSchedule ?? DEFAULT_BACKOFF;
    this.visibility = opts.visibility === null ? null : (opts.visibility ?? browserVisibility);
    this.clientKind = opts.clientKind ?? "web";
    this.debug = opts.debug ?? true;
  }

  // ───── ViewerConnection ─────

  async connect(url: string): Promise<void> {
    if (this.wantsConnected && this.url === url) {
      // 같은 url 재연결 요청 — 무시 (이미 진행 중)
      return;
    }
    this.url = url;
    this.wantsConnected = true;
    this.backoffIdx = 0;
    this.attachVisibility();
    this.openSocket();
  }

  disconnect(): void {
    this.wantsConnected = false;
    this.clearReconnect();
    this.clearPing();
    this.clearHeartbeat();
    this.detachVisibility();
    if (this.ws) {
      const ws = this.ws;
      this.detachWsListeners(ws);
      this.ws = null;
      try {
        ws.close(1000, "client_disconnect");
      } catch {
        // swallow
      }
    }
    this.setState({ kind: "disconnected", reason: "manual" });
  }

  getState(): ConnectionState {
    return this.state;
  }

  send(msg: ViewerCommand): void {
    if (!this.ws) return;
    if (this.state.kind !== "connected") return;
    try {
      this.ws.send(JSON.stringify(msg));
    } catch (e) {
      // 전송 실패는 protocol error로 분류 (UI 알림용)
      this.errSubs.emit({
        kind: "schema",
        message: `send failed: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  onMessage(handler: (msg: EspMessage) => void): Subscription {
    return this.msgSubs.add(handler);
  }
  onConnectionChange(handler: (s: ConnectionState) => void): Subscription {
    return this.connSubs.add(handler);
  }
  onProtocolError(handler: (e: ProtocolErrorEvent) => void): Subscription {
    return this.errSubs.add(handler);
  }

  // ───── internals ─────

  private setState(next: ConnectionState) {
    this.state = next;
    this.connSubs.emit(next);
  }

  private openSocket() {
    if (!this.url) return;
    if (this.visibility?.isHidden()) {
      // backgrounded — 새 연결 시도 보류 (visible 복귀 시 재시도)
      this.setState({ kind: "reconnecting", nextAttemptMs: 0, lastError: "tab_hidden" });
      return;
    }
    this.setState({ kind: "connecting", url: this.url });
    let ws: WsLike;
    try {
      ws = this.factory(this.url);
    } catch (e) {
      this.scheduleReconnect(`factory_error: ${String(e)}`);
      return;
    }
    this.ws = ws;
    this.attachWsListeners(ws);
  }

  private attachWsListeners(ws: WsLike) {
    const listeners = {
      open: (_: WsEvent) => this.onWsOpen(),
      message: (e: WsEvent) => this.onWsMessage(e),
      close: (e: WsEvent) => this.onWsClose(e),
      error: (_: WsEvent) => this.onWsError(),
    };
    this.wsListeners = listeners;
    ws.addEventListener("open", listeners.open);
    ws.addEventListener("message", listeners.message);
    ws.addEventListener("close", listeners.close);
    ws.addEventListener("error", listeners.error);
  }

  private detachWsListeners(ws: WsLike) {
    if (!this.wsListeners) return;
    ws.removeEventListener("open", this.wsListeners.open);
    ws.removeEventListener("message", this.wsListeners.message);
    ws.removeEventListener("close", this.wsListeners.close);
    ws.removeEventListener("error", this.wsListeners.error);
    this.wsListeners = null;
  }

  private onWsOpen() {
    if (!this.url) return;
    this.backoffIdx = 0;
    this.setState({
      kind: "connected",
      url: this.url,
      sessionStartTs: Date.now(),
    });
    // subscribe
    this.send({
      v: 1,
      type: "subscribe",
      payload: { client_kind: this.clientKind, debug: this.debug },
    });
    // ping
    this.pingTimer = setInterval(() => {
      if (this.state.kind === "connected") {
        this.send({ v: 1, type: "ping", payload: {} });
      }
    }, this.pingIntervalMs);
    // heartbeat watchdog (any incoming message resets)
    this.armHeartbeat();
  }

  private onWsMessage(ev: WsEvent) {
    const raw = ev.data;
    if (typeof raw !== "string") {
      this.errSubs.emit({
        kind: "parse",
        message: `non-string message data: ${typeof raw}`,
      });
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      this.errSubs.emit({
        kind: "parse",
        raw,
        message: `JSON parse: ${e instanceof Error ? e.message : String(e)}`,
      });
      return;
    }
    const v = validateEspMessage(parsed);
    if (!v.ok) {
      this.errSubs.emit({ kind: "schema", raw, message: v.reason });
      return;
    }
    // 메시지 도착 — heartbeat reset
    this.armHeartbeat();
    this.msgSubs.emit(v.msg);
  }

  private onWsClose(ev: WsEvent) {
    const code = ev.code ?? 1006;
    const reason = ev.reason ?? "";

    if (this.ws) this.detachWsListeners(this.ws);
    this.ws = null;
    this.clearPing();
    this.clearHeartbeat();

    if (!this.wantsConnected) {
      // disconnect()로 인한 close — 이미 disconnected state 셋됨
      return;
    }

    if (code >= REJECTED_CLOSE_CODE_MIN) {
      // 4xxx — 재연결 X
      this.setState({ kind: "rejected", reason: reason || `close_${code}` });
      return;
    }

    this.scheduleReconnect(`close_${code}`);
  }

  private onWsError() {
    // 별도 처리 X — close가 뒤따를 것 (1006 등)
  }

  private scheduleReconnect(lastError?: string) {
    const idx = Math.min(this.backoffIdx, this.backoffSchedule.length - 1);
    const delay = this.backoffSchedule[idx];
    this.backoffIdx++;

    this.setState({ kind: "reconnecting", nextAttemptMs: delay, lastError });

    if (this.visibility?.isHidden()) {
      // backgrounded — 일시 중지 (visible 복귀 시 즉시 재시도)
      return;
    }
    this.clearReconnect();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  private armHeartbeat() {
    this.clearHeartbeat();
    this.heartbeatTimer = setTimeout(() => {
      this.heartbeatTimer = null;
      // 30s 무메시지 → 강제 close → reconnect path 발동
      if (this.ws) {
        try {
          this.ws.close(4001, "heartbeat_timeout");
        } catch {
          // close 실패는 무시 — onWsClose가 안 불릴 수 있으므로 강제 trigger
        }
      }
    }, this.heartbeatTimeoutMs);
  }

  private clearReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private clearHeartbeat() {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private attachVisibility() {
    if (!this.visibility) return;
    if (this.visibilityDispose) return;
    this.visibilityDispose = this.visibility.subscribe(() => this.onVisibilityChange());
  }

  private detachVisibility() {
    if (this.visibilityDispose) {
      this.visibilityDispose();
      this.visibilityDispose = null;
    }
  }

  private onVisibilityChange() {
    if (!this.visibility) return;
    if (this.visibility.isHidden()) {
      // 백오프 일시 중지
      this.clearReconnect();
      return;
    }
    // visible — 즉시 재시도
    if (!this.wantsConnected) return;
    if (this.ws) return; // 이미 연결 중
    this.clearReconnect();
    this.openSocket();
  }
}

// 4xxx close code constants (mcu가 reject하는 시점에 보낼 코드)
export const CLOSE_CODES = {
  SINGLE_VIEWER_OCCUPIED: 4001,
  SCHEMA_MISMATCH: 4002,
  MANUAL_TRIGGER_DISABLED: 4003,
  HEARTBEAT_TIMEOUT: 4001, // viewer 측 자가 close 코드
} as const;
