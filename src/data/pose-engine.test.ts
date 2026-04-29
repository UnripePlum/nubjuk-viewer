import { describe, it, expect } from "vitest";
import { nextPose } from "./pose-engine";

describe("pose-engine.nextPose", () => {
  it("persistent (sit, hand) → pose adopts motion", () => {
    expect(nextPose("idle", "sit")).toBe("sit");
    expect(nextPose("hand", "sit")).toBe("sit");
    expect(nextPose("idle", "hand")).toBe("hand");
    expect(nextPose("sit", "hand")).toBe("hand");
  });

  it("transient (surprise, roll_*) → pose unchanged", () => {
    expect(nextPose("sit", "surprise")).toBe("sit");
    expect(nextPose("idle", "surprise")).toBe("idle");
    expect(nextPose("hand", "surprise")).toBe("hand");
    expect(nextPose("sit", "roll_left")).toBe("sit");
    expect(nextPose("sit", "roll_right")).toBe("sit");
  });

  it("reset (idle, stand) → pose becomes idle", () => {
    expect(nextPose("sit", "stand")).toBe("idle");
    expect(nextPose("hand", "stand")).toBe("idle");
    expect(nextPose("sit", "idle")).toBe("idle");
  });

  it("null/undefined motion → pose unchanged", () => {
    expect(nextPose("sit", null)).toBe("sit");
    expect(nextPose("idle", null)).toBe("idle");
  });

  it("unknown motion name → pose unchanged (defensive)", () => {
    expect(nextPose("sit", "unknown_motion")).toBe("sit");
  });
});
