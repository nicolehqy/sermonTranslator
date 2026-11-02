import { LIVE_TIMING, PhraseBoundary } from "./live-policy.ts";
import type { TranslationDirection } from "@/contracts/translation";
export class SpeechRequestError extends Error {
  constructor(message: string, public status: number, public code = "") { super(message); }
  get fatal() { return [401, 403].includes(this.status) || ["configuration", "quota"].includes(this.code); }
}
export async function processSpeech(audio: Blob, direction: TranslationDirection, context: string, signal: AbortSignal, gap = false): Promise<{ transcript: string; translation: string; discarded?: boolean }> {
  const form = new FormData();
  const extension = audio.type.includes("wav") ? "wav" : audio.type.includes("mp4") ? "mp4" : audio.type.includes("ogg") ? "ogg" : "webm";
  form.set("audio", audio, `speech.${extension}`);
  form.set("sourceLanguage", direction.sourceLanguage);
  form.set("targetLanguage", direction.targetLanguage);
  form.set("context", context);
  form.set("gap", String(gap));
  const response = await fetch("/api/speech", { method: "POST", body: form, signal });
  const result = await response.json().catch(() => ({ error: "Translation connection was interrupted." }));
  if (!response.ok) throw new SpeechRequestError(result.error || "Translation failed. Please try again.", response.status, result.code);
  if (typeof result.transcript !== "string" || typeof result.translation !== "string") throw new Error("Invalid speech response.");
  return result;
}

// Each segment is a complete media file, never an undecodable timeslice fragment.
export class SpeechCapture {
  private recorder: MediaRecorder | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private cancelled = false;
  private finishing = false;
  private startedAt = 0;
  private wallStartedAt = 0;
  private boundary = new PhraseBoundary();
  constructor(private stream: MediaStream, private onAudio: (audio: Blob, startedAt: number) => void, private onError: () => void, private onSegment: () => void = () => {}) {}
  start() {
    if (this.cancelled) return;
    try {
      const requestedType = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"]
        .find(type => MediaRecorder.isTypeSupported(type));
      const recorder = requestedType
        ? new MediaRecorder(this.stream, { mimeType: requestedType })
        : new MediaRecorder(this.stream);
      // Some browsers clear mimeType when the recorder stops.
      let recordingType = recorder.mimeType || requestedType || "";
      this.recorder = recorder;
      const chunks: Blob[] = [];
      let size = 0;
      recorder.ondataavailable = event => {
        if (this.cancelled) return;
        size += event.data.size;
        if (size > 3_500_000) { this.cancel(); this.onError(); return; }
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onerror = () => { this.cancel(); this.onError(); };
      recorder.onstop = () => {
        if (this.cancelled) return;
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        const mimeType = chunks.find(chunk => /^audio\//i.test(chunk.type))?.type
          || recordingType || recorder.mimeType;
        if (!mimeType || !/^audio\//i.test(mimeType)) {
          this.cancel(); this.onError(); return;
        }
        const blob = new Blob(chunks, { type: mimeType });
        this.recorder = null;
        // Empty/silent recordings must never reach speech recognition. This
        // also fails closed when the level monitor has not supplied evidence.
        this.onSegment();
        if (blob.size && this.boundary.hasSpeechActivity) this.onAudio(blob, this.wallStartedAt);
        if (!this.cancelled && !this.finishing && this.stream.active) this.start();
      };
      this.boundary = new PhraseBoundary();
      this.startedAt = performance.now();
      this.wallStartedAt = Date.now();
      recorder.start(250);
      recordingType = recorder.mimeType || recordingType;
      this.timer = setTimeout(() => { if (recorder.state !== "inactive") recorder.stop(); }, LIVE_TIMING.segmentMs);
    } catch { this.cancel(); this.onError(); }
  }
  observeLevel(rms: number, durationMs: number) {
    if (this.cancelled || this.finishing || this.recorder?.state !== "recording") return;
    if (this.boundary.observe(rms, durationMs, performance.now() - this.startedAt)) {
      if (this.timer) clearTimeout(this.timer);
      this.recorder.stop();
    }
  }
  finish() {
    // A Stop immediately after a segment boundary can produce a header-only
    // or extremely short final file that transcription cannot process.
    if (this.recorder && performance.now() - this.startedAt < 100) {
      this.cancel();
      return;
    }
    this.finishing = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
  }
  cancel() {
    this.cancelled = true;
    if (this.timer) clearTimeout(this.timer);
    const recorder = this.recorder;
    this.recorder = null;
    if (recorder) {
      recorder.onstop = null; recorder.ondataavailable = null; recorder.onerror = null;
      if (recorder.state !== "inactive") recorder.stop();
    }
  }
}
