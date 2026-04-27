// docs/protocol/mcu-viewer.md envelope + 8 ESP→viewer + 3 viewer→ESP 메시지 타입.
// schemas/* 잠금 영역이라 viewer 안에서는 protocol 문서를 manual로 type화.
// 향후 root 세션에서 schemas → generated/ 동기화로 교체 가능.

import type { MotionName } from "@/data/motion-registry";

// IntentName은 mcu가 인식하는 의도. 현재는 MotionName과 1:1 매핑.
export type IntentName = MotionName;

export type FsmState =
  | "idle"
  | "listening"
  | "intent_recognized"
  | "validating"
  | "executing"
  | "completed"
  | "rejected"
  | "motion_failed";

export type RejectReason =
  | "low_confidence"
  | "cycle_timeout"
  | "precondition"
  | "stale"
  | "busy";

export type MotionFailReason = "timeout" | "hardware" | "e_stop" | "precondition" | "unknown";

export type ErrorCode =
  | "busy"
  | "invalid_message"
  | "manual_trigger_disabled"
  | "brain_unreachable"
  | "rhino_load_failed";

// ─────────────────────────────────────────────
// Common envelope fields
// ─────────────────────────────────────────────
interface BaseEnvelope {
  v: 1;
  ts_ms: number;
  device_id: string;
  boot_id: string;
  seq?: number;
}

interface CycleEnvelope extends BaseEnvelope {
  correlation_id: string;
}

// ─────────────────────────────────────────────
// ESP → viewer (8종)
// ─────────────────────────────────────────────
export interface HelloMessage extends BaseEnvelope {
  type: "hello";
  payload: {
    fw_version: string;
    schema_v: number;
    current_state: FsmState;
    capabilities: string[];
    uptime_ms: number;
  };
}

export interface StateMessage extends CycleEnvelope {
  type: "state";
  payload: {
    from: FsmState;
    to: FsmState;
    reason: RejectReason | MotionFailReason | null;
  };
}

export interface IntentMessage extends CycleEnvelope {
  type: "intent";
  payload: {
    intent: IntentName;
    slots: Record<string, unknown>;
    confidence: number;
    raw_text: string | null;
  };
}

export interface MotionStartedMessage extends CycleEnvelope {
  type: "motion_started";
  payload: {
    intent: IntentName;
    expected_duration_ms: number;
  };
}

export interface MotionCompletedMessage extends CycleEnvelope {
  type: "motion_completed";
  payload: {
    actual_duration_ms: number;
  };
}

export interface MotionFailedMessage extends CycleEnvelope {
  type: "motion_failed";
  payload: {
    reason: MotionFailReason;
    details?: string;
  };
}

export interface ErrorMessage extends BaseEnvelope {
  type: "error";
  payload: {
    code: ErrorCode;
    message: string;
  };
}

export interface HeartbeatMessage extends BaseEnvelope {
  type: "heartbeat";
  payload: {
    uptime_ms: number;
    free_heap: number;
    current_state: FsmState;
  };
}

export type EspMessage =
  | HelloMessage
  | StateMessage
  | IntentMessage
  | MotionStartedMessage
  | MotionCompletedMessage
  | MotionFailedMessage
  | ErrorMessage
  | HeartbeatMessage;

// ─────────────────────────────────────────────
// viewer → ESP (3종)
// ─────────────────────────────────────────────
export interface SubscribeCommand {
  v: 1;
  type: "subscribe";
  payload: {
    client_kind: "web" | "unity";
    debug: boolean;
  };
}

export interface ManualTriggerCommand {
  v: 1;
  type: "manual_trigger";
  payload: {
    intent: IntentName;
    slots: Record<string, unknown>;
  };
}

export interface PingCommand {
  v: 1;
  type: "ping";
  payload: Record<string, never>;
}

export type ViewerCommand = SubscribeCommand | ManualTriggerCommand | PingCommand;
