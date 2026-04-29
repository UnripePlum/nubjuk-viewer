// IntentDispatcher — ESP→viewer 메시지 단일 진입점.
// ARCHITECTURE.md dispatch matrix + ESP-as-truth + correlation_id stale 거부.
//
// 흐름:
//   ViewerConnection.onMessage → dispatch(msg)
//   ┌── hello/state/intent/heartbeat/error → store.applyEspMessage
//   ├── motion_started   → store.applyEspMessage + motion.play
//   ├── motion_completed → cid stale 검증 → motion.settle({completed, actualMs})
//   └── motion_failed    → cid stale 검증 → motion.settle({failed, reason})
//
//   MotionController.onEvent → store.applyMotionEvent

import type { EspMessage } from "@/types/protocol";
import type { ViewerConnection, Subscription } from "@/ws/ViewerConnection";
import type { MotionController } from "@/controller/MotionController";
import type { ViewerStore } from "@/store/viewerStore";

export class IntentDispatcher {
  private subs: Subscription[] = [];

  constructor(
    private readonly conn: ViewerConnection,
    private readonly motion: MotionController,
    private readonly store: ViewerStore,
  ) {
    this.subs.push(conn.onMessage((msg) => this.dispatch(msg)));
    this.subs.push(conn.onConnectionChange((state) => store.setConnectionState(state)));
    this.subs.push(
      conn.onProtocolError((err) =>
        store.recordProtocolError(`[${err.kind}] ${err.message}`),
      ),
    );
    this.subs.push(motion.onEvent((ev) => store.applyMotionEvent(ev)));
  }

  dispose(): void {
    this.subs.forEach((s) => s.dispose());
    this.subs = [];
  }

  private dispatch(msg: EspMessage): void {
    // 모든 메시지를 store에 기록 (recent + 부분 처리)
    this.store.applyEspMessage(msg);

    switch (msg.type) {
      case "motion_started":
        // controller가 timer + started event 책임. 같은 cid 두 번은 controller가 idempotent.
        this.motion.play(
          msg.payload.intent,
          msg.payload.expected_duration_ms,
          msg.correlation_id,
        );
        break;

      case "motion_completed": {
        const currentCid = this.motion.getCurrentCorrelationId();
        if (currentCid && currentCid !== msg.correlation_id) {
          this.store.recordProtocolError(
            `stale motion_completed cid=${msg.correlation_id} (current=${currentCid})`,
          );
          break;
        }
        // ESP terminal authority — settle()이 watchdog 정리 + completed event emit.
        this.motion.settle({
          type: "completed",
          correlationId: msg.correlation_id,
          actualMs: msg.payload.actual_duration_ms,
        });
        break;
      }

      case "motion_failed": {
        const currentCid = this.motion.getCurrentCorrelationId();
        if (currentCid && currentCid !== msg.correlation_id) {
          this.store.recordProtocolError(
            `stale motion_failed cid=${msg.correlation_id} (current=${currentCid})`,
          );
          break;
        }
        this.motion.settle({
          type: "failed",
          correlationId: msg.correlation_id,
          reason: msg.payload.reason,
        });
        break;
      }

      // hello/state/intent/heartbeat/error는 store가 자체 처리
      case "hello":
      case "state":
      case "intent":
      case "error":
      case "heartbeat":
        break;
    }
  }
}
