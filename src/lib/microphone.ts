export function microphoneError(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  switch (name) {
    case "NotAllowedError": return "Microphone access was denied. Allow microphone access in your browser and system settings, then press Start again.";
    case "NotFoundError": return "No microphone was found. Connect a microphone and try again.";
    case "NotReadableError": return "Your microphone could not be opened. Check whether another app is using it, then try again.";
    case "AbortError": return "Microphone access was interrupted. Please try again.";
    default: return error instanceof Error ? error.message : "Unable to start the microphone. Please try again.";
  }
}

// Owns browser resources separately from React. No audio leaves the device.
export class MicrophoneSession {
  private generation = 0;
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;

  getStream(): MediaStream | null { return this.stream; }

  stop() {
    this.generation++;
    const recorder = this.recorder;
    this.recorder = null;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onerror = null;
      recorder.onstop = null;
    }
    // Release the device even if stopping the recorder fails.
    try { if (recorder && recorder.state !== "inactive") recorder.stop(); }
    finally {
      this.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
      this.stream = null;
    }
  }

  async start(onChunk: (bytes: number) => void, onFailure: (message: string) => void): Promise<boolean> {
    this.stop();
    const generation = this.generation;
    if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone access requires a supported browser on HTTPS or localhost.");
    }
    if (typeof MediaRecorder === "undefined") throw new Error("Audio capture is not supported in this browser. Try a current version of Chrome, Edge, Firefox, or Safari.");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    // Permission can resolve after Stop, direction changes, or leaving the page.
    if (generation !== this.generation) {
      stream.getTracks().forEach(track => track.stop());
      return false;
    }
    this.stream = stream;
    const fail = (message: string) => {
      if (generation !== this.generation) return;
      this.stop();
      onFailure(message);
    };
    try {
      const tracks = stream.getAudioTracks();
      if (!tracks.length || tracks.some(track => track.readyState === "ended")) throw new Error("The microphone disconnected. Reconnect it and press Start.");
      tracks.forEach(track => { track.onended = () => fail("The microphone disconnected or access was revoked. Check the device and press Start again."); });
      const recorder = new MediaRecorder(stream);
      this.recorder = recorder;
      recorder.ondataavailable = event => {
        if (generation === this.generation && event.data.size > 0) onChunk(event.data.size);
        // Chunks are discarded immediately until transcription is connected.
      };
      recorder.onerror = () => fail("Audio capture stopped unexpectedly. Please press Start to try again.");
      recorder.onstop = () => fail("Audio capture ended. Please press Start to try again.");
      recorder.start(1000);
      return true;
    } catch (error) { this.stop(); throw error; }
  }
}
