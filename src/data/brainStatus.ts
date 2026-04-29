// brain dual ↔ mcu fallback toast 표시 윈도우 (Phase 4).
// shared.tsx의 BrainStatusBadge가 사용 — 순수 함수로 분리하여 단위 테스트 가능.

export const BRAIN_TOAST_MS = 5000;

export function brainStatusVisible(
  lastAt: number | null,
  now: number,
  windowMs: number = BRAIN_TOAST_MS,
): boolean {
  if (lastAt === null) return false;
  return now - lastAt < windowMs;
}

export function brainStatusRemainingS(
  lastAt: number | null,
  now: number,
  windowMs: number = BRAIN_TOAST_MS,
): number {
  if (lastAt === null) return 0;
  const remaining = windowMs - (now - lastAt);
  if (remaining <= 0) return 0;
  return Math.ceil(remaining / 1000);
}
