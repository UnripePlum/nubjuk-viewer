// Store selectors — 컴포넌트 친화적 derived state.
// 컴포넌트가 직접 store 내부 모양에 의존하지 않도록 한 layer.

import type { IntentName } from "@/types/protocol";
import type { Pose } from "@/data/pose-engine";
import type { ActiveMotion, MotionUiStatus, ViewerStoreState } from "./viewerStore";

export interface IntentDisplay {
  intent?: IntentName;
  confidence: number;
  raw: string;
  rejected: boolean;
  reason?: string;
}

export function selectIntentDisplay(s: ViewerStoreState): IntentDisplay | null {
  if (s.lastIntent) {
    const p = s.lastIntent.payload;
    return {
      intent: p.intent,
      confidence: p.confidence,
      raw: p.raw_text ?? "",
      rejected: false,
    };
  }
  if (s.currentState === "rejected") {
    const lastState = s.stateLog[s.stateLog.length - 1];
    return {
      confidence: 0,
      raw: "",
      rejected: true,
      reason: lastState?.payload.reason ?? undefined,
    };
  }
  return null;
}

// VoiceVisualizer의 phase prop과 호환 (idle | listening | wake | rejected | executing)
// mcu FsmState를 visual phase로 매핑.
export type VoicePhase = "idle" | "listening" | "rejected" | "executing";

export function selectVoicePhase(s: ViewerStoreState): VoicePhase {
  switch (s.currentState) {
    case "listening":
      return "listening";
    case "rejected":
    case "motion_failed":
      return "rejected";
    case "intent_recognized":
    case "validating":
    case "executing":
    case "completed":
      return "executing";
    case "idle":
    default:
      return "idle";
  }
}

export interface MotionView {
  active: ActiveMotion | null;
  status: MotionUiStatus;
  failed: boolean;
  failReason: string | null;
  pose: Pose;
}

export function selectMotionView(s: ViewerStoreState): MotionView {
  return {
    active: s.activeMotion,
    status: s.motionStatus,
    failed: s.motionStatus === "failed",
    failReason: s.motionFailReason,
    pose: s.currentPose,
  };
}
