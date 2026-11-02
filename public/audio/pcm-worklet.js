class SermonPCM extends AudioWorkletProcessor {
  constructor() { super(); this.samples = new Float32Array(sampleRate); this.offset = 0; this.energy = 0; this.levelCount = 0; }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let value = 0;
      for (const channel of channels) value += channel[i];
      const mono = value / channels.length;
      this.samples[this.offset++] = mono;
      this.energy += mono * mono; this.levelCount++;
      if (this.levelCount >= sampleRate / 10) {
        this.port.postMessage({ level: Math.sqrt(this.energy / this.levelCount), durationMs: this.levelCount / sampleRate * 1000 });
        this.energy = 0; this.levelCount = 0;
      }
      if (this.offset === this.samples.length) {
        this.port.postMessage({ samples: this.samples }, [this.samples.buffer]);
        this.samples = new Float32Array(sampleRate); this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor("sermon-pcm", SermonPCM);
