// Protocol — viewer/src/types/protocol.ts의 C# 1:1 이식.
// docs/protocol/mcu-viewer.md envelope + 8 ESP→viewer + 3 viewer→ESP 메시지.
//
// JSON wire 호환:
//   - 모든 직렬화는 WireOptions.Default (Wire.cs) 거쳐야 함.
//   - 속성은 PascalCase로 정의되지만 wire에서는 snake_case (SnakeCaseLowerNamingPolicy 적용).
//   - enum도 동일 — IntentRecognized → "intent_recognized", EStop → "e_stop".
//   - 다형 deserialization은 JsonPolymorphic + JsonDerivedType 사용 (.NET 7+).

#nullable enable

using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace Nubjuk.Viewer.Types
{
    // ─── enums ──────────────────────────────────────────────
    // SnakeCaseLower naming policy로 자동 매핑:
    //   Idle → "idle", IntentRecognized → "intent_recognized", EStop → "e_stop", MotionFailed → "motion_failed", etc.

    public enum FsmState
    {
        Idle,
        Listening,
        IntentRecognized,
        Validating,
        Executing,
        Completed,
        Rejected,
        MotionFailed,
    }

    public enum RejectReason
    {
        LowConfidence,
        CycleTimeout,
        Precondition,
        Stale,
        Busy,
    }

    public enum MotionFailReason
    {
        Timeout,
        Hardware,
        EStop,
        Precondition,
        Unknown,
    }

    public enum ErrorCode
    {
        Busy,
        InvalidMessage,
        ManualTriggerDisabled,
        BrainUnreachable,
        RhinoLoadFailed,
    }

    public enum IntentName
    {
        Idle,
        Sit,
        Stand,
        RollLeft,
        RollRight,
        Surprise,
        Hand,
    }

    // ─── envelope (ESP → viewer) ────────────────────────────
    // JsonPolymorphic으로 "type" 필드 보고 derived 선택. 8종 EspMessage subclass.

    [JsonPolymorphic(TypeDiscriminatorPropertyName = "type")]
    [JsonDerivedType(typeof(HelloMessage), "hello")]
    [JsonDerivedType(typeof(StateMessage), "state")]
    [JsonDerivedType(typeof(IntentMessage), "intent")]
    [JsonDerivedType(typeof(MotionStartedMessage), "motion_started")]
    [JsonDerivedType(typeof(MotionCompletedMessage), "motion_completed")]
    [JsonDerivedType(typeof(MotionFailedMessage), "motion_failed")]
    [JsonDerivedType(typeof(ErrorMessage), "error")]
    [JsonDerivedType(typeof(HeartbeatMessage), "heartbeat")]
    public abstract record EspMessage
    {
        public int V { get; init; } = 1;
        public long TsMs { get; init; }
        public string DeviceId { get; init; } = string.Empty;
        public string BootId { get; init; } = string.Empty;
        public int? Seq { get; init; }
    }

    public abstract record CycleEnvelopeMessage : EspMessage
    {
        public string CorrelationId { get; init; } = string.Empty;
    }

    // ─── ESP → viewer (8종) ─────────────────────────────────

    public sealed record HelloMessage : EspMessage
    {
        public HelloPayload Payload { get; init; } = new();
    }
    public sealed record HelloPayload
    {
        public string FwVersion { get; init; } = string.Empty;
        public int SchemaV { get; init; }
        public FsmState CurrentState { get; init; }
        public IReadOnlyList<string> Capabilities { get; init; } = new List<string>();
        public long UptimeMs { get; init; }
    }

    public sealed record StateMessage : CycleEnvelopeMessage
    {
        public StatePayload Payload { get; init; } = new();
    }
    public sealed record StatePayload
    {
        public FsmState From { get; init; }
        public FsmState To { get; init; }
        // RejectReason 또는 MotionFailReason 문자열, 또는 null. Reason은 두 enum이 섞여 있어 raw string으로 보존.
        public string? Reason { get; init; }
    }

    public sealed record IntentMessage : CycleEnvelopeMessage
    {
        public IntentPayload Payload { get; init; } = new();
    }
    public sealed record IntentPayload
    {
        public IntentName Intent { get; init; }
        public IReadOnlyDictionary<string, object> Slots { get; init; } = new Dictionary<string, object>();
        public double Confidence { get; init; }
        public string? RawText { get; init; }
    }

    public sealed record MotionStartedMessage : CycleEnvelopeMessage
    {
        public MotionStartedPayload Payload { get; init; } = new();
    }
    public sealed record MotionStartedPayload
    {
        public IntentName Intent { get; init; }
        public long ExpectedDurationMs { get; init; }
    }

    public sealed record MotionCompletedMessage : CycleEnvelopeMessage
    {
        public MotionCompletedPayload Payload { get; init; } = new();
    }
    public sealed record MotionCompletedPayload
    {
        public long ActualDurationMs { get; init; }
    }

    public sealed record MotionFailedMessage : CycleEnvelopeMessage
    {
        public MotionFailedPayload Payload { get; init; } = new();
    }
    public sealed record MotionFailedPayload
    {
        public MotionFailReason Reason { get; init; }
        public string? Details { get; init; }
    }

    public sealed record ErrorMessage : EspMessage
    {
        public ErrorPayload Payload { get; init; } = new();
    }
    public sealed record ErrorPayload
    {
        public ErrorCode Code { get; init; }
        public string Message { get; init; } = string.Empty;
    }

    public sealed record HeartbeatMessage : EspMessage
    {
        public HeartbeatPayload Payload { get; init; } = new();
    }
    public sealed record HeartbeatPayload
    {
        public long UptimeMs { get; init; }
        public long FreeHeap { get; init; }
        public FsmState CurrentState { get; init; }
    }

    // ─── viewer → ESP (3종) ─────────────────────────────────

    [JsonPolymorphic(TypeDiscriminatorPropertyName = "type")]
    [JsonDerivedType(typeof(SubscribeCommand), "subscribe")]
    [JsonDerivedType(typeof(ManualTriggerCommand), "manual_trigger")]
    [JsonDerivedType(typeof(PingCommand), "ping")]
    public abstract record ViewerCommand
    {
        public int V { get; init; } = 1;
    }

    public sealed record SubscribeCommand : ViewerCommand
    {
        public SubscribePayload Payload { get; init; } = new();
    }
    public sealed record SubscribePayload
    {
        public string ClientKind { get; init; } = "unity";
        public bool Debug { get; init; }
    }

    public sealed record ManualTriggerCommand : ViewerCommand
    {
        public ManualTriggerPayload Payload { get; init; } = new();
    }
    public sealed record ManualTriggerPayload
    {
        public IntentName Intent { get; init; }
        public IReadOnlyDictionary<string, object> Slots { get; init; } = new Dictionary<string, object>();
    }

    public sealed record PingCommand : ViewerCommand
    {
        // payload는 빈 객체 — TS와 동일 wire shape (`{"v":1,"type":"ping","payload":{}}`).
        public IReadOnlyDictionary<string, object> Payload { get; init; } = new Dictionary<string, object>();
    }
}
