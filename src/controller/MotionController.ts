// 🔒 INTERFACES.md 잠금 — 사용자 명시 승인 없이 시그니처/타입 export 변경 금지.
// (2026-04-30 변경: settle() 추가 — ESP를 motion 진실원으로 명시. 사용자 승인 완료.)

import type { IntentName, MotionFailReason } from "@/types/protocol";
import type { Subscription } from "@/ws/ViewerConnection";

export type MotionEvent =
  | { type: "started"; correlationId: string; intent: IntentName; expectedMs: number }
  | { type: "completed"; correlationId: string; actualMs: number }
  | { type: "failed"; correlationId: string; reason: MotionFailReason }
  | { type: "cancelled"; correlationId: string; reason: "stop_called" | "superseded" };

// ESP가 진실원으로 보내는 terminal result. settle()의 단일 ingress.
// (Phase 5 Unity도 같은 시그니처로 이식 — ESP 종료 권위는 transport-agnostic.)
export type MotionSettleResult =
  | { type: "completed"; correlationId: string; actualMs: number }
  | { type: "failed"; correlationId: string; reason: MotionFailReason };

export interface MotionController {
  // 시각 재생 시작 + started event emit. terminal 권위 X — completed/failed는 settle()로만.
  play(intent: IntentName, durationMs: number, correlationId: string): Promise<void>;
  // ESP terminal 결과 inject. completed/failed event를 emit.
  // stale cid는 dispatcher가 거른 후 호출. impl은 cid 불일치 시 no-op.
  settle(result: MotionSettleResult): void;
  // local cancellation only. cancelled{stop_called} emit.
  stop(): void;
  isPlaying(): boolean;
  getCurrentCorrelationId(): string | null;
  onEvent(handler: (ev: MotionEvent) => void): Subscription;
}
