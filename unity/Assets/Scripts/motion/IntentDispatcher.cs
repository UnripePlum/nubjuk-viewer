// IntentDispatcher — viewer/src/motion/intentDispatcher.ts의 C# 1:1 이식.
// ESP→viewer 메시지 단일 진입점. ARCHITECTURE.md dispatch matrix 동일.
//
// 흐름 (TS와 동일):
//   IViewerConnection.OnMessage → Dispatch(msg)
//   ┌── hello/state/intent/heartbeat/error → store.ApplyEspMessage
//   ├── motion_started → store.ApplyEspMessage + motion.PlayAsync
//   ├── motion_completed → cid stale 검증 → motion.Settle({Completed, ActualMs})
//   └── motion_failed   → cid stale 검증 → motion.Settle({Failed, Reason})
//
//   IMotionController.OnEvent → store.ApplyMotionEvent

#nullable enable

using System;
using System.Collections.Generic;
using Nubjuk.Viewer.Controller;
using Nubjuk.Viewer.Store;
using Nubjuk.Viewer.Types;
using Nubjuk.Viewer.Ws;

namespace Nubjuk.Viewer.Motion
{
    public sealed class IntentDispatcher : IDisposable
    {
        private readonly IViewerConnection _conn;
        private readonly IMotionController _motion;
        private readonly ViewerStore _store;
        private readonly List<ISubscription> _subs = new();

        public IntentDispatcher(IViewerConnection conn, IMotionController motion, ViewerStore store)
        {
            _conn = conn;
            _motion = motion;
            _store = store;
            _subs.Add(_conn.OnMessage(Dispatch));
            _subs.Add(_conn.OnConnectionChange(_store.SetConnectionState));
            _subs.Add(_conn.OnProtocolError(err =>
                _store.RecordProtocolError($"[{err.Kind}] {err.Message}")));
            _subs.Add(_motion.OnEvent(_store.ApplyMotionEvent));
        }

        public void Dispose()
        {
            foreach (var s in _subs) s.Dispose();
            _subs.Clear();
        }

        private void Dispatch(EspMessage msg)
        {
            _store.ApplyEspMessage(msg);

            switch (msg)
            {
                case MotionStartedMessage started:
                    // controller가 watchdog + Started event 책임. 같은 cid 두 번은 idempotent.
                    _ = _motion.PlayAsync(started.Payload.Intent, started.Payload.ExpectedDurationMs, started.CorrelationId);
                    break;

                case MotionCompletedMessage completed:
                    {
                        var currentCid = _motion.GetCurrentCorrelationId();
                        if (currentCid != null && currentCid != completed.CorrelationId)
                        {
                            _store.RecordProtocolError(
                                $"stale motion_completed cid={completed.CorrelationId} (current={currentCid})");
                            break;
                        }
                        // ESP terminal authority — Settle이 watchdog 정리 + Completed event emit.
                        _motion.Settle(new MotionSettleResult.Completed(
                            CorrelationId: completed.CorrelationId,
                            ActualMs: completed.Payload.ActualDurationMs));
                        break;
                    }

                case MotionFailedMessage failed:
                    {
                        var currentCid = _motion.GetCurrentCorrelationId();
                        if (currentCid != null && currentCid != failed.CorrelationId)
                        {
                            _store.RecordProtocolError(
                                $"stale motion_failed cid={failed.CorrelationId} (current={currentCid})");
                            break;
                        }
                        _motion.Settle(new MotionSettleResult.Failed(
                            CorrelationId: failed.CorrelationId,
                            Reason: failed.Payload.Reason));
                        break;
                    }

                // hello/state/intent/heartbeat/error는 store가 자체 처리
                case HelloMessage:
                case StateMessage:
                case IntentMessage:
                case ErrorMessage:
                case HeartbeatMessage:
                    break;

                // 미래에 새 EspMessage subtype이 추가되어 dispatch 누락 시 silent drop 방지.
                // C# abstract record는 exhaustiveness 컴파일 검사 X — runtime 가드 필요.
                default:
                    _store.RecordProtocolError(
                        $"unhandled message type in dispatcher: {msg.GetType().Name}");
                    break;
            }
        }
    }
}
