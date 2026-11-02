// Timings are measured from the beginning of each recording, not its upload.
export const LIVE_TIMING = { segmentMs: 8000, maxAgeMs: 16000, requestMs: 8000, contextAgeMs: 30000 };
export type VocalMode = "speech" | "candidate" | "hymn";
export class HymnGate {
  mode: VocalMode = "speech";
  private singing = 0;
  private speaking = 0;
  discontinuity() { this.singing = 0; this.speaking = 0; if (this.mode === "candidate") this.mode = "speech"; }
  update(singing: number, speech: number, durationMs: number): VocalMode {
    const clearSpeech = speech >= 0.45 && speech > singing;
    const clearSinging = singing >= 0.35 && singing > speech * 1.2;
    if (this.mode === "hymn") {
      this.speaking = clearSpeech ? this.speaking + durationMs : 0;
      if (this.speaking >= 2000) { this.mode = "speech"; this.singing = 0; this.speaking = 0; }
    } else {
      this.singing = clearSinging ? this.singing + durationMs : 0;
      this.mode = this.singing >= 5000 ? "hymn" : this.singing > 0 ? "candidate" : "speech";
    }
    return this.mode;
  }
}
export function recentReloads(value: unknown, now: number): number[] {
  return Array.isArray(value) ? value.filter(t => typeof t === "number" && t <= now && now - t < 300000) : [];
}

// At most one active request and one waiting segment. Deadlines also cover a
// transport that ignores abort; late resolutions cannot reach the transcript.
export class LatestQueue<T, R> {
  private waiting: { value: T; startedAt: number } | null = null;
  private current: AbortController | null = null;
  private epoch = 0;
  private held = false;
  constructor(private options: {
    run: (value: T, signal: AbortSignal) => Promise<R>;
    result: (result: R) => void;
    skip: () => void;
    error: (error: unknown) => void;
    busy: (busy: boolean) => void;
    maxAgeMs?: number;
    requestMs?: number;
  }) {}
  push(value: T, startedAt: number) {
    if (this.waiting) this.options.skip();
    this.waiting = { value, startedAt };
    void this.pump();
  }
  hold(value: boolean) { this.held = value; if (!value) void this.pump(); }
  cancel() {
    this.epoch++;
    this.waiting = null;
    this.current?.abort();
    this.current = null;
    this.options.busy(false);
  }
  private async pump() {
    if (this.current || !this.waiting || this.held) return;
    const item = this.waiting;
    this.waiting = null;
    const remaining = (this.options.maxAgeMs ?? LIVE_TIMING.maxAgeMs) - (Date.now() - item.startedAt);
    if (remaining <= 0) { this.options.skip(); return; }
    const epoch = this.epoch;
    const abort = new AbortController();
    this.current = abort;
    this.options.busy(true);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      abort.signal.addEventListener("abort", () => reject(new Error("Segment cancelled")), { once: true });
      timer = setTimeout(() => { reject(new Error("Segment deadline exceeded")); abort.abort(); }, Math.min(remaining, this.options.requestMs ?? LIVE_TIMING.requestMs));
    });
    try {
      const result = await Promise.race([this.options.run(item.value, abort.signal), deadline]);
      if (epoch === this.epoch && Date.now() - item.startedAt < (this.options.maxAgeMs ?? LIVE_TIMING.maxAgeMs)) this.options.result(result);
      else if (epoch === this.epoch) this.options.skip();
    } catch (error) {
      if (epoch === this.epoch) { this.options.skip(); this.options.error(error); }
    } finally {
      clearTimeout(timer);
      if (epoch === this.epoch) { this.current = null; this.options.busy(false); void this.pump(); }
    }
  }
}

// Detect a useful pause without treating a brief breath as the end of a phrase.
// The recording still has a hard cap if background noise hides all pauses.
export class PhraseBoundary {
  private speechSeen = false;
  private quietMs = 0;
  private peak = 0;
  observe(rms: number, durationMs: number, elapsedMs: number) {
    if (!Number.isFinite(rms) || !Number.isFinite(durationMs) || durationMs <= 0) return false;
    this.peak = Math.max(rms, this.peak * 0.995);
    const threshold = Math.max(0.008, this.peak * 0.12);
    if (rms >= threshold) { this.speechSeen = true; this.quietMs = 0; }
    else this.quietMs += Math.min(durationMs, 150);
    return this.speechSeen && elapsedMs >= 3000 && this.quietMs >= 600;
  }
}
