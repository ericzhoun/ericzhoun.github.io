// Universal early-bird rule: 10% off when booking 15+ classes before the deadline.
// This replaces the old per-program/per-schedule early-bird configuration.
export const EARLY_BIRD_MIN_CLASSES = 15;
export const EARLY_BIRD_DEADLINE = "2026-08-15T00:00:00-07:00";
export const EARLY_BIRD_PCT = 10;

export function computeEarlyBird(numClasses, now = new Date()) {
  return numClasses >= EARLY_BIRD_MIN_CLASSES && now <= new Date(EARLY_BIRD_DEADLINE);
}
