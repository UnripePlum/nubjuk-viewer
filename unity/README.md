# Phase 5 — Unity 3D viewer port

> 이 디렉토리는 **viewer 모듈의 C# 1:1 이식체**입니다. 기존 `viewer/src/` (Next.js + TypeScript)와 같은 인터페이스 / 같은 동작 / 같은 store 모델을 Unity 위에서 재현합니다.

격리 규칙: viewer/CLAUDE.md 따라 `viewer/unity/`는 viewer 세션 안에서 read/write 자유. mcu/brain/schemas는 여전히 잠금.

---

## 디렉토리

```
viewer/unity/
├── README.md (이 문서)
├── Assets/
│   ├── Scripts/
│   │   ├── types/
│   │   │   └── Protocol.cs              # EspMessage / ViewerCommand / FsmState / MotionFailReason
│   │   ├── ws/
│   │   │   ├── IViewerConnection.cs     # 잠금 인터페이스 (TS와 의미 일치)
│   │   │   ├── WebSocketViewerConnection.cs  # NativeWebSocket 래퍼
│   │   │   └── MockViewerConnection.cs  # 테스트/parity용
│   │   ├── controller/
│   │   │   ├── IMotionController.cs     # 잠금 인터페이스 (settle 포함, ESP-as-truth)
│   │   │   ├── UnityMotionController.cs # Animator 트리거 + 시각 재생
│   │   │   └── MockMotionController.cs  # 테스트 spy
│   │   ├── motion/
│   │   │   └── IntentDispatcher.cs      # 메시지 dispatch 매트릭스 (TS 동일)
│   │   ├── store/
│   │   │   └── ViewerStore.cs           # 단일 진실원 (TS 동일 reset 규칙)
│   │   └── components/
│   │       └── NubjukController.cs      # MonoBehaviour orchestrator
│   ├── Models/                          # 3D 모델 (사용자 추가)
│   ├── Animations/                      # 모션 클립 (사용자 추가)
│   └── Scenes/
│       └── ViewerScene.unity            # 메인 씬
└── ProjectSettings/                     # Unity가 생성
```

---

## 결정 사항 (사용자 입력 필요)

| 항목 | 옵션 | 권장 |
|------|------|------|
| Unity 버전 | 2022 LTS / 2023 / Unity 6 | **Unity 6 LTS** (최신 .NET, NativeWebSocket 호환) |
| WS 라이브러리 | NativeWebSocket / WebSocketSharp | **NativeWebSocket** (WebGL 빌드 지원 + 모던) |
| 3D 모델 | 사용자 준비 / placeholder cube | 초기는 placeholder cube → 모델 추가 시 교체 |
| Animator 구조 | trigger 기반 / state machine | **trigger 기반** (motion 단발 재생, 인터럽션 친화) |

### 언어 / 런타임 baseline

- **Unity 6 LTS** (= Unity 6000.0+) — `.NET Standard 2.1` API 면, 컴파일러 옵션에서 C# 9 (records, init, pattern matching) 활성화.
- `System.Text.Json` 사용 — Unity 6의 NuGetForUnity 또는 패키지로 설치. .NET 7+ `JsonPolymorphic`, `JsonDerivedType` 사용.
- `required` 키워드(C# 11)는 **사용 안 함** — Unity 2022/2023 호환 위해.
- `with` expression (C# 9 record) 사용 — Unity 6 OK.

만약 Unity 2022 LTS (.NET Standard 2.1) 타깃이면 `JsonPolymorphic` 부분이 미동작 — 별도 polymorphic JsonConverter 작성 필요. 이 경우 5.2 진입 시 추가 구현.

이 디렉토리는 Unity Editor가 없어도 plain C# 부분은 dotnet CLI로 컴파일 검증 가능 (`dotnet new classlib` 후 파일 복사). Unity-dep 부분 (Animator, MonoBehaviour, NativeWebSocket)은 실제 Unity 환경에서만 동작.

---

## 이식 매핑 (TS → C#)

| TS 파일 | C# 파일 | 변환 노트 |
|---------|---------|----------|
| `src/types/protocol.ts` | `types/Protocol.cs` | discriminated union → abstract record + sealed subtypes |
| `src/ws/ViewerConnection.ts` | `ws/IViewerConnection.cs` | interface 시그니처 그대로 (Subscription = IDisposable) |
| `src/ws/WebSocketViewerConnection.ts` | `ws/WebSocketViewerConnection.cs` | browser WebSocket → NativeWebSocket. timer = `IEnumerator` coroutine 또는 `System.Timers.Timer` |
| `src/controller/MotionController.ts` | `controller/IMotionController.cs` | 인터페이스 그대로. `Settle(MotionSettleResult)` 동일 시그니처 |
| `src/controller/WebMotionController.ts` | `controller/UnityMotionController.cs` | timer = watchdog만, `Animator.SetTrigger` |
| `src/motion/intentDispatcher.ts` | `motion/IntentDispatcher.cs` | switch + cid stale 검증 동일 |
| `src/store/viewerStore.ts` | `store/ViewerStore.cs` | useSyncExternalStore → C# event/Action 또는 ScriptableObject |

---

## Parity 검증

Phase 5 Gate: **TS와 C# 양쪽에서 같은 ESP 메시지 시퀀스 입력 시 동일 store 결과**.

### Wire 호환

ESP가 보내는 JSON은 snake_case + string-literal enum (`{"type":"motion_started","payload":{"intent":"sit","expected_duration_ms":700}}`).
C# Protocol.cs는 PascalCase + 강타입 enum이지만 `types/Wire.cs`의 `Wire.Options` (`SnakeCaseLowerNamingPolicy` + `JsonStringEnumConverter` + `JsonPolymorphic`)로 자동 매핑:
- `IntentRecognized` ↔ `"intent_recognized"`
- `EStop` ↔ `"e_stop"`
- `expected_duration_ms` ↔ `ExpectedDurationMs`
- 다형 deserialization은 `[JsonDerivedType]`이 `"type"` 필드 보고 subclass 선택

`WebSocketViewerConnection.cs`는 `JsonSerializer.Deserialize<EspMessage>(json, Wire.Options)` / `JsonSerializer.Serialize(cmd, Wire.Options)` 사용. **모든 (de)serialization 경로는 `Wire.Options` 거쳐야 함.**

### 파리티 스냅샷 (5.4 task)

C# 내부 store state는 `ConnectionState.Connected` / 강타입 enum으로 표현되는 반면 TS store state는 `{kind:"connected", url:"..."}` 형태. 직접 JSON diff 불가. **canonical wire snapshot serializer**가 필요:

`store/SnapshotSerializer.cs` (5.4에서 작성):
- ViewerStoreState → JSON (snake_case keys, enum-as-string, ADT를 `{kind:"...", ...}`로 평탄화)
- TS도 동일 canonical schema로 직렬화 (이미 가능 — store state가 JSON-friendly)
- 두 JSON 비교

이렇게 하면 wire-level parity까지 보장.

이 파리티 테스트는 `viewer/unity/Tests/` (Unity Test Framework) 또는 별도 dotnet xUnit/NUnit 프로젝트로 작성.

---

## Phase 5 진행 단계

- [x] 디렉토리 스캐폴딩
- [x] **5.1 Plain C# 부분 작성** — types/, store/, motion/IntentDispatcher, controller/IMotionController, MockMotionController (Unity-dep 없음, dotnet 또는 Unity 어디서나 컴파일 가능)
- [ ] **5.2 Unity-dep 부분** — Animator-driven UnityMotionController, NativeWebSocket-기반 WebSocketViewerConnection (Unity 6 + NativeWebSocket 패키지 필요)
- [ ] **5.3 Scene + NubjukController** — MonoBehaviour orchestrator + Inspector 구성
- [ ] **5.4 Parity 테스트** — TS↔C# 동일 시퀀스 결과 검증

### 작성된 파일 (5.1)

| 파일 | 책임 | TS 대응 |
|------|------|--------|
| `types/Protocol.cs` | enum + record EspMessage/ViewerCommand 1:1 | `src/types/protocol.ts` |
| `ws/IViewerConnection.cs` | 잠금 인터페이스 + ConnectionState ADT + ProtocolErrorEvent | `src/ws/ViewerConnection.ts` |
| `controller/IMotionController.cs` | 잠금 인터페이스 + MotionEvent ADT + MotionSettleResult ADT (Phase 2 settle 포함) | `src/controller/MotionController.ts` |
| `store/ViewerStore.cs` | 단일 진실원 + ApplyEspMessage / ApplyMotionEvent + boot_id 전체 reset / hello session reset 규칙 | `src/store/viewerStore.ts` |
| `motion/IntentDispatcher.cs` | 메시지 dispatch matrix + stale cid 거부 → Settle | `src/motion/intentDispatcher.ts` |
| `controller/MockMotionController.cs` | timer-less spy + getSettleCalls() | `src/controller/MockMotionController.ts` |

### 검증 옵션

이 디렉토리는 dotnet CLI가 없어 Claude Code 환경에서 직접 컴파일 검증 불가. 사용자가 Unity Editor 또는 dotnet SDK 환경에서 검증:

```bash
# dotnet 환경 (plain C# 부분만)
dotnet new classlib -n NubjukViewerCore -o /tmp/nubjuk-test
cp -r unity/Assets/Scripts/* /tmp/nubjuk-test/
cd /tmp/nubjuk-test && dotnet build
```

또는 Unity Editor에서 자동 컴파일.

### 다음 결정 (5.2 진입 전)

1. **Unity 버전** — Unity 6 LTS 사용 OK?
2. **NativeWebSocket 패키지** 설치 (Package Manager → `https://github.com/endel/NativeWebSocket.git`)
3. **3D 모델** — placeholder cube로 시작? 또는 사전 준비된 모델 있음?
4. **dotnet SDK 설치** — plain C# 단위 테스트 위해

---

## TODOS (Phase 5.x deferred)

eng-review에서 식별된 후속 작업. 완료 시 이 섹션에서 제거.

- [ ] **5.2 진입** — `WebSocketViewerConnection.cs` (NativeWebSocket dep) + `UnityMotionController.cs` (Animator + watchdog) + `NubjukController.cs` (MonoBehaviour orchestrator). Unity 버전 확정 후.
- [ ] **5.4 parity test 우선화** — TS와 C# 양쪽 `SnapshotSerializer` (canonical wire JSON: snake_case + enum string + ADT `{kind:"..."}`로 평탄화). 5개 mock sequence 동치성 검증. **5.2 직후로 앞당김** (C# 0% coverage = critical gap).
- [ ] **`ViewerStore.Subscribe` token-based unsubscribe** — 현재 `Action` reference equality 의존 → lambda inline 시 leak 가능. Token 반환하는 API로 교체. TS 측도 같은 패턴 (Set<Handler> + dispose) 검토.
- [ ] **`MockViewerConnection.ts` 단위 테스트** — 333줄, 0 coverage. sequence 재생, version-token cancellation, manual_trigger 합성 음성 사이클. 회귀 위험.
- [ ] **GIF preload** — 첫 motion 재생 시 cold load → frame 1 지연. `<link rel="preload" as="image">` 7개 GIF.

---

## Eng review 적용 history

- 2026-04-30 Lane A — Codex Phase 5.1 NEEDS_FIX 5건 + plan-eng-review 4건 적용. JSON wire mapping (Wire.Options + JsonPolymorphic), `MotionEvent`/`MotionSettleResult` 적절한 record 상속 (CorrelationId shadowing 제거), `IntentDispatcher` default case (silent drop 방지), `Wire.Serialize/Deserialize` 헬퍼만 노출 (Options 우회 차단).
