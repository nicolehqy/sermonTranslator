"use client";
import { useEffect, useRef, useState } from "react";

export function MicrophoneCheck({ stream }: { stream: MediaStream | null }) {
  const [level, setLevel] = useState(0);
  const [meterError, setMeterError] = useState("");
  const [error, setError] = useState("");
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [clip, setClip] = useState<string | null>(null);
  const url = useRef<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const deadline = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  function clearClip() {
    audio.current?.pause();
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = null;
    setClip(null);
  }
  function cancelTest() {
    if (timer.current) clearInterval(timer.current);
    if (deadline.current) clearTimeout(deadline.current);
    const current = recorder.current;
    recorder.current = null;
    if (current) {
      current.ondataavailable = null;
      current.onstop = null;
      current.onerror = null;
      if (current.state !== "inactive") current.stop();
    }
    setRecording(false);
    setSeconds(0);
  }

  useEffect(() => {
    setLevel(0);
    setMeterError("");
    if (!stream) return;
    // Prevent playback feeding back into the microphone on a new session.
    audio.current?.pause();
    let context: AudioContext | undefined;
    let source: MediaStreamAudioSourceNode | undefined;
    let frame = 0;
    let disposed = false;
    try {
      context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      source = context.createMediaStreamSource(stream);
      source.connect(analyser); // Never connect microphone input to speakers.
      const samples = new Float32Array(analyser.fftSize);
      const update = () => {
        if (disposed) return;
        analyser.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
        // Map -60 to 0 dBFS onto a readable 0–100 meter, not a calibrated dB SPL reading.
        setLevel(rms > 0 ? Math.max(0, Math.min(100, (20 * Math.log10(rms) + 60) / 60 * 100)) : 0);
        frame = requestAnimationFrame(update);
      };
      void context.resume().then(() => {
        if (!disposed) {
          if (context?.state === "running") update();
          else setMeterError("Level meter paused by your browser. Stop and Start again, or use the playback test.");
        }
      }).catch(() => { if (!disposed) setMeterError("Level meter unavailable. Use the playback test to check your microphone."); });
    } catch { setMeterError("Level meter unavailable. Use the playback test to check your microphone."); }
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      source?.disconnect();
      if (context && context.state !== "closed") void context.close().catch(() => {});
      cancelTest();
    };
  }, [stream]);

  useEffect(() => {
    const clear = () => {
      audio.current?.pause();
      if (url.current) URL.revokeObjectURL(url.current);
      url.current = null;
    };
    const onPageHide = () => { clear(); setClip(null); };
    window.addEventListener("pagehide", onPageHide);
    return () => { window.removeEventListener("pagehide", onPageHide); clear(); };
  }, []);

  function recordTest() {
    if (!stream || recorder.current) return;
    clearClip();
    setError("");
    const chunks: Blob[] = [];
    let size = 0;
    try {
      const current = new MediaRecorder(stream);
      recorder.current = current;
      current.ondataavailable = event => {
        if (recorder.current !== current || !event.data.size) return;
        size += event.data.size;
        if (size > 5 * 1024 * 1024) { cancelTest(); setError("Test clip was too large. Please try again."); return; }
        chunks.push(event.data);
      };
      current.onerror = () => { cancelTest(); setError("The test recording failed. Please try again."); };
      current.onstop = () => {
        if (recorder.current !== current) return;
        const blob = new Blob(chunks, { type: current.mimeType || chunks[0]?.type || "audio/webm" });
        cancelTest();
        if (!blob.size) { setError("No audio was captured. Check your microphone and try again."); return; }
        url.current = URL.createObjectURL(blob);
        setClip(url.current);
      };
      current.start(250);
      setRecording(true);
      setSeconds(5);
      const end = Date.now() + 5000;
      timer.current = setInterval(() => setSeconds(Math.max(0, Math.ceil((end - Date.now()) / 1000))), 200);
      deadline.current = setTimeout(() => { if (current.state !== "inactive") current.stop(); }, 5000);
    } catch { cancelTest(); setError("Could not record a test clip. Stop and Start the microphone, then try again."); }
  }

  return <section className="mic-check" aria-label="Microphone check">
    <div className="mic-check-row"><label className="meter-label" htmlFor="microphone-level">Microphone level</label><meter id="microphone-level" min={0} max={100} value={stream ? level : 0} aria-valuetext={stream ? `${Math.round(level)} percent` : "Microphone off"}/><span className="meter-hint">{!stream ? "Press Start first" : level > 8 ? "Sound detected" : "Speak to test"}</span></div>
    {meterError && <p role="status">{meterError}</p>}
    <div className="mic-check-row"><button className="test-button" disabled={!stream} onClick={recording ? cancelTest : recordTest}>{recording ? `Cancel test (${seconds}s)` : "Record 5-second test"}</button><span className="test-hint" role="status">{recording ? "Speak now. Recording stops automatically." : clip ? "Press Stop above, then play your clip below." : "Record a short phrase, then listen back."}</span></div>
    {clip && <div className="mic-check-row"><audio ref={audio} controls src={clip} aria-label="Your microphone test recording" onError={() => setError("This browser could not play the test clip. Try recording again.")}/><button className="test-button" onClick={clearClip}>Clear recording</button></div>}
    {error && <p role="alert" className="error">{error}</p>}
  </section>;
}
