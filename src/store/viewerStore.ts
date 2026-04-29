// ViewerStore — 단일 진실원 (ARCHITECTURE.md 행동 contract).
// React 18 useSyncExternalStore 호환.
//
// Reset 규칙:
//   boot_id 변경      → 전체 reset
//   WS disconnected   → connection만 reset, history 유지
//   connected + hello → 새 session, stateLog/lastIntent reset
//   disconnect()      → connection만 reset

import { useSyncExternalStore } from "react";
import type {
  EspMessage,
  FsmState,
  IntentMessage,
  MotionFailReason,
  StateMessage,
} from "@/types/protocol";
import type { ConnectionState } from "@/ws/ViewerConnection";
import type { MotionEvent } from "@/controller/MotionController";
import type { Pose } from "@/data/pose-engine";
import { nextPose } from "@/data/pose-engine";

const STATE_LOG_LIMIT = 20;
const PROTOCOL_ERR_LIMIT = 8;
const RECENT_MSG_LIMIT = 10;

export type MotionUiStatus = "started" | "completed" | "failed" | "cancelled" | null;

// "현재 또는 마지막 시작된 motion" — terminal(completed/failed/cancelled) 후에도 유지.
// UI consumer는 *currently running*이 필요하면 motionStatus === 'started'로 가드 필수.
// 다음 motion의 'started' event가 오거나 hello session reset 시 갱신/clear.
// (이 의미는 MotionChip이 "DONE/FAILED" 상태에서도 motion 이름을 보여주기 위함.)
export interface ActiveMotion {
  name: string;
  durationMs: number;
  correlationId: string;
  startedAt: number;
}

export interface ViewerStoreState {
  connectionState: ConnectionState;
  bootId: string | null;
  currentState: FsmState | null;
  lastIntent: IntentMessage | null;
  stateLog: StateMessage[];
  protocolErrors: { count: number; recent: string[] };
  // motion (UI consumption)
  activeMotion: ActiveMotion | null;
  motionStatus: MotionUiStatus;
  motionFailReason: MotionFailReason | null;
  currentPose: Pose;
  // dev panel (recent ESP messages, latest 10)
  recentMessages: EspMessage[];
  // Phase 4: brain dual ↔ mcu fallback informational
  // 마지막 error{code:"brain_unreachable"} 도착 시점 (Date.now()). UI 5s 자동 dismiss용.
  lastBrainUnreachableAt: number | null;
}

const INITIAL_STATE: ViewerStoreState = {
  connectionState: { kind: "idle" },
  bootId: null,
  currentState: null,
  lastIntent: null,
  stateLog: [],
  protocolErrors: { count: 0, recent: [] },
  activeMotion: null,
  motionStatus: null,
  motionFailReason: null,
  currentPose: "idle",
  recentMessages: [],
  lastBrainUnreachableAt: null,
};

type Listener = () => void;

export class ViewerStore {
  private state: ViewerStoreState = INITIAL_STATE;
  private listeners = new Set<Listener>();

  // ───── React glue ─────
  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };

  getSnapshot = (): ViewerStoreState => this.state;

  // ───── connection ─────
  setConnectionState(next: ConnectionState) {
    this.update((s) => {
      const wasConnected = s.connectionState.kind === "connected";
      const newConnected = next.kind === "connected";
      // disconnected 시 history 유지, connection만 reset
      if (next.kind === "disconnected" || next.kind === "rejected") {
        return { ...s, connectionState: next };
      }
      // 새 연결 시작은 그냥 update (hello가 와야 진짜 reset)
      void wasConnected;
      void newConnected;
      return { ...s, connectionState: next };
    });
  }

  // ───── ESP messages ─────
  applyEspMessage(msg: EspMessage) {
    this.recordRecent(msg);

    switch (msg.type) {
      case "hello":
        this.applyHello(msg.boot_id, msg.payload.current_state);
        break;
      case "state":
        this.applyState(msg);
        break;
      case "intent":
        this.update((s) => ({ ...s, lastIntent: msg }));
        break;
      case "motion_started":
      case "motion_completed":
      case "motion_failed":
        // motion lifecycle은 IntentDispatcher가 별도로 store.applyMotionEvent 호출
        break;
      case "error":
        // 에러는 기본 recentMessages로 표시. 특정 code는 별도 mirror 필드 갱신:
        //  - brain_unreachable → lastBrainUnreachableAt (Phase 4 informational toast용)
        if (msg.payload.code === "brain_unreachable") {
          this.update((s) => ({ ...s, lastBrainUnreachableAt: Date.now() }));
        }
        break;
      case "heartbeat":
        // currentState mirror 갱신
        this.update((s) => ({ ...s, currentState: msg.payload.current_state }));
        break;
    }
  }

  private applyHello(bootId: string, currentState: FsmState) {
    this.update((s) => {
      const bootIdChanged = s.bootId !== null && s.bootId !== bootId;
      if (bootIdChanged) {
        // 전체 reset
        return {
          ...INITIAL_STATE,
          connectionState: s.connectionState,
          bootId,
          currentState,
        };
      }
      // 같은 boot_id 또는 첫 hello → session reset (stateLog, lastIntent, brain fallback toast)
      return {
        ...s,
        bootId,
        currentState,
        lastIntent: null,
        stateLog: [],
        activeMotion: null,
        motionStatus: null,
        motionFailReason: null,
        lastBrainUnreachableAt: null,
      };
    });
  }

  private applyState(msg: StateMessage) {
    this.update((s) => ({
      ...s,
      currentState: msg.payload.to,
      stateLog: [...s.stateLog, msg].slice(-STATE_LOG_LIMIT),
    }));
  }

  applyMotionEvent(ev: MotionEvent) {
    this.update((s) => {
      const cur = s.activeMotion;
      switch (ev.type) {
        case "started":
          return {
            ...s,
            activeMotion: {
              name: ev.intent,
              durationMs: ev.expectedMs,
              correlationId: ev.correlationId,
              startedAt: performance.now(),
            },
            motionStatus: "started",
            motionFailReason: null,
          };
        case "completed": {
          if (!cur || cur.correlationId !== ev.correlationId) return s;
          return {
            ...s,
            motionStatus: "completed",
            currentPose: nextPose(s.currentPose, cur.name),
          };
        }
        case "failed": {
          if (!cur || cur.correlationId !== ev.correlationId) return s;
          return {
            ...s,
            motionStatus: "failed",
            motionFailReason: ev.reason,
            // pose는 유지 (실패 시)
          };
        }
        case "cancelled": {
          if (!cur || cur.correlationId !== ev.correlationId) return s;
          // 이미 terminal status면 무시
          if (s.motionStatus === "failed" || s.motionStatus === "completed") return s;
          return {
            ...s,
            motionStatus: "cancelled",
          };
        }
      }
    });
  }

  // ───── protocol errors ─────
  recordProtocolError(message: string) {
    this.update((s) => ({
      ...s,
      protocolErrors: {
        count: s.protocolErrors.count + 1,
        recent: [...s.protocolErrors.recent, message].slice(-PROTOCOL_ERR_LIMIT),
      },
    }));
  }

  private recordRecent(msg: EspMessage) {
    this.update((s) => ({
      ...s,
      recentMessages: [...s.recentMessages, msg].slice(-RECENT_MSG_LIMIT),
    }));
  }

  // 명시적 reset (테스트 / 시퀀스 재시작용)
  reset() {
    this.state = INITIAL_STATE;
    this.emit();
  }

  // ───── internals ─────
  private update(fn: (s: ViewerStoreState) => ViewerStoreState) {
    const next = fn(this.state);
    if (next === this.state) return;
    this.state = next;
    this.emit();
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }
}

// React hook — 전체 state 또는 selector
export function useViewerStore<T>(store: ViewerStore, selector: (s: ViewerStoreState) => T): T;
export function useViewerStore(store: ViewerStore): ViewerStoreState;
export function useViewerStore<T>(
  store: ViewerStore,
  selector?: (s: ViewerStoreState) => T,
): T | ViewerStoreState {
  const sel = selector ?? ((s: ViewerStoreState) => s as unknown as T);
  return useSyncExternalStore(
    store.subscribe,
    () => sel(store.getSnapshot()),
    () => sel(store.getSnapshot()),
  );
}
