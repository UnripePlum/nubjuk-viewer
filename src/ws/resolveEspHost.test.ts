// resolveEspHost / normalizeHost 단위 테스트 — 정규화 6단계 + 우선순위 락인.

import { describe, it, expect } from "vitest";
import { normalizeHost, resolveEspHost, toWsUrl } from "./resolveEspHost";

describe("normalizeHost", () => {
  it("plain host:port 그대로", () => {
    expect(normalizeHost("192.168.0.42:80")).toBe("192.168.0.42:80");
    expect(normalizeHost("nubjuk.local:8080")).toBe("nubjuk.local:8080");
  });

  it("port 없는 hostname 허용", () => {
    expect(normalizeHost("nubjuk.local")).toBe("nubjuk.local");
    expect(normalizeHost("192.168.0.42")).toBe("192.168.0.42");
  });

  it("whitespace trim", () => {
    expect(normalizeHost("  192.168.0.42:80  ")).toBe("192.168.0.42:80");
    expect(normalizeHost("\tnubjuk.local\n")).toBe("nubjuk.local");
  });

  it("ws:// / wss:// / http:// / https:// prefix 제거", () => {
    expect(normalizeHost("ws://192.168.0.42:80")).toBe("192.168.0.42:80");
    expect(normalizeHost("wss://nubjuk.local")).toBe("nubjuk.local");
    expect(normalizeHost("http://192.168.0.42:8080")).toBe("192.168.0.42:8080");
    expect(normalizeHost("https://nubjuk.local")).toBe("nubjuk.local");
  });

  it("path 제거 (/viewer, /ws, /, etc.)", () => {
    expect(normalizeHost("192.168.0.42:80/viewer")).toBe("192.168.0.42:80");
    expect(normalizeHost("ws://nubjuk.local/ws")).toBe("nubjuk.local");
    expect(normalizeHost("192.168.0.42/")).toBe("192.168.0.42");
  });

  it("IPv6 literal [::1]:80 허용", () => {
    expect(normalizeHost("[::1]:80")).toBe("[::1]:80");
    expect(normalizeHost("ws://[fe80::1]:8080/viewer")).toBe("[fe80::1]:8080");
  });

  it("빈 문자열 / 공백만 → null", () => {
    expect(normalizeHost("")).toBeNull();
    expect(normalizeHost("   ")).toBeNull();
    expect(normalizeHost("ws://")).toBeNull();
  });

  it("형식 위반 → null", () => {
    expect(normalizeHost("not a host")).toBeNull();
    expect(normalizeHost("192.168.0.42:not_a_port")).toBeNull();
    expect(normalizeHost("space here.com")).toBeNull();
  });
});

describe("resolveEspHost (priority)", () => {
  it("query > storage > env (query 우선)", () => {
    const r = resolveEspHost({
      query: "10.0.0.1:80",
      storage: "192.168.0.42:80",
      env: "nubjuk.local",
    });
    expect(r).toEqual({ ok: true, host: "10.0.0.1:80", source: "query" });
  });

  it("query 없으면 storage 사용", () => {
    const r = resolveEspHost({
      query: null,
      storage: "192.168.0.42:80",
      env: "nubjuk.local",
    });
    expect(r).toEqual({ ok: true, host: "192.168.0.42:80", source: "storage" });
  });

  it("query/storage 없으면 env fallback", () => {
    const r = resolveEspHost({
      query: null,
      storage: null,
      env: "nubjuk.local",
    });
    expect(r).toEqual({ ok: true, host: "nubjuk.local", source: "env" });
  });

  it("모두 없으면 no_source", () => {
    const r = resolveEspHost({});
    expect(r).toEqual({ ok: false, reason: "no_source" });
  });

  it("query 잘못된 형식 → invalid + raw 보존 (storage fallback X)", () => {
    const r = resolveEspHost({
      query: "not a host",
      storage: "192.168.0.42:80",
    });
    expect(r).toEqual({
      ok: false,
      reason: "invalid",
      source: "query",
      raw: "not a host",
    });
  });

  it("query는 정규화 통과 (ws:// 포함)", () => {
    const r = resolveEspHost({ query: "ws://192.168.0.42:80/viewer" });
    expect(r).toEqual({ ok: true, host: "192.168.0.42:80", source: "query" });
  });
});

describe("toWsUrl", () => {
  it("기본 path는 /viewer", () => {
    expect(toWsUrl("192.168.0.42:80")).toBe("ws://192.168.0.42:80/viewer");
  });

  it("커스텀 path", () => {
    expect(toWsUrl("nubjuk.local", "/ws")).toBe("ws://nubjuk.local/ws");
  });

  it("IPv6 literal", () => {
    expect(toWsUrl("[::1]:80")).toBe("ws://[::1]:80/viewer");
  });
});
