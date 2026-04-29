// ViewerStore — viewer/src/store/viewerStore.ts의 C# 1:1 이식.
// 단일 진실원 (TS와 동일 reset 규칙).
//
// Reset 규칙:
//   boot_id 변경      → 전체 reset
//   WS Disconnected   → connection만 reset, history 유지
//   connected + hello → 새 session, stateLog/lastIntent reset (lastBrainUnreachableAt 포함)
//   Disconnect()      → connection만 reset

#nullable enable

using System;
using System.Collections.Generic;
using Nubjuk.Viewer.Controller;
using Nubjuk.Viewer.Types;
using Nubjuk.Viewer.Ws;

namespace Nubjuk.Viewer.Store
{
    public enum MotionUiStatus
    {
        Started,
        Completed,
        Failed,
        Cancelled,
    }

    // "현재 또는 마지막 시작된 motion" — terminal 후에도 유지 (UI Chip 표시용).
    public sealed record ActiveMotion(
        IntentName Name,
        long DurationMs,
        string CorrelationId,
        long StartedAtMs);

    // pose 분류 (TS pose-engine.ts와 동일)
    public enum Pose
    {
        Idle,
        Sit,
        Hand,
    }

    public sealed record ProtocolErrors(int Count, IReadOnlyList<string> Recent);

    public sealed record ViewerStoreState(
        ConnectionState ConnectionState,
        string? BootId,
        FsmState? CurrentState,
        IntentMessage? LastIntent,
        IReadOnlyList<StateMessage> StateLog,
        ProtocolErrors ProtocolErrors,
        ActiveMotion? ActiveMotion,
        MotionUiStatus? MotionStatus,
        MotionFailReason? MotionFailReason,
        Pose CurrentPose,
        IReadOnlyList<EspMessage> RecentMessages,
        long? LastBrainUnreachableAtMs);

    public sealed class ViewerStore
    {
        private const int StateLogLimit = 20;
        private const int ProtocolErrLimit = 8;
        private const int RecentMsgLimit = 10;

        private static readonly ViewerStoreState InitialState = new(
            ConnectionState: new ConnectionState.Idle(),
            BootId: null,
            CurrentState: null,
            LastIntent: null,
            StateLog: Array.Empty<StateMessage>(),
            ProtocolErrors: new ProtocolErrors(0, Array.Empty<string>()),
            ActiveMotion: null,
            MotionStatus: null,
            MotionFailReason: null,
            CurrentPose: Pose.Idle,
            RecentMessages: Array.Empty<EspMessage>(),
            LastBrainUnreachableAtMs: null);

        private ViewerStoreState _state = InitialState;
        private readonly List<Action> _listeners = new();

        public ViewerStoreState GetSnapshot() => _state;

        public IDisposable Subscribe(Action listener)
        {
            _listeners.Add(listener);
            return new SubscriptionImpl(() => _listeners.Remove(listener));
        }

        // ───── connection ─────
        public void SetConnectionState(ConnectionState next)
        {
            // disconnected/rejected: connection만 갱신, history 유지
            Update(s => s with { ConnectionState = next });
        }

        // ───── ESP messages ─────
        public void ApplyEspMessage(EspMessage msg)
        {
            RecordRecent(msg);

            switch (msg)
            {
                case HelloMessage hello:
                    ApplyHello(hello.BootId, hello.Payload.CurrentState);
                    break;
                case StateMessage state:
                    ApplyState(state);
                    break;
                case IntentMessage intent:
                    Update(s => s with { LastIntent = intent });
                    break;
                case MotionStartedMessage:
                case MotionCompletedMessage:
                case MotionFailedMessage:
                    // motion lifecycle은 IntentDispatcher가 별도로 ApplyMotionEvent 호출
                    break;
                case ErrorMessage err:
                    if (err.Payload.Code == ErrorCode.BrainUnreachable)
                    {
                        Update(s => s with { LastBrainUnreachableAtMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() });
                    }
                    break;
                case HeartbeatMessage hb:
                    Update(s => s with { CurrentState = hb.Payload.CurrentState });
                    break;
            }
        }

        private void ApplyHello(string bootId, FsmState currentState)
        {
            Update(s =>
            {
                bool bootIdChanged = s.BootId != null && s.BootId != bootId;
                if (bootIdChanged)
                {
                    return InitialState with
                    {
                        ConnectionState = s.ConnectionState,
                        BootId = bootId,
                        CurrentState = currentState,
                    };
                }
                // 같은 boot_id 또는 첫 hello → session reset
                return s with
                {
                    BootId = bootId,
                    CurrentState = currentState,
                    LastIntent = null,
                    StateLog = Array.Empty<StateMessage>(),
                    ActiveMotion = null,
                    MotionStatus = null,
                    MotionFailReason = null,
                    LastBrainUnreachableAtMs = null,
                };
            });
        }

        private void ApplyState(StateMessage msg)
        {
            Update(s =>
            {
                var newLog = new List<StateMessage>(s.StateLog) { msg };
                if (newLog.Count > StateLogLimit) newLog.RemoveRange(0, newLog.Count - StateLogLimit);
                return s with
                {
                    CurrentState = msg.Payload.To,
                    StateLog = newLog,
                };
            });
        }

        public void ApplyMotionEvent(MotionEvent ev)
        {
            Update(s =>
            {
                var cur = s.ActiveMotion;
                switch (ev)
                {
                    case MotionEvent.Started started:
                        return s with
                        {
                            ActiveMotion = new ActiveMotion(
                                Name: started.Intent,
                                DurationMs: started.ExpectedMs,
                                CorrelationId: started.CorrelationId,
                                StartedAtMs: DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()),
                            MotionStatus = MotionUiStatus.Started,
                            MotionFailReason = null,
                        };

                    case MotionEvent.Completed completed:
                        if (cur == null || cur.CorrelationId != completed.CorrelationId) return s;
                        return s with
                        {
                            MotionStatus = MotionUiStatus.Completed,
                            CurrentPose = NextPose(s.CurrentPose, cur.Name),
                        };

                    case MotionEvent.Failed failed:
                        if (cur == null || cur.CorrelationId != failed.CorrelationId) return s;
                        return s with
                        {
                            MotionStatus = MotionUiStatus.Failed,
                            MotionFailReason = failed.Reason,
                            // pose 유지 (실패 시 advance X)
                        };

                    case MotionEvent.Cancelled cancelled:
                        if (cur == null || cur.CorrelationId != cancelled.CorrelationId) return s;
                        // 이미 terminal status면 무시 (race guard)
                        if (s.MotionStatus == MotionUiStatus.Failed || s.MotionStatus == MotionUiStatus.Completed) return s;
                        return s with { MotionStatus = MotionUiStatus.Cancelled };

                    default:
                        return s;
                }
            });
        }

        // pose-engine.ts와 동일: persistent (sit/hand) → adopt, transient (surprise/roll_*) → keep, reset (idle/stand) → idle
        private static Pose NextPose(Pose current, IntentName completedMotion) => completedMotion switch
        {
            IntentName.Sit => Pose.Sit,
            IntentName.Hand => Pose.Hand,
            IntentName.Idle => Pose.Idle,
            IntentName.Stand => Pose.Idle,
            // transient: roll_left, roll_right, surprise → 현재 pose 유지
            _ => current,
        };

        // ───── protocol errors ─────
        public void RecordProtocolError(string message)
        {
            Update(s =>
            {
                var newRecent = new List<string>(s.ProtocolErrors.Recent) { message };
                if (newRecent.Count > ProtocolErrLimit) newRecent.RemoveRange(0, newRecent.Count - ProtocolErrLimit);
                return s with { ProtocolErrors = new ProtocolErrors(s.ProtocolErrors.Count + 1, newRecent) };
            });
        }

        private void RecordRecent(EspMessage msg)
        {
            Update(s =>
            {
                var newRecent = new List<EspMessage>(s.RecentMessages) { msg };
                if (newRecent.Count > RecentMsgLimit) newRecent.RemoveRange(0, newRecent.Count - RecentMsgLimit);
                return s with { RecentMessages = newRecent };
            });
        }

        public void Reset()
        {
            _state = InitialState;
            Emit();
        }

        // ───── internals ─────
        private void Update(Func<ViewerStoreState, ViewerStoreState> fn)
        {
            var next = fn(_state);
            if (ReferenceEquals(next, _state)) return;
            _state = next;
            Emit();
        }

        private void Emit()
        {
            // listener 변경 중 호출 방지를 위해 snapshot 순회
            var snapshot = _listeners.ToArray();
            foreach (var l in snapshot) l();
        }

        private sealed class SubscriptionImpl : IDisposable
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
