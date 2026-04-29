// 모션별 GIF + duration metadata
// duration_ms는 ESP가 motion_started에서 보내는 값을 신뢰하는 게 원칙. 이 registry는 fallback + asset path 매핑용.

export type MotionName =
  | "idle"
  | "sit"
  | "stand"
  | "roll_left"
  | "roll_right"
  | "surprise"
  | "hand";

export interface MotionEntry {
  gif: string;
  duration_ms: number | null;
  loop: boolean;
}

// duration_ms는 motion이 진행하는 시간. progress bar가 이 값에 맞춰 채워짐.
// 모든 motion을 1초로 통일 — GIF 자체 길이는 다양하지만 사용자 경험상 1초 표시 유지.
export const MOTION_REGISTRY: Record<MotionName, MotionEntry> = {
  idle:       { gif: "/motions/nubjuk-idle.gif",       duration_ms: null, loop: true  },
  sit:        { gif: "/motions/nubjuk-sit.gif",        duration_ms: 1000, loop: false },
  stand:      { gif: "/motions/nubjuk-stand.gif",      duration_ms: 1000, loop: false },
  roll_left:  { gif: "/motions/nubjuk-roll-left.gif",  duration_ms: 1000, loop: false },
  roll_right: { gif: "/motions/nubjuk-roll-right.gif", duration_ms: 1000, loop: false },
  surprise:   { gif: "/motions/nubjuk-surprise.gif",   duration_ms: 1000, loop: false },
  hand:       { gif: "/motions/nubjuk-hand.gif",       duration_ms: 1000, loop: false },
};

export function motionGif(name: MotionName | string): string {
  const entry = (MOTION_REGISTRY as Record<string, MotionEntry>)[name] ?? MOTION_REGISTRY.idle;
  return entry.gif;
}
