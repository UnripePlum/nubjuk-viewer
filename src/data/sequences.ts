// Mock 시퀀스 — 자세 전환 + reject + fail + boot reset + stale 거부 데모.
// 모든 step은 protocol-faithful EspMessage. MockViewerConnection이 그대로 push.

import type {
  EspMessage,
  ErrorCode,
  FsmState,
  HelloMessage,
  HeartbeatMessage,
  IntentMessage,
  IntentName,
  MotionCompletedMessage,
  MotionFailReason,
  MotionFailedMessage,
  MotionStartedMessage,
  RejectReason,
  StateMessage,
  ErrorMessage,
} from "@/types/protocol";
import type { MockSequenceStep } from "@/ws/MockViewerConnection";

const D = "nubjuk-01";
const FW = "0.1.0-mock";

const mk = {
  hello: (ts: number, bootId: string, current_state: FsmState = "idle"): HelloMessage => ({
    v: 1,
    type: "hello",
    ts_ms: ts,
    device_id: D,
    boot_id: bootId,
    payload: {
      fw_version: FW,
      schema_v: 1,
      current_state,
      capabilities: ["debug", "manual_trigger"],
      uptime_ms: ts,
    },
  }),
  state: (
    ts: number,
    bootId: string,
    cid: string,
    from: FsmState,
    to: FsmState,
    reason: RejectReason | MotionFailReason | null = null,
  ): StateMessage => ({
    v: 1,
    type: "state",
    ts_ms: ts,
    device_id: D,
    boot_id: bootId,
    correlation_id: cid,
    payload: { from, to, reason },
  }),
  intent: (
    ts: number,
    bootId: string,
    cid: string,
    intent: IntentName,
    confidence: number,
    raw_text: string | null = null,
  ): IntentMessage => ({
    v: 1,
    type: "intent",
    ts_ms: ts,
    device_id: D,
    boot_id: bootId,
    correlation_id: cid,
    payload: { intent, slots: {}, confidence, raw_text },
  }),
  motionStarted: (
    ts: number,
    bootId: string,
    cid: string,
    intent: IntentName,
    expected_duration_ms: number,
  ): MotionStartedMessage => ({
    v: 1,
    type: "motion_started",
    ts_ms: ts,
    device_id: D,
    boot_id: bootId,
    correlation_id: cid,
    payload: { intent, expected_duration_ms },
  }),
  motionCompleted: (
    ts: number,
    bootId: string,
    cid: string,
    actual_duration_ms: number,
  ): MotionCompletedMessage => ({
    v: 1,
    type: "motion_completed",
    ts_ms: ts,
    device_id: D,
    boot_id: bootId,
    correlation_id: cid,
    payload: { actual_duration_ms },
  }),
  motionFailed: (
    ts: number,
    bootId: string,
    cid: string,
    reason: MotionFailReason,
    details?: string,
  ): MotionFailedMessage => ({
    v: 1,
    type: "motion_failed",
    ts_ms: ts,
    device_id: D,
    boot_id: bootId,
    correlation_id: cid,
    payload: details ? { reason, details } : { reason },
  }),
  error: (ts: number, bootId: string, code: ErrorCode, message: string): ErrorMessage => ({
    v: 1,
    type: "error",
    ts_ms: ts,
    device_id: D,
    boot_id: bootId,
    payload: { code, message },
  }),
  heartbeat: (
    ts: number,
    bootId: string,
    current_state: FsmState = "idle",
  ): HeartbeatMessage => ({
    v: 1,
    type: "heartbeat",
    ts_ms: ts,
    device_id: D,
    boot_id: bootId,
    payload: { uptime_ms: ts, free_heap: 152480, current_state },
  }),
};

const step = (ts: number, msg: EspMessage): MockSequenceStep => ({ ts, msg });

// ─────────────────────────────────────────────
// 1) sit-success: sit → surprise → stand 자세 전환 데모
// ─────────────────────────────────────────────
const BOOT_A = "01J9ZBOOT0001AAAAA";

const SEQ_SIT_SUCCESS: MockSequenceStep[] = [
  step(0,    mk.hello(0, BOOT_A, "idle")),

  // 1) 앉기
  step(1500, mk.state(1500, BOOT_A, "cid_a01", "idle", "listening")),
  step(3200, mk.intent(3200, BOOT_A, "cid_a01", "sit", 0.92, "넙죽아 앉아")),
  step(3300, mk.state(3300, BOOT_A, "cid_a01", "listening", "intent_recognized")),
  step(3380, mk.state(3380, BOOT_A, "cid_a01", "intent_recognized", "validating")),
  step(3450, mk.state(3450, BOOT_A, "cid_a01", "validating", "executing")),
  step(3500, mk.motionStarted(3500, BOOT_A, "cid_a01", "sit", 700)),
  step(4200, mk.motionCompleted(4200, BOOT_A, "cid_a01", 700)),
  step(4300, mk.state(4300, BOOT_A, "cid_a01", "executing", "completed")),
  step(4400, mk.state(4400, BOOT_A, "cid_a01", "completed", "idle")),

  // 2) 앉은 상태에서 surprise (transient — 끝나면 sit pose 유지)
  step(6500, mk.state(6500, BOOT_A, "cid_a02", "idle", "listening")),
  step(8200, mk.intent(8200, BOOT_A, "cid_a02", "surprise", 0.86, "넙죽아 깜짝")),
  step(8300, mk.state(8300, BOOT_A, "cid_a02", "listening", "intent_recognized")),
  step(8380, mk.state(8380, BOOT_A, "cid_a02", "intent_recognized", "validating")),
  step(8450, mk.state(8450, BOOT_A, "cid_a02", "validating", "executing")),
  step(8500, mk.motionStarted(8500, BOOT_A, "cid_a02", "surprise", 900)),
  step(9400, mk.motionCompleted(9400, BOOT_A, "cid_a02", 900)),
  step(9500, mk.state(9500, BOOT_A, "cid_a02", "executing", "completed")),
  step(9600, mk.state(9600, BOOT_A, "cid_a02", "completed", "idle")),

  // 3) 일어서기 → idle pose 복귀
  step(11600, mk.state(11600, BOOT_A, "cid_a03", "idle", "listening")),
  step(13300, mk.intent(13300, BOOT_A, "cid_a03", "stand", 0.94, "넙죽아 일어나")),
  step(13400, mk.state(13400, BOOT_A, "cid_a03", "listening", "intent_recognized")),
  step(13480, mk.state(13480, BOOT_A, "cid_a03", "intent_recognized", "validating")),
  step(13550, mk.state(13550, BOOT_A, "cid_a03", "validating", "executing")),
  step(13600, mk.motionStarted(13600, BOOT_A, "cid_a03", "stand", 700)),
  step(14300, mk.motionCompleted(14300, BOOT_A, "cid_a03", 700)),
  step(14400, mk.state(14400, BOOT_A, "cid_a03", "executing", "completed")),
  step(14500, mk.state(14500, BOOT_A, "cid_a03", "completed", "idle")),
];

// ─────────────────────────────────────────────
// 2) low-confidence-reject
// ─────────────────────────────────────────────
const BOOT_B = "01J9ZBOOT0002BBBBB";

const SEQ_LOW_CONF: MockSequenceStep[] = [
  step(0,    mk.hello(0, BOOT_B, "idle")),
  step(800,  mk.state(800, BOOT_B, "cid_b01", "idle", "listening")),
  step(2600, mk.state(2600, BOOT_B, "cid_b01", "listening", "rejected", "low_confidence")),
  step(2900, mk.state(2900, BOOT_B, "cid_b01", "rejected", "idle")),
];

// ─────────────────────────────────────────────
// 3) motion-timeout-fail
// ─────────────────────────────────────────────
const BOOT_C = "01J9ZBOOT0003CCCCC";

const SEQ_MOTION_FAIL: MockSequenceStep[] = [
  step(0,    mk.hello(0, BOOT_C, "idle")),
  step(700,  mk.state(700, BOOT_C, "cid_c01", "idle", "listening")),
  step(2400, mk.intent(2400, BOOT_C, "cid_c01", "roll_left", 0.88, "넙죽아 굴러")),
  step(2480, mk.state(2480, BOOT_C, "cid_c01", "listening", "intent_recognized")),
  step(2540, mk.state(2540, BOOT_C, "cid_c01", "intent_recognized", "validating")),
  step(2600, mk.state(2600, BOOT_C, "cid_c01", "validating", "executing")),
  step(2700, mk.motionStarted(2700, BOOT_C, "cid_c01", "roll_left", 1500)),
  step(4500, mk.motionFailed(4500, BOOT_C, "cid_c01", "timeout", "max_duration exceeded by 200ms")),
  step(4600, mk.state(4600, BOOT_C, "cid_c01", "executing", "motion_failed", "timeout")),
  step(4900, mk.state(4900, BOOT_C, "cid_c01", "motion_failed", "idle")),
];

// ─────────────────────────────────────────────
// 4) boot-id-change: 첫 boot_id로 sit 진행 → 도중 ESP 재부팅 → 새 boot_id로 hello → store 전체 reset
// ─────────────────────────────────────────────
const BOOT_D1 = "01J9ZBOOT0004DDDDD";
const BOOT_D2 = "01J9ZBOOT0004D2222";

const SEQ_BOOT_RESET: MockSequenceStep[] = [
  step(0,    mk.hello(0, BOOT_D1, "idle")),
  step(800,  mk.state(800, BOOT_D1, "cid_d01", "idle", "listening")),
  step(2400, mk.intent(2400, BOOT_D1, "cid_d01", "sit", 0.91, "넙죽아 앉아")),
  step(2500, mk.state(2500, BOOT_D1, "cid_d01", "listening", "intent_recognized")),
  step(2580, mk.state(2580, BOOT_D1, "cid_d01", "intent_recognized", "validating")),
  step(2650, mk.state(2650, BOOT_D1, "cid_d01", "validating", "executing")),
  step(2700, mk.motionStarted(2700, BOOT_D1, "cid_d01", "sit", 700)),

  // ESP 재부팅 — 새 boot_id로 hello (uptime_ms 작음)
  step(4200, mk.hello(4200, BOOT_D2, "idle")),
  step(4400, mk.state(4400, BOOT_D2, "cid_d02", "idle", "idle")),
];

// ─────────────────────────────────────────────
// 5) stale-motion: 새 motion 시작 후 *이전 cid*의 motion_completed가 늦게 도착 → IntentDispatcher가 거부
// ─────────────────────────────────────────────
const BOOT_E = "01J9ZBOOT0005EEEEE";

const SEQ_STALE_MOTION: MockSequenceStep[] = [
  step(0,    mk.hello(0, BOOT_E, "idle")),
  // 1차 motion 시작
  step(800,  mk.state(800, BOOT_E, "cid_e01", "idle", "listening")),
  step(2200, mk.intent(2200, BOOT_E, "cid_e01", "sit", 0.90, "넙죽아 앉아")),
  step(2280, mk.state(2280, BOOT_E, "cid_e01", "listening", "intent_recognized")),
  step(2350, mk.state(2350, BOOT_E, "cid_e01", "intent_recognized", "validating")),
  step(2420, mk.state(2420, BOOT_E, "cid_e01", "validating", "executing")),
  step(2500, mk.motionStarted(2500, BOOT_E, "cid_e01", "sit", 700)),

  // ESP가 motion_completed를 늦게 보내기 전에 새 motion (다른 cid) 시작
  step(2600, mk.state(2600, BOOT_E, "cid_e02", "idle", "listening")),
  step(3800, mk.intent(3800, BOOT_E, "cid_e02", "stand", 0.95, "넙죽아 일어나")),
  step(3880, mk.state(3880, BOOT_E, "cid_e02", "listening", "intent_recognized")),
  step(3950, mk.state(3950, BOOT_E, "cid_e02", "intent_recognized", "validating")),
  step(4020, mk.state(4020, BOOT_E, "cid_e02", "validating", "executing")),
  step(4100, mk.motionStarted(4100, BOOT_E, "cid_e02", "stand", 700)),

  // 늦게 도착한 cid_e01의 motion_completed — 이미 cid_e02가 진행 중이므로 stale → IntentDispatcher가 거부 + protocol error 기록
  step(4250, mk.motionCompleted(4250, BOOT_E, "cid_e01", 700)),

  // cid_e02 정상 완료
  step(4800, mk.motionCompleted(4800, BOOT_E, "cid_e02", 700)),
  step(4900, mk.state(4900, BOOT_E, "cid_e02", "executing", "completed")),
  step(5000, mk.state(5000, BOOT_E, "cid_e02", "completed", "idle")),
];

export type SequenceKey =
  | "sit-success"
  | "low-confidence-reject"
  | "motion-timeout-fail"
  | "boot-id-change"
  | "stale-motion";

export interface SequenceMeta {
  label: string;
  steps: MockSequenceStep[];
  loopDelayMs: number;
}

export const SEQUENCES: Record<SequenceKey, SequenceMeta> = {
  "sit-success":           { label: "sit · happy path",        steps: SEQ_SIT_SUCCESS,    loopDelayMs: 2200 },
  "low-confidence-reject": { label: "rejected · low_conf",     steps: SEQ_LOW_CONF,       loopDelayMs: 2200 },
  "motion-timeout-fail":   { label: "motion_failed · timeout", steps: SEQ_MOTION_FAIL,    loopDelayMs: 2200 },
  "boot-id-change":        { label: "boot_id reset",           steps: SEQ_BOOT_RESET,     loopDelayMs: 2200 },
  "stale-motion":          { label: "stale motion 거부",       steps: SEQ_STALE_MOTION,   loopDelayMs: 2200 },
};
