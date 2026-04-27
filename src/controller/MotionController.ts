// 🔒 INTERFACES.md 잠금 — 사용자 명시 승인 없이 시그니처/타입 export 변경 금지.

import type { IntentName, MotionFailReason } from "@/types/protocol";
import type { Subscription } from "@/ws/ViewerConnection";

export type MotionEvent =
  | { type: "started"; correlationId: string; intent: IntentName; expectedMs: number }
  | { type: "completed"; correlationId: string; actualMs: number }
  | { type: "failed"; correlationId: string; reason: MotionFailReason }
  | { type: "cancelled"; correlationId: string; reason: "stop_called" | "superseded" };

export interface MotionController {
  // play는 "수락 즉시" resolve. 완료/실패는 onEvent로만 통지 (이중 채널 X).
  play(intent: IntentName, durationMs: number, correlationId: string): Promise<void>;
  stop(): void;
  isPlaying(): boolean;
  getCurrentCorrelationId(): string | null;
  onEvent(handler: (ev: MotionEvent) => void): Subscription;
}
