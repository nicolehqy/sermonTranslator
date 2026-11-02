import { pcmWav } from "./pcm-audio";
import { HymnGate, type VocalMode } from "./live-policy";

// The AudioContext is created/resumed directly inside the Start gesture for Safari.
// Classification runs off the UI thread; only a short PCM window is retained.
export class HymnDetector {
  private audio = new AudioContext();
  private worker: Worker | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private mute: GainNode | null = null;
  private closed = false;
  private busy = false;
  private gate = new HymnGate();
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private lastResult = Date.now();
  private lastSample = 0;
  private pendingSamples: Float32Array | null = null;
  private speechTail: Float32Array[] = [];
  constructor(private onMode: (mode: VocalMode, resume?: { audio: Blob; startedAt: number }) => void, private onUnavailable: () => void, private onLevel: (rms: number, durationMs: number) => void = () => {}) {
    void this.audio.resume().catch(() => this.fail());
  }
  async start(stream: MediaStream) {
    if (this.closed) return;
    try {
      const worker = new Worker("/audio/hymn-worker.js");
      this.worker = worker;
      this.watchdog = setInterval(() => { if (Date.now() - this.lastResult > 20000) this.fail(); }, 2000);
      worker.onerror = () => this.fail();
      worker.onmessage = event => {
        if (this.closed) return;
        if (event.data.error) { this.fail(); return; }
        if (event.data.ready) { this.busy = false; this.lastResult = Date.now(); return; }
        this.busy = false;
        this.lastResult = Date.now();
        if (this.lastSample && event.data.at - this.lastSample > 1500) { this.gate.discontinuity(); this.speechTail = []; }
        if (this.pendingSamples) this.speechTail = [...this.speechTail.slice(-1), this.pendingSamples];
        this.pendingSamples = null;
        this.lastSample = event.data.at;
        const previous = this.gate.mode;
        const next = this.gate.update(event.data.singing, event.data.speech, 1000);
        // Replay the two classified speech windows so confirmation does not
        // throw away the first spoken words after a hymn.
        const resume = previous === "hymn" && next === "speech" && this.speechTail.length === 2
          ? { audio: pcmWav(this.speechTail, this.audio.sampleRate), startedAt: event.data.at - 2000 }
          : undefined;
        this.onMode(next, resume);
      };
      this.busy = true;
      worker.postMessage({ init: true });
      await this.audio.audioWorklet.addModule("/audio/pcm-worklet.js");
      if (this.closed) return;
      this.source = this.audio.createMediaStreamSource(stream);
      this.node = new AudioWorkletNode(this.audio, "sermon-pcm");
      this.mute = this.audio.createGain();
      this.mute.gain.value = 0;
      this.node.port.onmessage = event => {
        if (this.closed) return;
        if (typeof event.data.level === "number") {
          this.onLevel(event.data.level, event.data.durationMs); return;
        }
        if (this.busy) return;
        const samples = event.data.samples;
        if (!(samples instanceof Float32Array)) return;
        this.busy = true;
        this.pendingSamples = samples.slice();
        worker.postMessage({ samples, at: Date.now(), sampleRate: this.audio.sampleRate }, [samples.buffer]);
      };
      this.source.connect(this.node); this.node.connect(this.mute); this.mute.connect(this.audio.destination);
    } catch { this.fail(); }
  }
  private fail() { if (!this.closed) { this.stop(); this.onMode("speech"); this.onUnavailable(); } }
  stop() {
    this.closed = true;
    this.pendingSamples = null; this.speechTail = [];
    if (this.watchdog) clearInterval(this.watchdog);
    this.worker?.terminate();
    if (this.node) this.node.port.onmessage = null;
    this.source?.disconnect(); this.node?.disconnect(); this.mute?.disconnect();
    void this.audio.close().catch(() => {});
  }
}
