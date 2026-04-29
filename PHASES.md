# Viewer — Phase별 구현 계획

> Phase 0 → 1 → 2 → 3 → 4 → 5 → 6 순서대로 진행. 임의로 phase 순서 바꾸지 말 것.
> 인터페이스 시그니처는 `INTERFACES.md`, 컴포넌트 다이어그램·메시지 매트릭스는 `ARCHITECTURE.md` 참고.

## 진행 현황 (2026-04-30)

| Phase | 상태 | 비고 |
|-------|------|------|
| 0~1 | — | viewer 작업 없음 (mcu standalone) |
| 2 | ✅ 코드 완료 | DI/store/transport/UI/tests 92개. 실 ESP 통합 검증만 mcu side 의존. ESP host 모달 / DEV_MODE manual_trigger gating은 deferred |
| 3 | ✅ | `motion_failed.reason` UI 차별화 (`HW·FAIL`, `E·STOP`, `PRECOND` 등) + e-stop 사선 hazard stripe 빨간 배너 |
| 4 | ✅ | brain_unreachable informational toast (5초 자동 dismiss + same-boot hello reset 시 clear) |
| 5.1 | ✅ | `viewer/unity/` plain C# 1:1 이식 (Protocol/Wire/IViewerConnection/IMotionController/ViewerStore/IntentDispatcher/MockMotionController). dotnet 컴파일은 사용자 환경 |
| 5.2 | ◯ | NativeWebSocket-기반 `WebSocketViewerConnection.cs` + Animator-기반 `UnityMotionController.cs` + `NubjukController.cs` MonoBehaviour. Unity 6 LTS 결정 후 |
| 5.3 | ◯ | Scene + Animator 컨트롤러 + Inspector 구성 |
| 5.4 | ◯ | TS↔C# canonical snapshot serializer + 5 mock sequence parity 검증. **5.2 직후 우선화** (C# 0% coverage 해소) |
| 6 | ◯ | DEV_MODE=n 빌드 정책 사용자 결정 |

**Codex 리뷰 history**: Phase 2 Option D refactor (8fb2fec), 테스트 lane (c24c7d4), WS+host (24aff39), Phase 3+4 + 코덱스 P2/P3 fixes (fc7bec1), Phase 5.1 + plan-eng-review (aafb9dd) — 모두 통과.

## Phase 0~1 — viewer 작업 없음

mcu가 standalone으로 동작하는 단계. viewer 디렉토리는 비어있음.

---

## Phase 2 — web viewer (Next.js)

**목표**: ESP의 WS 서버에 연결, FSM 상태와 motion을 시각화. 디버그 버튼으로 manual_trigger 송신.

### 디렉토리 스캐폴딩
```
viewer/
├── package.json
├── tsconfig.json
├── next.config.mjs
├── app/
│   ├── layout.tsx
│   ├── page.tsx                 # DI 부팅: ViewerConnection + MotionController + Dispatcher
│   └── globals.css
├── public/
│   └── motions/                 # 모션 애셋 (sit.webm, stand.webm, ... — duration metadata 포함)
└── src/
    ├── ws/
    │   ├── ViewerConnection.ts          # 인터페이스 (잠금)
    │   ├── WebSocketViewerConnection.ts # 구현
    │   ├── MockViewerConnection.ts      # 단위 테스트용
    │   └── resolveEspHost.ts            # IP 입력 헬퍼
    ├── motion/
    │   ├── motionTypes.ts               # generated from schemas/
    │   ├── intentDispatcher.ts          # 단일 dispatch 진입점
    │   └── motionRegistry.ts
    ├── controller/
    │   ├── MotionController.ts          # 인터페이스 (잠금)
    │   ├── WebMotionController.ts       # 구현
    │   ├── UnityMotionController.ts     # placeholder for Phase 5
    │   └── MockMotionController.ts
    ├── store/
    │   └── viewerStore.ts               # 단일 store (state log, intent panel, connection)
    ├── components/
    │   ├── NubjukViewer.tsx
    │   ├── StateLog.tsx
    │   ├── IntentPanel.tsx
    │   └── DebugButtons.tsx
    └── generated/
        └── schemas.d.ts                  # JSON Schema → TS types
```

### 구현 task

#### 2.1 의존성 셋업
- [ ] Next.js 14+ App Router, React 18+, TypeScript strict
- [ ] `json-schema-to-typescript` (devDep) — schemas → 타입 자동 생성 스크립트
- [ ] `npm run gen:types` — `docs/`에서 schemas 읽어 `src/generated/schemas.d.ts` 출력
- [ ] (참고) viewer 세션은 cwd 격리상 `schemas/`를 직접 못 읽으므로 root 세션에서 schemas/를 viewer/src/generated/로 복사하거나 root에서 generate 후 commit

#### 2.2 ViewerConnection 구현 (`WebSocketViewerConnection.ts`)
- [ ] `ViewerConnection` 인터페이스 구현 (시그니처는 `INTERFACES.md` 잠금)
- [ ] 자동 재연결 백오프 (1s → 2s → 5s → 10s, max 10s)
- [ ] `subscribe` 메시지 자동 송신 (connect 후)
- [ ] `ping` 10초 주기 자동 송신
- [ ] schema 위반 메시지 → `onProtocolError` 발화 (silent drop X, 카운터 + 콘솔 경고)
- [ ] heartbeat 30초 누락 시 자동 reconnect (last received message ts_ms 추적)
- [ ] **다중 핸들러 지원**: 내부에 핸들러 배열 유지, 각 `Subscription.dispose()`로 개별 해제
- [ ] **Tab visibility / suspend 처리**: `document.visibilitychange`로 backgrounded → reconnect 백오프 일시 중지, foreground 복귀 시 재시도

#### 2.3 WebMotionController (`WebMotionController.ts`) — codex fix: GIF cycle 감지 X
- [ ] `MotionController` 인터페이스 구현 (시그니처는 `INTERFACES.md` 잠금)
- [ ] motion별 애셋 매핑 — **`motionRegistry.ts`에 정확한 duration metadata** 저장 (GIF 1 cycle 감지 X)
- [ ] `play(intent, durationMs, cid)` 호출 → DOM 애셋에 `key={cid}`로 force-remount + `setTimeout(durationMs)` 후 `completed` 이벤트 발화
- [ ] **`durationMs`는 ESP가 제공한 `expected_duration_ms` 단일 source** (브라우저가 GIF cycle 종료를 노출하지 않으므로 추론 X)
- [ ] **WebM/MP4 사용 권장** — `<video>`의 `onended` 이벤트로 정확한 종료 시점 가능. 또는 GIF + duration metadata
- [ ] 같은 cid 두 번 play → 두 번째 무시
- [ ] 다른 cid play (진행 중) → 현재 motion에 `cancelled{reason:"superseded"}` 발화 후 새로 시작
- [ ] `stop()` 진행 중 → `cancelled{reason:"stop_called"}` 발화 + idle 애셋 복귀
- [ ] `getCurrentCorrelationId()` — IntentDispatcher가 stale event 거부에 사용

#### 2.4 IntentDispatcher (`intentDispatcher.ts`) — codex fix: 전체 메시지 매트릭스
- [ ] 모든 ESP 메시지를 처리. 매트릭스는 **`ARCHITECTURE.md`의 메시지 dispatch 표** 참고
- [ ] `motion_*` 메시지는 **stale 거부** — payload의 `correlation_id`가 `motion.getCurrentCorrelationId()`와 다르면 store 로그만, motion에 전달 X
- [ ] `state` / `intent` / `error` / `heartbeat` / `hello` 모두 store에 dispatch
- [ ] `hello` 수신 시 store 초기화 — 새 session start으로 간주
- [ ] `boot_id` 변경 감지 → 전체 store reset (ESP 재부팅 인지)
- [ ] schema 위반 / parse 실패는 `onProtocolError`로 store에 보고

#### 2.5 ViewerStore (`store/viewerStore.ts`) — codex fix: 단일 진실원
- [ ] React context + useSyncExternalStore (또는 zustand 등 작은 store) — 컴포넌트에서 직접 dispatch 호출 X
- [ ] 보유 상태:
  - `connectionState: ConnectionState`
  - `currentState: FsmState | null` (마지막 ESP state)
  - `lastIntent: IntentMessage | null`
  - `stateLog: StateTransition[]` (최근 20개 cyclic buffer)
  - `protocolErrors: { count: number; recent: string[] }`
  - `bootId: string | null` (ESP 재부팅 감지)
- [ ] **Reset rules**:
  - `boot_id` 변경 → 모든 상태 reset
  - `disconnected` → connection만 reset, 다른 상태는 유지 (operator가 history 볼 수 있도록)
  - `connected` 후 `hello` 수신 → 새 session으로 간주, stateLog/lastIntent reset

#### 2.6 UI 컴포넌트
- [ ] `NubjukViewer` — 메인 motion 표시, 연결 상태 인디케이터 (store에서 read)
- [ ] `StateLog` — store.stateLog에서 read, 색상 코드
- [ ] `IntentPanel` — store.lastIntent
- [ ] `DebugButtons` — 5개 intent 버튼, 클릭 시 `manual_trigger` 송신
  - `subscribe`에서 `debug:true`로 등록한 경우만 표시
  - `error{code:"manual_trigger_disabled"}` 받은 후 비활성 + 토스트
  - **시각적 disabled 외에 실제 send 호출도 차단** (server-authoritative 처리)

#### 2.7 ESP host 입력 헬퍼 (`resolveEspHost.ts`) — codex fix: 정규화 명시
- [ ] `resolveEspHost()` 우선순위:
  1. URL 쿼리 `?host=192.168.0.42` (있으면 localStorage에 저장)
  2. localStorage `esp_host`
  3. env `NEXT_PUBLIC_ESP_HOST`
  4. fallback: 사용자 입력 in-app UI (window.prompt 비추천 — 모달 컴포넌트 권장)
- [ ] **입력 정규화 규칙**:
  - whitespace trim
  - `ws://`, `http://`, `https://` 제거 후 raw host:port만 유지
  - 끝의 `/`, `/viewer` 등 path 제거
  - IPv6 literal은 `[::1]:80` 형태 허용
  - 빈 port → 80 default
  - 형식 검증: 정규식 `^([a-z0-9.-]+|\[[0-9a-f:]+\])(:\d+)?$`
- [ ] connect 실패 시 in-app UI로 재입력 요청 + localStorage 갱신
- [ ] 한 번 successful connect → localStorage에 저장 (다음 부팅 자동)

#### 2.8 부팅 조립 (`app/page.tsx`)
```typescript
"use client";
const espHost = resolveEspHost();
const conn = new WebSocketViewerConnection();
const motion = new WebMotionController();
const store = createViewerStore();
const dispatcher = new IntentDispatcher(conn, motion, store);

useEffect(() => {
  conn.connect(`ws://${espHost}/viewer`);
  return () => conn.disconnect();
}, []);
```

### Phase 2 Gate
- [ ] `resolveEspHost()` 우선순위(query → localStorage → env → prompt) 동작 검증
- [ ] 잘못된 IP 입력 시 사용자 재입력 prompt 동작
- [ ] viewer 연결 시 hello snapshot 정상 수신·표시
- [ ] FSM 9 상태 전이 모두 stateLog에 표시
- [ ] intent / motion_started / motion_completed 모두 UI 반영
- [ ] WebMotionController가 5개 모션 모두 재생, idle 자동 복귀 (애셋 duration metadata 사용)
- [ ] DebugButtons로 manual_trigger 송신 → ESP가 motion 모의 실행
- [ ] DEV_MODE=n 빌드에서 manual_trigger UI 비활성화 + send 호출 차단 검증
- [ ] ESP 재연결 시 백오프 정상 동작
- [ ] viewer 끊김에도 ESP는 정상 (degraded mode 검증은 mcu 쪽)
- [ ] heartbeat 30초 누락 시 자동 reconnect
- [ ] **boot_id 변경 감지 시 store 전체 reset** (ESP 재부팅 시뮬레이션으로 검증)
- [ ] **stale motion_completed 거부 검증** — 이전 cid의 메시지가 새 cid의 motion을 stop 안 함
- [ ] schema 위반 메시지 수신 시 `protocolErrors.count` 증가 + UI 배지

---

## Phase 3 — viewer 변경 거의 없음

mcu가 motion_serial → hardware로 교체되더라도 viewer는 WS 메시지만 보면 되어 변경 없음. 다만:
- [ ] `motion_failed.reason` 새 값 (`hardware`, `e_stop`) UI 반영 추가
- [ ] e-stop 발생 시 시각적 알림 (빨간 배너, 이전 motion에 `failed` event 발화)

---

## Phase 4 — viewer 변경 없음

mcu가 brain dual로 교체되어도 viewer는 모름. brain disconnect 발생 시 mcu가 보내는 `error{code:"brain_unreachable"}` informational 메시지 처리만 추가:
- [ ] 작은 informational toast 또는 헤더 배지로 "brain 폴백 중" 표시 (5초 자동 dismiss)

---

## Phase 5 — Unity viewer

**목표**: web viewer를 Unity 3D로 교체. 같은 `MotionController` 개념을 Unity가 구현.

### 디렉토리 (Unity 프로젝트 별도 트리)
```
viewer-unity/                     # 또는 viewer/unity/
├── Assets/
│   ├── Scripts/
│   │   ├── ws/
│   │   │   └── WebSocketViewerConnection.cs
│   │   ├── controller/
│   │   │   └── UnityMotionController.cs
│   │   ├── motion/
│   │   │   ├── IntentDispatcher.cs
│   │   │   └── motionTypes.cs (generated)
│   │   ├── store/
│   │   │   └── ViewerStore.cs
│   │   └── components/
│   │       └── NubjukController.cs
│   ├── Models/                   # 3D 모델
│   └── Animations/               # 모션 클립
└── ProjectSettings/
```

### 구현 task

#### 5.1 Unity WS 클라이언트
- [ ] `NativeWebSocket` 또는 `WebSocketSharp` 패키지 도입
- [ ] `WebSocketViewerConnection` (C#) — TS와 같은 시그니처 의미 일치 (state machine, lifecycle, subscription)
- [ ] subscribe/manual_trigger/ping 송신, 메시지 핸들링
- [ ] 자동 재연결 백오프 (TS와 동일 정책)

#### 5.2 UnityMotionController
- [ ] 같은 `MotionController` 개념을 C#으로 (인터페이스 정의)
- [ ] 3D 모델의 `Animator` 컨트롤러에 motion trigger 매핑
- [ ] **완료 시점**: ESP-provided duration timer 사용 (Animator state exit 의존 X — 인터럽션/blending에 약함)
- [ ] correlation_id 기준 한 cycle만 재생 (중복 trigger 방지)
- [ ] 다른 cid play (진행 중) → 현재 trigger 중단 + cancelled event

#### 5.3 IntentDispatcher (C#)
- [ ] TS와 동일한 dispatch 매트릭스를 C#으로 (ARCHITECTURE.md 참고)
- [ ] stale motion event 거부 로직 동일

#### 5.4 ViewerStore (C#)
- [ ] TS와 동일한 상태 모델 (Unity ScriptableObject 또는 평범한 class)

### Phase 5 Gate
- [ ] Unity 3D 모델이 5개 motion 모두 동일하게 재생 (web과 같은 cid → 같은 결과)
- [ ] state log UI 동작
- [ ] DebugButtons (Unity 버전) → manual_trigger 송신
- [ ] heartbeat / reconnect Unity에서도 정상
- [ ] **TS와 C# 양쪽에서 같은 ESP 메시지 시퀀스 입력 시 동일 UI 결과** (parity test)

---

## Phase 6 — 양산화 (viewer 폐기 또는 read-only)

- [ ] DEV_MODE=n ESP 빌드에서 viewer 연결 정책 결정 (3 옵션 중 사용자 선택):
  - (A) ESP가 WS server 자체 비활성 → viewer 연결 실패
  - (B) viewer는 read-only(subscribe만, manual_trigger 무시) — 모니터링 도구로 잔존
  - (C) 인증 토큰 통과한 경우만 manual_trigger 허용 — 운영자 도구로 활용
- [ ] 결정된 정책에 따라 viewer 코드/배포 조정

이 단계의 viewer 작업은 사용자 결정에 따라 달라짐.
