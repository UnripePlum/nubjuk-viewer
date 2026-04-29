// MockViewerConnection — sequence-driven 구현체.
// ViewerConnection 인터페이스 만족 (시그니처 잠금 준수).
// 미리 녹음된 EspMessage 시퀀스를 시간 차로 흘려서 ESP를 시뮬레이션.
// manual_trigger 수신 시 진행 시퀀스 cancel + 해당 motion만 즉시 emit.

import { MOTION_REGISTRY } from "@/data/motion-registry";
import type { EspMessage, ViewerCommand } from "@/types/protocol";

// manual_trigger 시 raw text — 사용자가 "음성으로 명령한 것처럼" 한국어 표시.
const MANUAL_RAW_TEXT: Record<string, string> = {
  idle: "넙죽아 가만히",
  sit: "넙죽아 앉아",
  stand: "넙죽아 일어나",
  hand: "넙죽아 손",
  roll_left: "넙죽아 왼쪽으로 굴러",
  roll_right: "넙죽아 오른쪽으로 굴러",
  surprise: "넙죽아 깜짝",
};
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
    if (msg.type === "manual_trigger") {
      this.handleManualTrigger(msg.payload.intent);
    }
  }

  // manual_trigger 시뮬레이션 — 진행 시퀀스 cancel + 사용자 음성 명령처럼 *full cycle* emit.
  // listening → intent reveal (raw text + confidence) → state 전이 → motion → idle 복귀.
  private handleManualTrigger(intent: string): void {
    if (this.state.kind !== "connected") return;

    // 진행 중 motion이 있으면 *interrupt* — motion_failed(reason: precondition)로 controller cleanup.
    // 이걸 안 하면 이전 motion의 controller timer가 그대로 fire되어 잘못된 pose update 발생 (Codex P2).
    const prevCid = this.lastMotionStartedCid;
    this.stopSequence();
    this.opts = { ...this.opts, loop: false };

    const entry = MOTION_REGISTRY[intent as keyof typeof MOTION_REGISTRY];
    const duration = entry?.duration_ms ?? 1000;
    const bootId = this.lastEmittedBootId ?? "manual-boot";
    const cid = `manual_${Date.now().toString(36)}`;
    const D = "nubjuk-01";
    const rawText = MANUAL_RAW_TEXT[intent] ?? `넙죽아 ${intent}`;

    const schedule = (delay: number, fn: () => void) => {
      const t = setTimeout(fn, delay);
      this.timers.push(t);
    };

    // 이전 motion interrupt 신호 — voice cycle 시작 *전에* (먼저 fire되도록 첫 timer로 push).
    if (prevCid) {
      schedule(0, () =>
        this.emit({
          v: 1,
          type: "motion_failed",
          ts_ms: 0,
          device_id: D,
          boot_id: bootId,
          correlation_id: prevCid,
          payload: { reason: "precondition", details: "interrupted by manual_trigger" },
        }),
      );
    }

    // 0ms: idle → listening (voice visualizer 활성, waveform 시작)
    schedule(0, () =>
      this.emit({
        v: 1,
        type: "state",
        ts_ms: 0,
        device_id: D,
        boot_id: bootId,
        correlation_id: cid,
        payload: { from: "idle", to: "listening", reason: null },
      }),
    );

    // 700ms: intent recognized (raw_text + confidence reveal)
    schedule(700, () =>
      this.emit({
        v: 1,
        type: "intent",
        ts_ms: 700,
        device_id: D,
        boot_id: bootId,
        correlation_id: cid,
        payload: { intent: intent as never, slots: {}, confidence: 0.94, raw_text: rawText },
      }),
    );

    // 760ms: state listening → intent_recognized
    schedule(760, () =>
      this.emit({
        v: 1,
        type: "state",
        ts_ms: 760,
        device_id: D,
        boot_id: bootId,
        correlation_id: cid,
        payload: { from: "listening", to: "intent_recognized", reason: null },
      }),
    );

    // 830ms: state → validating
    schedule(830, () =>
      this.emit({
        v: 1,
        type: "state",
        ts_ms: 830,
        device_id: D,
        boot_id: bootId,
        correlation_id: cid,
        payload: { from: "intent_recognized", to: "validating", reason: null },
      }),
    );

    // 900ms: state → executing
    schedule(900, () =>
      this.emit({
        v: 1,
        type: "state",
        ts_ms: 900,
        device_id: D,
        boot_id: bootId,
        correlation_id: cid,
        payload: { from: "validating", to: "executing", reason: null },
      }),
    );

    // 950ms: motion_started
    schedule(950, () =>
      this.emit({
        v: 1,
        type: "motion_started",
        ts_ms: 950,
        device_id: D,
        boot_id: bootId,
        correlation_id: cid,
        payload: { intent: intent as never, expected_duration_ms: duration },
      }),
    );

    // 950 + duration: motion_completed
    schedule(950 + duration, () =>
      this.emit({
        v: 1,
        type: "motion_completed",
        ts_ms: 950 + duration,
        device_id: D,
        boot_id: bootId,
        correlation_id: cid,
        payload: { actual_duration_ms: duration },
      }),
    );

    // 1050 + duration: state executing → completed
    schedule(1050 + duration, () =>
      this.emit({
        v: 1,
        type: "state",
        ts_ms: 1050 + duration,
        device_id: D,
        boot_id: bootId,
        correlation_id: cid,
        payload: { from: "executing", to: "completed", reason: null },
      }),
    );

    // 1150 + duration: state completed → idle
    schedule(1150 + duration, () =>
      this.emit({
        v: 1,
        type: "state",
        ts_ms: 1150 + duration,
        device_id: D,
        boot_id: bootId,
        correlation_id: cid,
        payload: { from: "completed", to: "idle", reason: null },
      }),
    );
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
  private lastEmittedBootId: string | null = null;
  // 마지막 motion_started의 cid 추적 — manual_trigger interrupt 시 controller cleanup용.
  private lastMotionStartedCid: string | null = null;
  // version token — stopSequence 시 증가. 이미 fire 중인 setTimeout callback도 version 비교로 dead message 무효화.
  private sequenceVersion = 0;

  private setConnectionState(next: ConnectionState) {
    this.state = next;
    this.connSubs.emit(next);
  }

  private emit(msg: EspMessage) {
    this.lastEmittedBootId = msg.boot_id;
    if (msg.type === "motion_started") {
      this.lastMotionStartedCid = msg.correlation_id;
    } else if (
      (msg.type === "motion_completed" || msg.type === "motion_failed") &&
      msg.correlation_id === this.lastMotionStartedCid
    ) {
      this.lastMotionStartedCid = null;
    }
    this.msgSubs.emit(msg);
  }

  private startSequence() {
    if (this.steps.length === 0) return;
    const myVersion = this.sequenceVersion;
    this.steps.forEach((step) => {
      const t = setTimeout(() => {
        if (this.sequenceVersion !== myVersion) return;
        this.emit(step.msg);
      }, step.ts);
      this.timers.push(t);
    });
    if (this.opts.loop) {
      const lastTs = this.steps[this.steps.length - 1].ts;
      const t = setTimeout(() => {
        if (this.sequenceVersion !== myVersion) return;
        if (this.state.kind !== "connected") return;
        this.stopSequence();
        this.startSequence();
      }, lastTs + (this.opts.loopDelayMs ?? 2000));
      this.timers.push(t);
    }
  }

  private stopSequence() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.sequenceVersion++;
  }
}
