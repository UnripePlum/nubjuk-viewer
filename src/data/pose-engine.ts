// 자세(pose) state machine — 모션 종류에 따라 GIF 유지 여부 결정
//
// persistent (끝나면 그 자세 GIF 유지): sit, hand
// transient (끝나면 이전 자세로 복귀): roll_left, roll_right, surprise
//   → surprise는 깜짝 놀라는 *순간 동작*. 끝나면 직전 자세 (sit이었으면 sit) 복귀.
// reset (끝나면 idle 복귀): idle, stand  (서있는 자세 = idle default)

import type { MotionName } from "./motion-registry";

export type Pose = "idle" | "sit" | "hand";

const POSES_PERSISTENT: ReadonlySet<MotionName> = new Set<MotionName>([
  "sit",
  "hand",
]);
const POSES_TRANSIENT: ReadonlySet<MotionName> = new Set<MotionName>([
  "roll_left",
  "roll_right",
  "surprise",
]);
const POSES_RESET: ReadonlySet<MotionName> = new Set<MotionName>([
  "idle",
  "stand",
]);

export function isPersistent(name: MotionName | string): boolean {
  return POSES_PERSISTENT.has(name as MotionName);
}

export function isTransient(name: MotionName | string): boolean {
  return POSES_TRANSIENT.has(name as MotionName);
}

export function isReset(name: MotionName | string): boolean {
  return POSES_RESET.has(name as MotionName);
}

// motion이 완료된 후 어떤 GIF를 보여줄지
export function nextPose(currentPose: Pose, completedMotion: MotionName | string | null): Pose {
  if (!completedMotion) return currentPose;
  if (isReset(completedMotion)) return "idle";
  if (isTransient(completedMotion)) return currentPose;
  if (isPersistent(completedMotion)) return completedMotion as Pose;
  return currentPose;
}
