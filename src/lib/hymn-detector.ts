import { pcmWav } from "./pcm-audio";
import { clearSpeech, HymnGate, type VocalMode } from "./live-policy";

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
  private classifierFailed = false;
  private lastLevel = Date.now();
  private levelWatchdog: ReturnType<typeof setInterval> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private lastResult = 0;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;
  private settleStartup: ((ready: boolean) => void) | null = null;
  private stage = "starting worker";
  private lastSample = 0;
  private pendingSamples: Float32Array | null = null;
  private speechTail: Float32Array[] = [];
  constructor(private onMode: (mode: VocalMode, resume?: { audio: Blob; startedAt: number }) => void, private onUnavailable: (detail?: string) => void, private onLevel: (rms: number, durationMs: number) => void = () => {}, private onAudioUnavailable: () => void = onUnavailable) {
    void this.audio.resume().catch(() => this.failAudio());
  }
  async start(stream: MediaStream) {
    if (this.closed) return false;
    const ready = new Promise<boolean>(resolve => { this.settleStartup = resolve; });
    this.startupTimer = setTimeout(() => this.failClassifier(`Startup timed out after 90 seconds (${this.stage}).`), 90000);
    try {
      const worker = new Worker("/audio/hymn-worker.js");
      this.worker = worker;
      worker.onerror = event => this.failClassifier(`${this.stage}: ${event.message || "Worker could not run."}`);
      worker.onmessageerror = () => this.failClassifier("Worker response could not be read.");
      worker.onmessage = event => {
        if (this.closed || this.worker !== worker) return;
        if (event.data.stage) this.stage = event.data.stage;
        if (event.data.error) { this.failClassifier(`${this.stage}: ${event.data.message || "Initialization failed."}`); return; }
        if (event.data.ready) { this.stage = "connecting audio processing"; this.settleStartup?.(true); return; }
        if (event.data.stage) return;
        this.busy = false;
        this.lastResult = Date.now();
        const previous = this.gate.mode;
        if (this.lastSample && event.data.at - this.lastSample > 1500) { this.gate.discontinuity(event.data.at - this.lastSample - 1000); this.speechTail = []; }
        if (this.pendingSamples) this.speechTail = [...this.speechTail.slice(-1), this.pendingSamples];
        this.pendingSamples = null;
        this.lastSample = event.data.at;
        const next = this.gate.update(event.data.singing, event.data.speech, 1000, event.data.music);
        // Replay the two classified speech windows so confirmation does not
        // throw away the first spoken words after a hymn.
        const tail = this.speechTail.slice(previous === "hymn" ? -2 : -1);
        const resume = previous !== "speech" && next === "speech" && clearSpeech(event.data.singing, event.data.speech) && tail.length > 0
          ? { audio: pcmWav(tail, this.audio.sampleRate), startedAt: event.data.at - tail.length * 1000 }
          : undefined;
        this.onMode(next, resume);
      };
      this.busy = true;
      worker.postMessage({ init: true });
      // Bound both worker initialization and worklet loading, including cancellation.
      const worklet = this.audio.audioWorklet.addModule("/audio/pcm-worklet.js");
      const initialized = await Promise.race([
        Promise.all([ready, worklet]).then(([value]) => value),
        new Promise<boolean>(resolve => {
          const previous = this.settleStartup!;
          this.settleStartup = value => { previous(value); if (!value) resolve(false); };
        }),
      ]);
      if (!initialized || this.closed || this.classifierFailed) return false;
      this.source = this.audio.createMediaStreamSource(stream);
      this.node = new AudioWorkletNode(this.audio, "sermon-pcm");
      this.mute = this.audio.createGain();
      this.mute.gain.value = 0;
      this.node.port.onmessage = event => {
        if (this.closed) return;
        if (typeof event.data.level === "number") {
          this.lastLevel = Date.now();
          this.onLevel(event.data.level, event.data.durationMs); return;
        }
        if (this.busy || !this.worker) return;
        const samples = event.data.samples;
        if (!(samples instanceof Float32Array)) return;
        this.busy = true;
        this.pendingSamples = samples.slice();
        worker.postMessage({ samples, at: Date.now(), sampleRate: this.audio.sampleRate }, [samples.buffer]);
      };
      this.source.connect(this.node); this.node.connect(this.mute); this.mute.connect(this.audio.destination);
      if (this.startupTimer) clearTimeout(this.startupTimer);
      this.startupTimer = null;
      this.settleStartup = null;
      this.busy = false;
      this.lastResult = this.lastLevel = Date.now();
      this.watchdog = setInterval(() => { if (Date.now() - this.lastResult > 20000) this.failClassifier("Music detection stopped responding for 20 seconds."); }, 2000);
      this.levelWatchdog = setInterval(() => { if (Date.now() - this.lastLevel > 15000) this.failAudio(); }, 2000);
      return true;
    } catch (error) {
      this.failClassifier(`${this.stage}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
  private failClassifier(detail = "Music detection failed.") {
    if (this.closed || this.classifierFailed) return;
    this.classifierFailed = true;
    if (this.watchdog) clearInterval(this.watchdog);
    if (this.startupTimer) clearTimeout(this.startupTimer);
    this.settleStartup?.(false); this.settleStartup = null;
    this.worker?.terminate(); this.worker = null;
    this.pendingSamples = null; this.speechTail = [];
    // Keep level monitoring alive: a classifier failure must not bypass the silence gate.
    this.onUnavailable(detail.slice(0, 400));
  }
  private failAudio() { if (!this.closed) { this.stop(); this.onAudioUnavailable(); } }
  stop() {
    this.closed = true;
    if (this.startupTimer) clearTimeout(this.startupTimer);
    this.settleStartup?.(false); this.settleStartup = null;
    this.pendingSamples = null; this.speechTail = [];
    if (this.watchdog) clearInterval(this.watchdog);
    if (this.levelWatchdog) clearInterval(this.levelWatchdog);
    this.worker?.terminate(); this.worker = null;
    if (this.node) this.node.port.onmessage = null;
    this.source?.disconnect(); this.node?.disconnect(); this.mute?.disconnect();
    void this.audio.close().catch(() => {});
  }
}
