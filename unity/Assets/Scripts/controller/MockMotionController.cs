// MockMotionController — viewer/src/controller/MockMotionController.ts의 C# 1:1 이식.
// 단위 테스트 / parity test용 spy. timer 없음 — 모든 lifecycle은 명시적 호출로만.
// 테스트가 Settle/Stop을 직접 부르고 emit된 event 시퀀스를 검증.

#nullable enable

using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Nubjuk.Viewer.Types;
using Nubjuk.Viewer.Ws;

namespace Nubjuk.Viewer.Controller
{
    public sealed class MockMotionController : IMotionController
    {
        private MockActive? _active;
        private readonly List<Action<MotionEvent>> _handlers = new();
        private readonly List<MotionEvent> _events = new();
        private readonly List<MotionSettleResult> _settleCalls = new();

        public IReadOnlyList<MotionEvent> GetEvents() => _events;
        public IReadOnlyList<MotionSettleResult> GetSettleCalls() => _settleCalls;

        public void ResetSpy()
        {
            _active = null;
            _events.Clear();
            _settleCalls.Clear();
        }

        public Task PlayAsync(IntentName intent, long durationMs, string correlationId)
        {
            if (_active != null && _active.CorrelationId == correlationId)
            {
                return Task.CompletedTask;
            }
            if (_active != null)
            {
                var prev = _active;
                _active = null;
                Emit(new MotionEvent.Cancelled(prev.CorrelationId, CancelReason.Superseded));
            }
            _active = new MockActive(intent, durationMs, correlationId, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            Emit(new MotionEvent.Started(correlationId, intent, durationMs));
            return Task.CompletedTask;
        }

        public void Settle(MotionSettleResult result)
        {
            // 호출 자체 기록 (mismatched cid no-op도 포함) — dispatcher 회귀 가드.
            _settleCalls.Add(result);
            if (_active == null || _active.CorrelationId != result.CorrelationId) return;
            var cid = _active.CorrelationId;
            _active = null;
            switch (result)
            {
                case MotionSettleResult.Completed completed:
                    Emit(new MotionEvent.Completed(cid, completed.ActualMs));
                    break;
                case MotionSettleResult.Failed failed:
                    Emit(new MotionEvent.Failed(cid, failed.Reason));
                    break;
            }
        }

        public void Stop()
        {
            if (_active == null) return;
            var prev = _active;
            _active = null;
            Emit(new MotionEvent.Cancelled(prev.CorrelationId, CancelReason.StopCalled));
        }

        public bool IsPlaying() => _active != null;
        public string? GetCurrentCorrelationId() => _active?.CorrelationId;

        public ISubscription OnEvent(Action<MotionEvent> handler)
        {
            _handlers.Add(handler);
            return new SubscriptionImpl(() => _handlers.Remove(handler));
        }

        private void Emit(MotionEvent ev)
        {
            _events.Add(ev);
            // 핸들러 변경 중 호출 방지를 위해 snapshot 순회
            var snapshot = _handlers.ToArray();
            foreach (var h in snapshot) h(ev);
        }

        private sealed record MockActive(IntentName Intent, long DurationMs, string CorrelationId, long StartedAtMs);

        private sealed class SubscriptionImpl : ISubscription
        {
            private readonly Action _dispose;
            private bool _disposed;
            public SubscriptionImpl(Action dispose) { _dispose = dispose; }
            public void Dispose()
            {
                if (_disposed) return;
                _disposed = true;
                _dispose();
            }
        }
    }
}
