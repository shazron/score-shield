export const MIN_FRAME_INTERVAL_SECONDS = 5;
export const MAX_FRAME_INTERVAL_SECONDS = 30;
export const DEFAULT_FRAME_INTERVAL_SECONDS = 10;
export const HIGH_FREQUENCY_WINDOW_SECONDS = 120;
export const HIGH_FREQUENCY_FRAME_INTERVAL_SECONDS = 5;

export function parseFrameInterval(value, fallback = DEFAULT_FRAME_INTERVAL_SECONDS) {
  const interval = value === undefined || value === "" ? fallback : Number(value);
  return Number.isInteger(interval)
    && interval >= MIN_FRAME_INTERVAL_SECONDS
    && interval <= MAX_FRAME_INTERVAL_SECONDS
    ? interval
    : null;
}

export function buildFrameSamplingPlan(duration, frameIntervalSeconds) {
  const interval = parseFrameInterval(frameIntervalSeconds);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Video duration must be a positive number.");
  if (interval === null) throw new Error("Frame sampling interval must be a whole number from 5 to 30 seconds.");

  const closingInterval = Math.min(interval, HIGH_FREQUENCY_FRAME_INTERVAL_SECONDS);
  const closingWindowStart = Math.max(0, duration - HIGH_FREQUENCY_WINDOW_SECONDS);
  if (closingWindowStart === 0 || closingInterval === interval) {
    return [{ start: 0, end: duration, interval: closingInterval }];
  }
  return [
    { start: 0, end: closingWindowStart, interval },
    { start: closingWindowStart, end: duration, interval: closingInterval },
  ];
}

export function samplingFrameTimestamp(segment, frameIndex, duration) {
  return Math.min(duration, segment.start + (frameIndex + 0.5) * segment.interval);
}
