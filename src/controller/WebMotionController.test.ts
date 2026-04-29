// WebMotionController regression tests — Option D semantics 락인.
// 핵심: ESP-as-truth. expectedMs 도달만으로 self-completed emit 없음.
// watchdog (expectedMs * 2 + 1000) 만료 시에만 self-failed{timeout}.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WebMotionController } from "./WebMotionController";
import type { MotionEvent } from "./MotionController";

describe("WebMotionController", () => {
  let ctrl: WebMotionController;
  let events: MotionEvent[];

  beforeEach(() => {
    vi.useFakeTimers();
    ctrl = new WebMotionController();
    events = [];
    ctrl.onEvent((e) => events.push(e));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("play emits started + sets active", async () => {
    await ctrl.play("sit", 700, "cid_a");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "started",
      correlationId: "cid_a",
      intent: "sit",
      expectedMs: 700,
    });
    expect(ctrl.isPlaying()).toBe(true);
    expect(ctrl.getCurrentCorrelationId()).toBe("cid_a");
  });

  it("play same cid twice → idempotent (second is no-op)", async () => {
    await ctrl.play("sit", 700, "cid_a");
    await ctrl.play("sit", 700, "cid_a");
    expect(events).toHaveLength(1);
  });

  it("play different cid (running) → cancelled(superseded) + new started", async () => {
    await ctrl.play("sit", 700, "cid_a");
    await ctrl.play("stand", 700, "cid_b");
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ type: "started", correlationId: "cid_a" });
    expect(events[1]).toMatchObject({
      type: "cancelled",
      correlationId: "cid_a",
      reason: "superseded",
    });
    expect(events[2]).toMatchObject({
      type: "started",
      correlationId: "cid_b",
      intent: "stand",
    });
    expect(ctrl.getCurrentCorrelationId()).toBe("cid_b");
  });

  it("settle{completed} matching cid → completed event + clears active", async () => {
    await ctrl.play("sit", 700, "cid_a");
    ctrl.settle({ type: "completed", correlationId: "cid_a", actualMs: 680 });
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      type: "completed",
      correlationId: "cid_a",
      actualMs: 680,
    });
    expect(ctrl.isPlaying()).toBe(false);
    expect(ctrl.getCurrentCorrelationId()).toBeNull();
  });

  it("settle{failed} matching cid → failed event with reason", async () => {
    await ctrl.play("roll_left", 1500, "cid_a");
    ctrl.settle({ type: "failed", correlationId: "cid_a", reason: "hardware" });
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      type: "failed",
      correlationId: "cid_a",
      reason: "hardware",
    });
    expect(ctrl.isPlaying()).toBe(false);
  });

  it("settle mismatched cid → no-op (방어적)", async () => {
    await ctrl.play("sit", 700, "cid_a");
    ctrl.settle({
      type: "completed",
      correlationId: "cid_OTHER",
      actualMs: 700,
    });
    expect(events).toHaveLength(1);
    expect(ctrl.isPlaying()).toBe(true);
  });

  it("expectedMs 도달만으로 self-completed emit 없음 (Codex P0 fix)", async () => {
    await ctrl.play("sit", 700, "cid_a");
    vi.advanceTimersByTime(700);
    expect(events).toHaveLength(1); // started only — no self-completed
    expect(ctrl.isPlaying()).toBe(true);
  });

  it("watchdog 정확히 expectedMs*2+grace에서 fire (1700ms for 700ms)", async () => {
    await ctrl.play("sit", 700, "cid_a");
    // watchdog at max(700*2, 700+1000) = 1700ms 정확히 (Codex P3 정밀화)
    vi.advanceTimersByTime(1699);
    expect(events).toHaveLength(1); // 아직 fire 안 함
    vi.advanceTimersByTime(1); // 정확히 1700ms — fire
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      type: "failed",
      correlationId: "cid_a",
      reason: "timeout",
    });
    expect(ctrl.isPlaying()).toBe(false);
  });

  it("watchdog timing — 짧은 expectedMs(100)는 grace로 1100ms", async () => {
    await ctrl.play("sit", 100, "cid_a");
    // watchdog = max(100*2, 100+1000) = 1100ms
    vi.advanceTimersByTime(1099);
    expect(events).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ type: "failed", reason: "timeout" });
  });

  it("watchdog timing — 긴 expectedMs(1500)는 2x로 3000ms", async () => {
    await ctrl.play("roll_left", 1500, "cid_a");
    // watchdog = max(1500*2, 1500+1000) = 3000ms
    vi.advanceTimersByTime(2999);
    expect(events).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ type: "failed", reason: "timeout" });
  });

  it("settle 후 watchdog 클리어 — 더 이상 fire 안 함", async () => {
    await ctrl.play("sit", 700, "cid_a");
    ctrl.settle({ type: "completed", correlationId: "cid_a", actualMs: 700 });
    vi.advanceTimersByTime(5000);
    expect(events).toHaveLength(2); // started + completed only
  });

  it("stop while playing → cancelled{stop_called}, watchdog 정리", async () => {
    await ctrl.play("sit", 700, "cid_a");
    ctrl.stop();
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      type: "cancelled",
      correlationId: "cid_a",
      reason: "stop_called",
    });
    expect(ctrl.isPlaying()).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(events).toHaveLength(2); // watchdog cleared
  });

  it("stop while idle → no-op", () => {
    ctrl.stop();
    expect(events).toHaveLength(0);
  });
});
