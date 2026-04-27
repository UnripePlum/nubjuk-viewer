// MockViewerConnection — sequence-driven 구현체.
// ViewerConnection 인터페이스 만족 (시그니처 잠금 준수).
// 미리 녹음된 EspMessage 시퀀스를 시간 차로 흘려서 ESP를 시뮬레이션.

import type { EspMessage, ViewerCommand } from "@/types/protocol";
import type {
  ConnectionState,
  ProtocolErrorEvent,
  Subscription,
  ViewerConnection,
} from "./ViewerConnection";

export interface MockSequenceStep {
  ts: number;
  msg: EspMessage;
}

type Handler<T> = (v: T) => void;

function createSubSet<T>() {
  const set = new Set<Handler<T>>();
  return {
    add(handler: Handler<T>): Subscription {
      set.add(handler);
      return {
        dispose() {
          set.delete(handler);
        },
      };
    },
    emit(value: T) {
      set.forEach((h) => h(value));
    },
  };
}

export interface SequenceOptions {
  loop?: boolean;
  loopDelayMs?: number;
}

export class MockViewerConnection implements ViewerConnection {
  private steps: MockSequenceStep[] = [];
  private opts: SequenceOptions = { loop: true, loopDelayMs: 2000 };
  private state: ConnectionState = { kind: "idle" };
  private timers: ReturnType<typeof setTimeout>[] = [];
  private msgSubs = createSubSet<EspMessage>();
  private connSubs = createSubSet<ConnectionState>();
  private errSubs = createSubSet<ProtocolErrorEvent>();
  private sentCommands: ViewerCommand[] = [];

  constructor(steps: MockSequenceStep[] = [], opts: SequenceOptions = {}) {
    this.steps = steps;
    this.opts = { loop: true, loopDelayMs: 2000, ...opts };
  }

  // 시퀀스 교체 — 연결 중이면 stop & restart.
  loadSequence(steps: MockSequenceStep[], opts?: SequenceOptions): void {
    this.steps = steps;
    if (opts) this.opts = { loop: true, loopDelayMs: 2000, ...opts };
    if (this.state.kind === "connected") {
      this.stopSequence();
      this.startSequence();
    }
  }

  getSentCommands(): readonly ViewerCommand[] {
    return this.sentCommands;
  }

  // ───── ViewerConnection 인터페이스 ─────
  async connect(url: string): Promise<void> {
    this.setConnectionState({ kind: "connecting", url });
    // 다음 microtask에 connected (Mock이라 즉시)
    await Promise.resolve();
    this.setConnectionState({
      kind: "connected",
      url,
      sessionStartTs: Date.now(),
    });
    this.startSequence();
  }

  disconnect(): void {
    this.stopSequence();
    this.setConnectionState({ kind: "disconnected", reason: "manual" });
  }

  getState(): ConnectionState {
    return this.state;
  }

  send(msg: ViewerCommand): void {
    this.sentCommands.push(msg);
  }

  onMessage(handler: (msg: EspMessage) => void): Subscription {
    return this.msgSubs.add(handler);
  }

  onConnectionChange(handler: (state: ConnectionState) => void): Subscription {
    return this.connSubs.add(handler);
  }

  onProtocolError(handler: (err: ProtocolErrorEvent) => void): Subscription {
    return this.errSubs.add(handler);
  }

  // ───── internals ─────
  private setConnectionState(next: ConnectionState) {
    this.state = next;
    this.connSubs.emit(next);
  }

  private startSequence() {
    if (this.steps.length === 0) return;
    this.steps.forEach((step) => {
      const t = setTimeout(() => this.msgSubs.emit(step.msg), step.ts);
      this.timers.push(t);
    });
    if (this.opts.loop) {
      const lastTs = this.steps[this.steps.length - 1].ts;
      const t = setTimeout(
        () => {
          if (this.state.kind !== "connected") return;
          this.stopSequence();
          this.startSequence();
        },
        lastTs + (this.opts.loopDelayMs ?? 2000),
      );
      this.timers.push(t);
    }
  }

  private stopSequence() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }
}
