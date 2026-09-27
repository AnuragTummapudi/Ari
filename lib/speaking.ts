/** A small hold time prevents the video border from flickering between syllables. */
export class SpeakingGate {
  private lastAboveThreshold = -Infinity;
  private active = false;

  constructor(private readonly threshold: number, private readonly holdMs = 240) {}

  update(level: number, now: number, enabled = true): boolean {
    if (!enabled) {
      this.reset();
      return false;
    }
    if (level >= this.threshold) {
      this.lastAboveThreshold = now;
      this.active = true;
    } else if (now - this.lastAboveThreshold > this.holdMs) {
      this.active = false;
    }
    return this.active;
  }

  reset(): void {
    this.lastAboveThreshold = -Infinity;
    this.active = false;
  }
}

export function audioRms(analyser: AnalyserNode, samples: Float32Array): number {
  analyser.getFloatTimeDomainData(samples as Float32Array<ArrayBuffer>);
  let power = 0;
  for (let index = 0; index < samples.length; index += 1) power += samples[index] * samples[index];
  return Math.sqrt(power / samples.length);
}
