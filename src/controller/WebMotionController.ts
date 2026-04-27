// WebMotionController — DOM 친화적 MotionController 구현체.
// duration timer 기반. 실제 GIF 렌더링은 NubjukViewer (시각 레이어)가 담당.
// MotionController는 *진행 상태와 이벤트 채널*만 책임.

import type { IntentName, MotionFailReason } from "@/types/protocol";
import type { Subscription } from "@/ws/ViewerConnection";
import type { MotionController, MotionEvent } from "./MotionController";

type Handler = (ev: MotionEvent) => void;

interface ActiveMotion {
  intent: IntentName;
  durationMs: number;
  correlationId: string;
  startedAt: number;
  timer: ReturnType<typeof setTimeout>;
}

export class WebMotionController implements MotionController {
  private active: ActiveMotion | null = null;
  private handlers = new Set<Handler>();

  async play(intent: IntentName, durationMs: number, correlationId: string): Promise<void> {
    // 같은 cid 두 번 → idempotent (no-op)
    if (this.active?.correlationId === correlationId) return;

    // 다른 cid 진행 중 → 현재 cancel(superseded) 후 새로 시작
    if (this.active) {
      const prev = this.active;
      clearTimeout(prev.timer);
      this.active = null;
      this.emit({
        type: "cancelled",
        correlationId: prev.correlationId,
        reason: "superseded",
      });
    }

    const startedAt = performance.now();
    const timer = setTimeout(() => {
      const m = this.active;
      if (!m || m.correlationId !== correlationId) return;
      this.active = null;
      this.emit({
        type: "completed",
        correlationId,
        actualMs: Math.round(performance.now() - startedAt),
      });
    }, durationMs);

    this.active = { intent, durationMs, correlationId, startedAt, timer };
    this.emit({ type: "started", correlationId, intent, expectedMs: durationMs });
  }

  stop(): void {
    if (!this.active) return;
    const prev = this.active;
    clearTimeout(prev.timer);
    this.active = null;
    this.emit({
      type: "cancelled",
      correlationId: prev.correlationId,
      reason: "stop_called",
    });
  }

  isPlaying(): boolean {
    return this.active !== null;
  }

  getCurrentCorrelationId(): string | null {
    return this.active?.correlationId ?? null;
  }

  onEvent(handler: Handler): Subscription {
    this.handlers.add(handler);
    return {
      dispose: () => {
        this.handlers.delete(handler);
      },
    };
  }

  // 외부에서 *실패*를 trigger 받을 때 (mcu가 motion_failed 메시지를 보낸 경우 IntentDispatcher가 호출).
  // MotionController 인터페이스에는 없는 implementation-specific helper.
  fail(correlationId: string, reason: MotionFailReason): void {
    if (!this.active || this.active.correlationId !== correlationId) return;
    clearTimeout(this.active.timer);
    this.active = null;
    this.emit({ type: "failed", correlationId, reason });
  }

  private emit(ev: MotionEvent) {
    this.handlers.forEach((h) => h(ev));
  }
}
