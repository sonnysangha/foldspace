/**
 * A repeatable waveform for a voice note, derived from its id. It stands in for the
 * recording's real levels: the same note always draws the same bars, on canvas and in the player.
 */
export function waveform(seed: string, count: number): number[] {
  let state = 2166136261;
  for (let index = 0; index < seed.length; index += 1) state = Math.imul(state ^ seed.charCodeAt(index), 16777619);
  const bars: number[] = [];
  for (let index = 0; index < count; index += 1) {
    state = Math.imul(state ^ (state >>> 15), 2246822519) + index;
    const noise = ((state >>> 0) % 1000) / 1000;
    // Speech swells and falls, so the noise rides on a slow wave.
    const swell = 0.55 + 0.45 * Math.sin(index / count * Math.PI * 3 + (state & 7));
    bars.push(Math.max(0.12, Math.min(1, noise * 0.6 * swell + 0.25 * swell)));
  }
  return bars;
}

export function formatDuration(seconds: number) {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
