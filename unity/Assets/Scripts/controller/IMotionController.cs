// IMotionController — viewer/INTERFACES.md MotionController의 C# 1:1 이식.
// 잠금 인터페이스 — Phase 2에서 ESP-as-truth로 settle() 추가됨 (TS와 동일).
//
// Lifecycle 규칙:
//   - PlayAsync()는 시각 재생 시작 + Started event emit. terminal 권위 X.
//   - terminal은 Settle(MotionSettleResult)로만. dispatcher가 stale cid 거부 후 호출.
//   - 같은 correlationId로 Play 두 번 → idempotent (두 번째 무시).
//   - 다른 correlationId Play (진행 중) → 현재 motion에 Cancelled(Superseded) 발화 후 새로 시작.
//   - Stop() → local cancellation only. Cancelled(StopCalled) emit. ESP에 통보 X.
//   - Settle() cid 불일치 → no-op (방어적, dispatcher가 1차 거부).
//   - impl은 ESP 무응답 대비 watchdog 가질 수 있음 (UnityMotionController는 expectedMs * 2 + grace 후 Failed{Timeout})
//     단, expectedMs 도달만으로 자체 Completed emit 금지 (ESP 권위 위반).

#nullable enable

using System;
using Nubjuk.Viewer.Types;
using Nubjuk.Viewer.Ws;

namespace Nubjuk.Viewer.Controller
{
    // 공통 CorrelationId를 base positional ctor로 — subclass는 :MotionEvent(CorrelationId) 위임.
    // 이렇게 해야 base.CorrelationId와 subclass의 CorrelationId가 같은 property가 됨 (shadowing X).
    public abstract record MotionEvent(string CorrelationId)
    {
        public sealed record Started(string CorrelationId, IntentName Intent, long ExpectedMs)
            : MotionEvent(CorrelationId);

        public sealed record Completed(string CorrelationId, long ActualMs)
            : MotionEvent(CorrelationId);

        public sealed record Failed(string CorrelationId, MotionFailReason Reason)
            : MotionEvent(CorrelationId);

        public sealed record Cancelled(string CorrelationId, CancelReason Reason)
            : MotionEvent(CorrelationId);
    }

    public enum CancelReason
    {
        StopCalled,
        Superseded,
    }

    public abstract record MotionSettleResult(string CorrelationId)
    {
        public sealed record Completed(string CorrelationId, long ActualMs)
            : MotionSettleResult(CorrelationId);

        public sealed record Failed(string CorrelationId, MotionFailReason Reason)
            : MotionSettleResult(CorrelationId);
    }

    public interface IMotionController
    {
        // 시각 재생 시작 + Started event emit. terminal 권위 X — Completed/Failed는 Settle()로만.
        System.Threading.Tasks.Task PlayAsync(IntentName intent, long durationMs, string correlationId);

        // ESP terminal 결과 inject. Completed/Failed event를 emit.
        // stale cid는 dispatcher가 거른 후 호출. impl은 cid 불일치 시 no-op.
        void Settle(MotionSettleResult result);

        // local cancellation only. Cancelled(StopCalled) emit.
        void Stop();

        bool IsPlaying();
        string? GetCurrentCorrelationId();

        ISubscription OnEvent(Action<MotionEvent> handler);
    }
}
