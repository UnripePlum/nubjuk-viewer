import { describe, it, expect } from "vitest";
import { BRAIN_TOAST_MS, brainStatusRemainingS, brainStatusVisible } from "./brainStatus";

describe("brainStatusVisible", () => {
  it("null lastAt → false", () => {
    expect(brainStatusVisible(null, Date.now())).toBe(false);
  });

  it("같은 시점에 도착 → true (윈도우 안)", () => {
    expect(brainStatusVisible(1000, 1000)).toBe(true);
  });

  it("4999ms 경과 → true (5000ms 윈도우 안)", () => {
    expect(brainStatusVisible(1000, 1000 + 4999)).toBe(true);
  });

  it("정확히 5000ms 경과 → false (강 dismiss)", () => {
    expect(brainStatusVisible(1000, 1000 + 5000)).toBe(false);
  });

  it("5000ms 초과 → false", () => {
    expect(brainStatusVisible(1000, 1000 + 10000)).toBe(false);
  });

  it("custom 윈도우 (2000ms)", () => {
    expect(brainStatusVisible(1000, 2999, 2000)).toBe(true);
    expect(brainStatusVisible(1000, 3000, 2000)).toBe(false);
  });

  it("now < lastAt (clock skew) → 윈도우 안으로 간주 (false 아님)", () => {
    expect(brainStatusVisible(1000, 500)).toBe(true);
  });
});

describe("brainStatusRemainingS", () => {
  it("null lastAt → 0", () => {
    expect(brainStatusRemainingS(null, Date.now())).toBe(0);
  });

  it("0ms 경과 → 5초", () => {
    expect(brainStatusRemainingS(1000, 1000)).toBe(5);
  });

  it("1ms 경과 → 5초 (ceil)", () => {
    expect(brainStatusRemainingS(1000, 1001)).toBe(5);
  });

  it("4001ms 경과 → 1초", () => {
    expect(brainStatusRemainingS(1000, 5001)).toBe(1);
  });

  it("4999ms 경과 → 1초 (마지막 1초)", () => {
    expect(brainStatusRemainingS(1000, 5999)).toBe(1);
  });

  it("정확히 5000ms 경과 → 0", () => {
    expect(brainStatusRemainingS(1000, 6000)).toBe(0);
  });

  it("초과 → 0 (음수 X)", () => {
    expect(brainStatusRemainingS(1000, 10000)).toBe(0);
  });

  it("BRAIN_TOAST_MS 상수 = 5000", () => {
    expect(BRAIN_TOAST_MS).toBe(5000);
  });
});
