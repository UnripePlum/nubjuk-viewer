// Wire — JSON wire format 정책. Protocol.cs의 모든 (de)serialization은 Wire 헬퍼만 거쳐야 함.
//
// 정책:
//   - 속성 PascalCase → wire snake_case (예: TsMs → "ts_ms", BootId → "boot_id")
//   - enum PascalCase → wire snake_case (예: IntentRecognized → "intent_recognized", EStop → "e_stop")
//   - "type" discriminator는 JsonPolymorphic이 자동 처리 (Protocol.cs의 [JsonDerivedType(...)])
//   - Slots는 Dictionary<string, object> — JSON object로 직렬화/역직렬화
//   - null 필드도 명시적으로 직렬화 (TS와 라운드트립 일관성). e.g. raw_text: null → `"raw_text":null`
//
// 사용 패턴:
//   var msg = Wire.Deserialize<EspMessage>(jsonString);  // 다형 deserialize
//   var json = Wire.Serialize(myCommand);                // 다형 serialize + snake_case
//
// JsonSerializerOptions를 직접 노출하지 않음 — 우회로 잘못된 옵션 사용 방지 (Codex P2).

#nullable enable

using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Nubjuk.Viewer.Types
{
    public static class Wire
    {
        private static readonly JsonSerializerOptions _options = CreateOptions();

        public static string Serialize<T>(T value) =>
            JsonSerializer.Serialize(value, typeof(T), _options);

        public static T? Deserialize<T>(string json) =>
            JsonSerializer.Deserialize<T>(json, _options);

        // 단위 테스트가 옵션 자체를 점검할 필요 있을 때만 사용 (e.g. naming policy 검증).
        // production code path는 절대 이걸로 SerializerOptions를 직접 만지지 말 것.
        internal static JsonSerializerOptions OptionsForTest => _options;

        private static JsonSerializerOptions CreateOptions()
        {
            var opts = new JsonSerializerOptions
            {
                PropertyNamingPolicy = SnakeCaseLowerNamingPolicy.Instance,
                DictionaryKeyPolicy = SnakeCaseLowerNamingPolicy.Instance,
                // null도 wire에 명시적으로 — TS의 `raw_text: null`과 라운드트립 일관성 유지.
                DefaultIgnoreCondition = JsonIgnoreCondition.Never,
                IncludeFields = false,
                WriteIndented = false,
            };
            opts.Converters.Add(new JsonStringEnumConverter(SnakeCaseLowerNamingPolicy.Instance));
            return opts;
        }
    }

    // PascalCase → snake_case lower 변환. .NET 8의 JsonNamingPolicy.SnakeCaseLower와 같은 동작이지만
    // .NET 6/7 Unity 타깃 호환 위해 직접 구현.
    public sealed class SnakeCaseLowerNamingPolicy : JsonNamingPolicy
    {
        public static readonly SnakeCaseLowerNamingPolicy Instance = new();

        public override string ConvertName(string name)
        {
            if (string.IsNullOrEmpty(name)) return name;
            var sb = new StringBuilder(name.Length + 4);
            for (int i = 0; i < name.Length; i++)
            {
                char c = name[i];
                if (i > 0 && char.IsUpper(c))
                {
                    sb.Append('_');
                }
                sb.Append(char.ToLowerInvariant(c));
            }
            return sb.ToString();
        }
    }
}
