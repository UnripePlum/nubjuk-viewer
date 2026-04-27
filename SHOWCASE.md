# Viewer Phase 2 — 필요한 기능 (Showcase scope)

> office-hours + plan-design-review + design-shotgun 세션 결과를 압축한 **구현 기능 목록**.
> 디자인 결정의 *왜*는 `~/.gstack/projects/UnripePlum-nubjuk-viewer/unripeplum-main-design-20260427-152951.md` 참고.
> Phase 2 Gate (PHASES.md)와 1:1 매핑. 잠금 정책은 `CLAUDE.md` 참고.

---

## 핵심 모드

- **Showcase first** — 메인 화면은 음성→의도→모션 흐름 시각화. 디버깅은 `?dev=1` 사이드바.
- **Mock first 개발** — ESP 없이 `MockViewerConnection` + 시퀀스 `.json`으로 UI 작업. 마지막에 `WebSocketViewerConnection`.
- **Vertical drop layout** — 명령이 위에서 떨어져 *항상 살아있는* 넙죽이 GIF로 도달.

---

## 필요한 기능 (8개)

### 1. WebSocket 연결 관리 — `WebSocketViewerConnection.ts`

`ViewerConnection` 인터페이스 구현 (시그니처 잠금, `INTERFACES.md`).

- 자동 재연결 백오프: 1s → 2s → 5s → 10s (max 10s)
- `subscribe{client_kind:"web", debug:true}` 자동 송신 (connect 후)
- `ping` 10초 주기
- heartbeat 30초 누락 시 자동 reconnect
- schema 위반 → `onProtocolError` (silent drop X)
- 다중 핸들러 + 명시적 `dispose()` (메모리 누수 방지)
- Tab visibility: backgrounded 시 백오프 정지, foreground 즉시 재시도

### 2. Mock 연결 — `MockViewerConnection.ts` + `mock/sequences/*.json`

`ViewerConnection` 인터페이스를 만족하는 가짜 구현. 시퀀스 5개 결정적 재생.

- `sit-success.json` — happy path (state→intent→motion_started→motion_completed)
- `low-confidence-reject.json` — rejected{low_confidence}
- `motion-timeout-fail.json` — motion_failed{timeout}
- `boot-id-change.json` — ESP 재부팅 → store 전체 reset 검증
- `stale-motion.json` — old correlation_id 거부 검증

각 시퀀스: `{ts_offset_ms, message}` 배열. Mock이 시간 차로 흘림.

### 3. 메시지 dispatch — `intentDispatcher.ts`

8 ESP→viewer 메시지 모두 처리 (놓침 X). 매트릭스는 `ARCHITECTURE.md` 참고.

- `motion_*` 메시지 → `motion.getCurrentCorrelationId()` 비교 후 stale 거부 (motion에 전달 X, store에만 로그)
- `boot_id` 변경 → store 전체 reset
- `hello` → 새 session, stateLog/lastIntent reset
- schema 위반 → `onProtocolError` 카운터 증가

### 4. 상태 저장소 — `viewerStore.ts`

단일 진실원. React context + `useSyncExternalStore` 또는 zustand.

```typescript
type ViewerStoreState = {
  connectionState: ConnectionState;
  bootId: string | null;
  currentState: FsmState | null;
  lastIntent: IntentMessage | null;
  stateLog: StateTransition[];   // cyclic buffer 20
  protocolErrors: { count: number; recent: string[] };
};
```

Reset 규칙: `boot_id` 변경 = 전체 / `disconnected` = connection만 / `hello` = stateLog/intent / `disconnect()` = connection만.

### 5. 모션 컨트롤러 — `WebMotionController.ts` + `motionRegistry.ts`

`MotionController` 인터페이스 구현 (시그니처 잠금).

- `motionRegistry.ts`: 각 모션 (5개)의 정확한 duration ms metadata + GIF 경로
  - `sit: 1500ms`, `stand: 1200ms`, `jump: 800ms`, `roll_left: 2000ms`, `roll_right: 2000ms` (실제 값은 애셋 도착 시 확정)
  - `idle: loop` (duration X, 항상 재생)
- `play(intent, ms, cid)` → DOM 애셋 `key={cid}` force-remount + `setTimeout(ms)` 후 `completed` 이벤트
- ESP duration만 신뢰 (브라우저는 GIF cycle 노출 X)
- 같은 cid 두 번 → 두 번째 무시
- 다른 cid 진행 중 → 현재 motion `cancelled{superseded}` 후 새로 시작
- `stop()` → `cancelled{stop_called}` + idle 복귀

### 6. UI 컴포넌트 (6개) — `components/`

| 컴포넌트 | 항상 보임? | 위치 | 책임 |
|---|---|---|---|
| `NubjukViewer` | ✅ 항상 mount | 메인 하단 (vertical drop 끝) | idle.gif default, motion 시 GIF 교체 + force-remount, ESP duration progress bar |
| `VoiceVisualizer` (신규) | ✅ 항상 visible | 메인 상단 | listening 시 waveform/orb 활성, 다른 state 시 idle pulse, wake 펄스 흘러내리기 트리거 |
| `IntentPanel` | ✅ 항상 visible | 메인 중앙 | `lastIntent` reveal (타이핑) + confidence bar, 빈 상태 placeholder, rejected 시 reason |
| `CommandFlow` (신규) | ✅ background layer | 메인 전체 | wake → intent → state → motion command가 넙죽이로 *흘러가는* SVG/CSS 시각화 |
| `StateLog` | `?dev=1`만 | dev 사이드바 | cyclic 20 메시지 append, 새 entry flash |
| `DebugButtons` | `?dev=1`만 | dev 사이드바 | 5개 intent 버튼, manual_trigger 송신, `error{manual_trigger_disabled}` 시 비활성 + 토스트 |

신규 컴포넌트 (`VoiceVisualizer`, `CommandFlow`)는 store **read-only 구독**. dispatch 호출 X. 잠금 인터페이스 위반 X.

### 7. ESP host 입력 — `resolveEspHost.ts`

우선순위: query `?host=` → localStorage → env `NEXT_PUBLIC_ESP_HOST` → in-app modal UI.

정규화: trim, `ws://`/`http://`/`https://` 제거, path 제거, IPv6 `[::1]:80` 허용, port 기본 80, 정규식 `^([a-z0-9.-]+|\[[0-9a-f:]+\])(:\d+)?$`. successful connect 시 localStorage 저장.

### 8. 부팅 조립 — `app/page.tsx`

```typescript
"use client";
const espHost = resolveEspHost();
const isMock = useSearchParams().get("mock") === "1";
const isDev  = useSearchParams().get("dev") === "1";

const conn = isMock
  ? new MockViewerConnection(loadSequence("sit-success"))
  : new WebSocketViewerConnection();
const motion = new WebMotionController();
const store = createViewerStore();
const dispatcher = new IntentDispatcher(conn, motion, store);

useEffect(() => {
  conn.connect(`ws://${espHost}/viewer`);
  return () => conn.disconnect();
}, []);
```

`useSearchParams()` 는 client-only (SSR snapshot 회피, hydration mismatch 방지).

---

## 디자인 토큰 (inline DESIGN.md 대안)

| Token | Value | 용도 |
|---|---|---|
| `--bg` | `#fafafa` | 페이지 배경 |
| `--surface` | `#ffffff` | 카드/패널 |
| `--fg` | `#0a0a0a` | 본문 |
| `--fg-dim` | `#6b7280` | 보조 텍스트 |
| `--accent` | `#ff6b35` | 주황 — wake 펄스, intent reveal, confidence fill, motion 진행 |
| `--accent-soft` | `#fff0e8` | 펄스 trail, hover bg |
| `--success` | `#10b981` | connection ✓, motion_completed |
| `--error` | `#ef4444` | rejected, motion_failed, protocol error |
| `--border` | `#e5e7eb` | divider, button border |

**Type**: `Pretendard` (한글 친화 sans, 본문) + `JetBrains Mono` (state log, debug, correlation_id).
**Type scale**: 12 / 14 / 16 / 20 / 28 / 40 (mobile-first compact).
**Spacing**: 4-base (4 / 8 / 12 / 16 / 24 / 32 / 48 / 64).
**Radius**: 4 / 8 / 16 / full.
**Shadow**: 거의 없음. 단 `--shadow-pulse: 0 0 24px var(--accent-soft)` glow 1개.

---

## Interaction state matrix

| Surface | loading | empty | error | partial | success |
|---|---|---|---|---|---|
| Connection badge | "ESP 연결 중…" + spinner | — | "연결 실패" + retry 카운트 | "재연결 중 (백오프 5s)" | "● 연결됨" success |
| VoiceVisualizer | idle pulse 호흡 | (n/a) | (n/a) | listening: live waveform | wake 펄스 → intent로 흘러감 |
| IntentPanel | (n/a) | "…명령을 기다리는 중" dim | rejected: "인식 실패 — `<reason>`" | (atomic) | intent 타이핑 + confidence scaleX |
| NubjukViewer | placeholder skeleton | idle.gif | motion_failed: idle.gif + X 오버레이 3s | motion GIF + ESP duration progress | motion_completed: idle.gif 복귀 |
| StateLog (dev) | (n/a) | "이벤트 없음" | (n/a) | (n/a) | append + 0.4s flash |
| DebugButtons (dev) | (n/a) | DEV_MODE 비빌드 시 disabled | `manual_trigger_disabled` 토스트 | (n/a) | 클릭 펄스 + 송신 |
| Protocol error toast | (n/a) | (n/a) | "스키마 위반 (count: N)" 우상단 3s | (n/a) | (n/a) |

---

## Responsive

| Breakpoint | 폭 | Layout |
|---|---|---|
| mobile | < 640px | Vertical drop, padding 16px, waveform 200px, GIF max 320×320, `?dev=1` = 풀스크린 modal |
| tablet | 640–1023px | max-width 480px center, waveform 240px, GIF 360×360, `?dev=1` = 우측 sidebar 320px |
| desktop | ≥ 1024px | max-width 480px center, `?dev=1` = 우측 고정 sidebar 360px |

최소 폭 보장 320px. 이하는 `overflow-x: auto`.

---

## A11y

- **Keyboard**: DebugButtons 5개 Tab 순회, focus ring `outline: 2px solid var(--accent)`, ESC = dev modal 닫기 (mobile)
- **ARIA live**: VoiceVisualizer (`role="status"` polite), IntentPanel (polite), Connection badge (polite), Protocol error toast (`role="alert"`)
- **alt text**: NubjukViewer img — `alt={\`넙죽이 ${currentMotion ?? "대기 중"} 모션\`}`
- **Contrast**: body text vs `--bg` ≥ 4.5:1. accent 작은 text 금지 (3.57:1만, 18px+ bold만 OK)
- **Touch target**: DebugButtons 44×44px 이상
- **Reduced motion**: `prefers-reduced-motion: reduce` → 펄스/transition 0.01ms, GIF poster 옵션 검토
- **Color is not the only signal**: connection/motion 상태는 색상 + 텍스트 라벨
- `<html lang="ko">`, user-facing 텍스트 한국어 (debug 상수만 영문 OK)

---

## Phase 2 Gate 매핑 (PHASES.md 변경 X)

PHASES.md "Phase 2 Gate" 모든 체크박스 통과 + 다음 추가 success criteria:

- [ ] `viewer.local/` = 깔끔한 showcase 화면
- [ ] `?dev=1` = 사이드바 펼침 (StateLog, DebugButtons, connection 정보)
- [ ] `?mock=1` = MockViewerConnection 주입 + 미리 녹음 시퀀스 자동 재생
- [ ] mock 시퀀스 5개 모두 결정적 재생
- [ ] 시연 URL 한 줄로 친구/관객 공유 가능

---

## Open Questions (구현 단계 결정)

- [ ] **VoiceVisualizer 시각 라이브러리**: SVG path morphing vs Canvas frame loop vs CSS-only pulse → prototype 3개 비교 후 결정
- [ ] **CommandFlow 구현 방식**: SVG path + `stroke-dashoffset` vs absolute pulse dots + CSS transition vs Canvas → layout 결정 후 따라옴
- [ ] **idle GIF 애셋**: `public/motions/idle.gif` 신규 필요 (호흡 루프). placeholder로 시작, 도착 시 교체
- [ ] **모션 GIF 5개**: 도착 전까지 placeholder
- [ ] **`?demo=1` 자동 재생 모드**: mock 시퀀스 부팅 시 자동 재생 vs 버튼 트리거 → Phase 2 ship 후 결정

---

## 첫 PR (이번 주)

**The Assignment**: `MockViewerConnection.ts` + 메시지 시퀀스 `.json` 5개 작성. UI 코드 0줄. *결정적 시연 시퀀스*가 잠기면 나머지는 재미만 남는다.

이후 PR 순서: `WebMotionController` + `motionRegistry` (idle.gif placeholder) → `ViewerStore` + `IntentDispatcher` → UI 컴포넌트 4 + 신규 2 → `WebSocketViewerConnection` (실제 ESP 통합).
