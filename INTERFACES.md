# Viewer — 인터페이스 정의 (Source of Truth)

> 🔒 이 문서의 코드 블록은 **잠금**입니다. 메서드 시그니처·타입 export를 사용자 명시 승인 없이 변경 불가. 구현 클래스 내부는 자유. 자세한 잠금 정책은 `CLAUDE.md` 참고.

## `viewer/src/ws/ViewerConnection.ts` — test seam

```typescript
export type ConnectionState =
  | { kind: "idle" }
  | { kind: "connecting"; url: string }
  | { kind: "connected"; url: string; sessionStartTs: number }
  | { kind: "reconnecting"; nextAttemptMs: number; lastError?: string }
  | { kind: "disconnected"; reason?: string }
  | { kind: "rejected"; reason: "single_viewer_occupied" | "schema_mismatch" | "manual_trigger_disabled" | string };

export type Subscription = { dispose(): void };

export interface ViewerConnection {
  connect(url: string): Promise<void>;
  disconnect(): void;
  getState(): ConnectionState;
  send(msg: ViewerCommand): void;
  // subscription-style: 다중 구독 + 명시적 dispose
  onMessage(handler: (msg: EspMessage) => void): Subscription;
  onConnectionChange(handler: (state: ConnectionState) => void): Subscription;
  onProtocolError(handler: (err: { kind: "schema" | "parse"; raw?: string; message: string }) => void): Subscription;
}
```

**Lifecycle 규칙**:
- `connect` 후 `getState()`가 `connecting → connected` 또는 `rejected`로 전이
- 자동 재연결 시 `reconnecting` 상태로 진입, 백오프 후 다시 `connecting`
- `disconnect()`는 즉시 `disconnected`로 전이, 재연결 시도 안 함
- 모든 `Subscription`은 `dispose()`로 해제 가능 (메모리 누수 방지)
- 다중 핸들러 등록 가능 — 각 핸들러는 독립적으로 호출되고 독립적으로 dispose

## `viewer/src/controller/MotionController.ts`

```typescript
export type MotionEvent =
  | { type: "started";   correlationId: string; intent: IntentName; expectedMs: number }
  | { type: "completed"; correlationId: string; actualMs: number }
  | { type: "failed";    correlationId: string; reason: MotionFailReason }
  | { type: "cancelled"; correlationId: string; reason: "stop_called" | "superseded" };

export type MotionFailReason = "timeout" | "hardware" | "e_stop" | "precondition" | "unknown";

export interface MotionController {
  // play는 "수락 즉시" resolve. 완료/실패는 onEvent로만 통지 (이중 채널 X).
  play(intent: IntentName, durationMs: number, correlationId: string): Promise<void>;
  stop(): void;            // 진행 중이면 cancelled 이벤트 발화
  isPlaying(): boolean;
  getCurrentCorrelationId(): string | null;
  onEvent(handler: (ev: MotionEvent) => void): Subscription;
}
```

**Lifecycle 규칙**:
- `play()` Promise는 **수락 시점**에 resolve (animation 시작은 별개). 완료는 `onEvent({type:"completed"})`로만.
- 같은 correlationId로 두 번 play 호출 → 두 번째는 무시 (idempotent)
- 다른 correlationId로 play 호출 (진행 중) → 현재 motion에 `cancelled{reason:"superseded"}` 발화 후 새로 시작
- `stop()` 진행 중에만 `cancelled{reason:"stop_called"}` 발화. idle이면 no-op.
- 늦게 도착하는 ESP 메시지(예: 이전 cycle의 motion_completed)는 IntentDispatcher가 `getCurrentCorrelationId()` 비교 후 dispatch — stale 이벤트는 motion에 전달 X

## 구현체 매트릭스

```typescript
// 모두 같은 MotionController 인터페이스 만족
class WebMotionController implements MotionController { /* GIF, P2~4 */ }
class UnityMotionController implements MotionController { /* 3D, P5~ */ }
class MockMotionController implements MotionController { /* 테스트 spy */ }

// 모두 같은 ViewerConnection 인터페이스 만족
class WebSocketViewerConnection implements ViewerConnection { /* 실제 WS, P2~ */ }
class MockViewerConnection implements ViewerConnection { /* 테스트 */ }
```

## `viewer/src/motion/intentDispatcher.ts` — 메시지 dispatch 단일 진입점

```typescript
export class IntentDispatcher {
  constructor(
    private conn: ViewerConnection,
    private motion: MotionController,
    private store: ViewerStore,    // 단일 store (state log, intent panel 등)
  ) {
    conn.onMessage((msg) => this.dispatch(msg));
  }

  private dispatch(msg: EspMessage): void {
    // 전체 메시지 매트릭스는 ARCHITECTURE.md 참고
  }
}
```

→ `IntentDispatcher`는 **잠금 X** (구현 자유). 다만 모든 ESP 메시지 타입을 처리해야 함 (놓침 X). 매트릭스는 `ARCHITECTURE.md` 참고.

## 조립 패턴 (`app/page.tsx`)

```typescript
"use client";
const espHost = resolveEspHost();
const conn: ViewerConnection = new WebSocketViewerConnection();
const motion: MotionController = new WebMotionController();
const store = createViewerStore();
const dispatcher = new IntentDispatcher(conn, motion, store);

useEffect(() => {
  const sub = conn.onConnectionChange(setUiConnState);
  conn.connect(`ws://${espHost}/viewer`);
  return () => { sub.dispose(); conn.disconnect(); };
}, []);
```

## Phase 5 교체

```diff
- const motion: MotionController = new WebMotionController();
+ const motion: MotionController = new UnityMotionController(unityBridge);
```

→ `IntentDispatcher`와 `ViewerConnection`은 변경 없음.
