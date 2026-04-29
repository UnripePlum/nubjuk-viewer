// resolveEspHost — host 입력 정규화 + 우선순위 결정.
// 순수 함수 (DOM 의존 X). UI 레이어는 결과 받아서 inline form / modal 렌더링.
//
// 우선순위 (PHASES.md 2.7):
//   1. URL 쿼리 ?host=...
//   2. localStorage 'esp_host'
//   3. env NEXT_PUBLIC_ESP_HOST
//   4. null → 사용자 입력 필요

const HOST_REGEX = /^([a-z0-9.-]+|\[[0-9a-f:]+\])(:\d+)?$/i;
const STORAGE_KEY = "esp_host";

export interface HostSources {
  query?: string | null;
  storage?: string | null;
  env?: string | null;
}

export type HostResolution =
  | { ok: true; host: string; source: "query" | "storage" | "env" }
  | { ok: false; reason: "no_source" }
  | { ok: false; reason: "invalid"; source: "query" | "storage" | "env"; raw: string };

// host 입력 정규화 — null 반환 = invalid.
// 규칙:
//   - whitespace trim
//   - ws://, wss://, http://, https:// prefix 제거
//   - 끝의 /, /viewer, /ws 등 path 제거
//   - IPv6 [::1]:80 형태 그대로 유지
//   - regex 검증 통과 시 정규화된 문자열 반환
export function normalizeHost(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;

  // protocol prefix 제거
  s = s.replace(/^(wss?:\/\/|https?:\/\/)/i, "");

  // path 제거 (첫 / 이후 모두 잘라냄)
  const pathIdx = s.indexOf("/");
  if (pathIdx !== -1) s = s.slice(0, pathIdx);

  // 빈 결과 거부
  if (!s) return null;

  // 형식 검증
  if (!HOST_REGEX.test(s)) return null;

  return s;
}

export function resolveEspHost(sources: HostSources): HostResolution {
  // 1. query
  if (sources.query) {
    const norm = normalizeHost(sources.query);
    if (norm) return { ok: true, host: norm, source: "query" };
    return { ok: false, reason: "invalid", source: "query", raw: sources.query };
  }

  // 2. localStorage
  if (sources.storage) {
    const norm = normalizeHost(sources.storage);
    if (norm) return { ok: true, host: norm, source: "storage" };
    return { ok: false, reason: "invalid", source: "storage", raw: sources.storage };
  }

  // 3. env
  if (sources.env) {
    const norm = normalizeHost(sources.env);
    if (norm) return { ok: true, host: norm, source: "env" };
    return { ok: false, reason: "invalid", source: "env", raw: sources.env };
  }

  return { ok: false, reason: "no_source" };
}

// 브라우저 환경 helper — DOM 의존. 테스트에서는 호출 X (resolveEspHost로 직접 검증).
export function readBrowserSources(): HostSources {
  if (typeof window === "undefined") {
    return {
      query: null,
      storage: null,
      env: process.env.NEXT_PUBLIC_ESP_HOST ?? null,
    };
  }
  const params = new URLSearchParams(window.location.search);
  return {
    query: params.get("host"),
    storage: window.localStorage.getItem(STORAGE_KEY),
    env: process.env.NEXT_PUBLIC_ESP_HOST ?? null,
  };
}

export function persistEspHost(host: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, host);
}

export function clearEspHost(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}

// 최종 WS URL 조립. host는 정규화된 형식 ("example.com:80" or "[::1]:8080").
export function toWsUrl(host: string, path = "/viewer"): string {
  return `ws://${host}${path}`;
}
