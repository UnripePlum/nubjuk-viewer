# nubjuk-viewer — Claude Code 작업 규칙 (viewer 세션 전용)

## 모듈 책임 (한 줄)
**개발·디버깅 전용** viewer. 마이크 없음. ESP의 WS 서버에 연결해 FSM 상태와 motion을 시각화. Phase 2~4 web (Next.js) → Phase 5 Unity → Phase 6 폐기 또는 read-only.

상세 아키텍처는 `ARCHITECTURE.md` 참고.

---

## 🚧 격리 규칙 (cwd = viewer/)

| 허용 | 금지 |
|------|------|
| `viewer/**` (이 모듈 전체 read/write) | `mcu/**`, `brain/**` (다른 모듈) |
| `docs/**` (read; protocol/*.md는 잠금) | `schemas/**` (잠금) |
| | `README.md`, root `CLAUDE.md` |

mcu/brain의 동작이 궁금하면 **`docs/protocol/mcu-viewer.md`만** 참고. 다른 모듈 코드 보지 말 것.

---

## 🔒 잠금 정책

다음 파일의 시그니처·타입 export·페이로드 구조는 사용자 명시 승인 없이 변경 불가.

### 모듈 내부 인터페이스 (잠금, TS)
- `viewer/src/ws/ViewerConnection.ts` — `ViewerConnection` (test seam)
- `viewer/src/controller/MotionController.ts` — `MotionController` (mcu와 같은 개념)

→ **정확한 시그니처는 `INTERFACES.md`**.

### 통신 계약 (잠금, 외부)
- `docs/protocol/mcu-viewer.md` — ESP↔viewer WS 메시지 계약

### 행동 contract (잠금)
- ESP가 단일 진실원 — viewer는 자체 상태 추론·timeout 정책 X
- correlation_id 기반 stale 메시지 거부 — `getCurrentCorrelationId()` 비교 후 dispatch
- ESP-provided duration만 사용 — 브라우저가 GIF cycle 종료를 노출하지 않으므로 자체 추론 X
- 단일 store (`ViewerStore`)에 모든 상태 — 컴포넌트가 직접 dispatch 호출 X
- Subscription 기반 다중 핸들러 — `dispose()`로 명시적 해제 (메모리 누수 방지)

---

## 작업 원칙

1. **인터페이스 시그니처를 바꿔야 한다고 느끼면 STOP** — 사용자에게 확인 후 진행
2. **새 기능은 새 구현체로** — `MotionController` / `ViewerConnection` 새 클래스 추가 자유
3. **Phase 진행은 `PHASES.md` 따름**
4. **모든 메시지는 `docs/protocol/mcu-viewer.md` 계약 따름** — schema 위반 시 protocol error로 분류
5. **테스트 가능성 우선**: `MockViewerConnection`, `MockMotionController` 항상 동시 존재
6. **워킹 디렉토리 밖은 손대지 말 것** (위 격리 규칙)

### 격리가 깨지는 신호 (즉시 STOP, 사용자 확인)

- 인터페이스 시그니처 (`ViewerConnection`, `MotionController`) 변경 필요
- protocol 파일 내용 변경 필요
- `schemas/` 변경 필요
- ESP 동작 추측 / 새 메시지 타입 발명 필요
- ARCHITECTURE.md의 dispatch 매트릭스 / store reset 규칙 변경 필요
- 자체 timeout으로 ESP duration 무시하려는 충동

---

## 문서 인덱스

| 파일 | 내용 |
|------|------|
| `CLAUDE.md` (이 파일) | 작업 규칙 + 잠금 정책 |
| `ARCHITECTURE.md` | 컴포넌트 다이어그램, 메시지 dispatch 매트릭스, 상태 모델, 라이프사이클 |
| `INTERFACES.md` | 잠금된 TS 인터페이스 시그니처 (source of truth) |
| `PHASES.md` | Phase 0~6 구현 task + Gate 기준 |
| `docs/protocol/mcu-viewer.md` | ESP↔viewer WS 메시지 계약 (잠금, read-only) |
