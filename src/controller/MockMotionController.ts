// MockMotionController — 단위 테스트용 spy.
// MotionController 인터페이스 만족. 자체 timer 없음 — 모든 lifecycle은 명시적 호출로만.
// 테스트가 settle/stop을 직접 호출하고 emit된 event 시퀀스를 검증.

import type { IntentName } from "@/types/protocol";
import type { Subscription } from "@/ws/ViewerConnection";
import type { MotionController, MotionEvent, MotionSettleResult } from "./MotionController";

interface MockActive {
  intent: IntentName;
  durationMs: number;
  correlationId: string;
  startedAt: number;
}

export class MockMotionController implements MotionController {
  private active: MockActive | null = null;
  private handlers = new Set<(ev: MotionEvent) => void>();
  private events: MotionEvent[] = [];

  // 테스트가 검증하는 emit log
  getEvents(): readonly MotionEvent[] {
    return this.events;
  }

  resetSpy(): void {
    this.active = null;
    this.events = [];
  }

  async play(intent: IntentName, durationMs: number, correlationId: string): Promise<void> {
    if (this.active?.correlationId === correlationId) return;
    if (this.active) {
      const prev = this.active;
      this.active = null;
      this.emit({
        type: "cancelled",
        correlationId: prev.correlationId,
        reason: "superseded",
      });
    }
    this.active = {
      intent,
      durationMs,
      correlationId,
      startedAt: performance.now(),
    };
    this.emit({ type: "started", correlationId, intent, expectedMs: durationMs });
  }

  settle(result: MotionSettleResult): void {
    if (!this.active || this.active.correlationId !== result.correlationId) return;
    const cid = this.active.correlationId;
    this.active = null;
    if (result.type === "completed") {
      this.emit({ type: "completed", correlationId: cid, actualMs: result.actualMs });
    } else {
      this.emit({ type: "failed", correlationId: cid, reason: result.reason });
    }
  }

  stop(): void {
    if (!this.active) return;
    const prev = this.active;
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

  onEvent(handler: (ev: MotionEvent) => void): Subscription {
    this.handlers.add(handler);
    return {
      dispose: () => {
        this.handlers.delete(handler);
      },
    };
  }

  private emit(ev: MotionEvent) {
    this.events.push(ev);
    this.handlers.forEach((h) => h(ev));
  }
}
