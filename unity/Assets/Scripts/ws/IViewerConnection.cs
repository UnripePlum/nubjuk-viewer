// IViewerConnection — viewer/INTERFACES.md ViewerConnection의 C# 1:1 이식.
// 잠금 인터페이스 — 시그니처 변경 시 사용자 명시 승인 필요 (TS와 동일).
//
// Lifecycle 규칙 (TS와 동일):
//   - Connect 후 GetState()가 Connecting → Connected 또는 Rejected로 전이
//   - 자동 재연결 시 Reconnecting 상태로 진입, 백오프 후 다시 Connecting
//   - Disconnect()는 즉시 Disconnected로 전이, 재연결 시도 안 함
//   - 모든 ISubscription은 Dispose()로 해제 가능 (메모리 누수 방지)
//   - 다중 핸들러 등록 가능 — 각 핸들러는 독립적으로 호출되고 독립적으로 dispose

#nullable enable

using System;
using Nubjuk.Viewer.Types;

namespace Nubjuk.Viewer.Ws
{
    public abstract record ConnectionState
    {
        public sealed record Idle : ConnectionState;
        public sealed record Connecting(string Url) : ConnectionState;
        public sealed record Connected(string Url, long SessionStartTs) : ConnectionState;
        public sealed record Reconnecting(int NextAttemptMs, string? LastError = null) : ConnectionState;
        public sealed record Disconnected(string? Reason = null) : ConnectionState;
        public sealed record Rejected(string Reason) : ConnectionState;
    }

    public sealed record ProtocolErrorEvent
    {
        // `required` 미사용 — Unity 2022/2023 (.NET Standard 2.1, C# 9) 호환.
        public ProtocolErrorKind Kind { get; init; }
        public string? Raw { get; init; }
        public string Message { get; init; } = string.Empty;
    }

    public enum ProtocolErrorKind
    {
        Schema,
        Parse,
    }

    public interface ISubscription : IDisposable { }

    public interface IViewerConnection
    {
        // url은 ws:// 형식 ("ws://192.168.0.42/viewer" 등)
        System.Threading.Tasks.Task ConnectAsync(string url);
        void Disconnect();
        ConnectionState GetState();
        void Send(ViewerCommand msg);

        // subscription-style: 다중 구독 + 명시적 dispose
        ISubscription OnMessage(Action<EspMessage> handler);
        ISubscription OnConnectionChange(Action<ConnectionState> handler);
        ISubscription OnProtocolError(Action<ProtocolErrorEvent> handler);
    }
}
