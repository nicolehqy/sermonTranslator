"use client";
import { useEffect, useRef, useState } from "react";
import { getTranslationDirection, type TranscriptSentence, type TranslationDirection } from "@/contracts/translation";
import { MicrophoneSession, microphoneError } from "@/lib/microphone";
import { SpeechCapture, processSpeech, SpeechRequestError } from "@/lib/speech-client";
import { HymnDetector } from "@/lib/hymn-detector";
import { LatestQueue, LIVE_TIMING, recentReloads, type VocalMode } from "@/lib/live-policy";

const RECOVERY_KEY = "sermon-recovery-v1";
const RELOAD_KEY = "sermon-reloads-v1";
type Result = { transcript: string; translation: string; discarded?: boolean };
function readStored(key: string) { try { return JSON.parse(sessionStorage.getItem(key) || "null"); } catch { return null; } }
function clearRecovery() { try { sessionStorage.removeItem(RECOVERY_KEY); } catch {} }

export function useLiveTranslation() {
  const [direction, setDirection] = useState<TranslationDirection>({ sourceLanguage: "zh", targetLanguage: "en" });
  const [status, setStatus] = useState<"idle" | "requesting" | "listening">("idle");
  const [sentences, setSentences] = useState<TranscriptSentence[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [audioReceived, setAudioReceived] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [hymn, setHymn] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [resumeNeeded, setResumeNeeded] = useState(false);
  const session = useRef<MicrophoneSession | null>(null);
  const capture = useRef<SpeechCapture | null>(null);
  const detector = useRef<HymnDetector | null>(null);
  const queue = useRef<LatestQueue<Blob, Result> | null>(null);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const active = useRef(false);
  const mounted = useRef(true);
  const reloading = useRef(false);
  const restoredSnapshot = useRef<ReturnType<typeof readStored>>(undefined);
  const context = useRef("");
  const contextAt = useRef(0);
  const gap = useRef(false);
  const mode = useRef<VocalMode>("speech");
  const nextId = useRef(0);
  const history = useRef<TranscriptSentence[]>([]);
  const restartCount = useRef(0);
  const failures = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const watchdog = useRef<ReturnType<typeof setInterval> | null>(null);
  const latestStart = useRef<(d?: TranslationDirection, recovery?: boolean) => Promise<void>>(async () => {});
  function append(text: string, sourceText?: string) {
    history.current = [...history.current, { id: nextId.current++, text, ...(sourceText ? { sourceText } : {}) }];
    setSentences(history.current);
  }
  function release() {
    generation.current++;
    active.current = false;
    if (timer.current) clearTimeout(timer.current);
    if (watchdog.current) clearInterval(watchdog.current);
    detector.current?.stop(); detector.current = null;
    capture.current?.cancel(); capture.current = null;
    queue.current?.cancel(); queue.current = null;
    request.current?.abort();
    session.current?.stop();
  }
  function stop() {
    clearRecovery(); release();
    setStream(null); setStatus("idle"); setAudioReceived(false); setProcessing(false);
    setRecovering(false); setHymn(false); setResumeNeeded(false);
    mode.current = "speech";
  }
  function reload(d: TranslationDirection) {
    const now = Date.now();
    const attempts = recentReloads(readStored(RELOAD_KEY), now);
    if (attempts.length >= 2) {
      stop(); setResumeNeeded(true); setError("Connection is still unavailable. Tap Resume when ready."); return;
    }
    try {
      // Bounded text-only snapshot; recordings and microphone permissions are never stored.
      sessionStorage.setItem(RECOVERY_KEY, JSON.stringify({ at: now, direction: d, sentences: history.current.slice(-300), enabled: true }));
      sessionStorage.setItem(RELOAD_KEY, JSON.stringify([...attempts, now]));
      reloading.current = true; release(); window.location.reload();
    } catch { stop(); setResumeNeeded(true); setError("Tap Resume to reconnect."); }
  }
  function recover(d: TranslationDirection) {
    if (!active.current || !mounted.current) return;
    release(); setStream(null); setProcessing(false); setRecovering(true); setStatus("requesting");
    gap.current = true;
    const token = generation.current;
    timer.current = setTimeout(() => {
      if (!mounted.current || token !== generation.current) return;
      if (restartCount.current++ >= 1) reload(d);
      else void latestStart.current(d, true);
    }, navigator.onLine ? 1500 : 5000);
  }
  async function start(d = direction, recovery = false) {
    release(); clearRecovery();
    if (!recovery) { restartCount.current = 0; failures.current = 0; context.current = ""; contextAt.current = 0; gap.current = false; }
    setError(null); setNotice(null); setResumeNeeded(false); setHymn(false);
    setRecovering(recovery); setStatus("requesting"); mode.current = "speech";
    active.current = true;
    const current = generation.current;
    const valid = () => mounted.current && current === generation.current;
    const abort = new AbortController(); request.current = abort;
    // Must happen before awaiting permissions/network on Safari.
    let listener: HymnDetector | null = null;
    if (enabled) {
      try {
        listener = new HymnDetector((next, resume) => {
          if (!valid()) return;
          const previous = mode.current; mode.current = next;
          setHymn(next === "hymn");
          if (next === "hymn" && previous !== "hymn") {
            queue.current?.cancel(); queue.current?.hold(true);
            context.current = ""; gap.current = true;
            append("Hymn ♫");
          } else if (previous === "hymn" && next === "speech") {
            // Replace mixed recorder audio with the confirmed speech PCM tail.
            capture.current?.cancel(); beginCapture();
            queue.current?.hold(false);
            if (resume) queue.current?.push(resume.audio, resume.startedAt);
          } else queue.current?.hold(next !== "speech");
        }, () => { if (valid()) setNotice("Hymn detection is unavailable. Translation is still on."); },
        (rms, durationMs) => { if (valid()) capture.current?.observeLevel(rms, durationMs); },
        () => { if (valid()) { stop(); setResumeNeeded(true); setError("Audio detection stopped. Tap Resume to continue listening."); } });
        detector.current = listener;
      } catch {
        stop(); setResumeNeeded(true); setError("Audio detection could not start. Tap Resume to try again."); return;
      }
    }
    let lastAudio = Date.now();
    const beginCapture = () => {
      const media = session.current?.getStream();
      if (!media || !valid()) return;
      lastAudio = Date.now();
      capture.current = new SpeechCapture(media, (audio, startedAt) => {
        if (!valid()) return;
        lastAudio = Date.now();
        if (mode.current === "hymn") return;
        queue.current?.push(audio, startedAt);
      }, () => { if (valid()) recover(d); }, () => { if (valid()) lastAudio = Date.now(); });
      capture.current.start();
    };
    try {
      session.current ??= new MicrophoneSession();
      // Acquire the microphone immediately following the user's Start gesture.
      const started = await session.current.start(
        () => { if (valid()) setAudioReceived(true); },
        () => { if (valid()) recover(d); },
      );
      if (!valid() || !started) return;
      if (enabled) {
        const configAbort = new AbortController();
        const timeout = setTimeout(() => configAbort.abort(), 7000);
        const cancel = () => configAbort.abort(); abort.signal.addEventListener("abort", cancel, { once: true });
        try {
          const response = await fetch("/api/speech", { signal: configAbort.signal });
          if ([401, 403].includes(response.status) || response.redirected) throw new SpeechRequestError("Enter the site access code to continue.", 401);
          const result = await response.json();
          setConfigured(result.configured === true);
          if (!result.configured) throw new SpeechRequestError("Translation is not configured. Ask the site operator to check the API key.", 503, "configuration");
        } finally { clearTimeout(timeout); abort.signal.removeEventListener("abort", cancel); }
      }
      if (!valid()) return;
      const media = session.current.getStream()!;
      setStream(media); setStatus("listening"); setRecovering(false);
      if (!enabled) return;
      queue.current = new LatestQueue({
        run: (audio, signal) => {
          if (Date.now() - contextAt.current > LIVE_TIMING.contextAgeMs) context.current = "";
          const skipped = gap.current; gap.current = false;
          return processSpeech(audio, d, context.current, signal, skipped);
        },
        result: result => {
          if (!valid() || mode.current !== "speech") { gap.current = true; return; }
          failures.current = 0; restartCount.current = 0;
          if (result.discarded) { context.current = ""; contextAt.current = 0; gap.current = true; return; }
          if (result.translation) {
            context.current = (context.current + " " + result.transcript).slice(-1800); contextAt.current = Date.now();
            append(result.translation, result.transcript);
          }
        },
        skip: () => { gap.current = true; },
        error: error => {
          if (!valid()) return;
          if (error instanceof SpeechRequestError && error.fatal) { stop(); setError(error.message); }
          else if (++failures.current >= 3) { failures.current = 0; recover(d); }
        },
        busy: value => { if (valid()) setProcessing(value); },
      });
      beginCapture();
      if (listener) void listener.start(media);
      watchdog.current = setInterval(() => { if (valid() && Date.now() - lastAudio > 15000 && document.visibilityState === "visible") recover(d); }, 3000);
    } catch (error) {
      if (!valid()) return;
      if (error instanceof SpeechRequestError && error.fatal) { stop(); setError(error.message); return; }
      if (recovery && !(error instanceof DOMException && error.name === "NotAllowedError")) { recover(d); return; }
      stop(); setResumeNeeded(recovery); setError(microphoneError(error));
    }
  }
  latestStart.current = start;
  useEffect(() => {
    mounted.current = true;
    let restored: TranslationDirection | undefined;
    try { const saved = localStorage.getItem("sermon-translator-direction")?.split("-"); restored = getTranslationDirection(saved?.[0], saved?.[1]); } catch {}
    if (restored) setDirection(restored);
    const saved = restoredSnapshot.current ?? readStored(RECOVERY_KEY);
    restoredSnapshot.current = saved; clearRecovery();
    if (saved && typeof saved.at === "number" && Date.now() - saved.at >= 0 && Date.now() - saved.at < 120000) {
      const d = getTranslationDirection(saved.direction?.sourceLanguage, saved.direction?.targetLanguage);
      if (d && Array.isArray(saved.sentences)) {
        const text = saved.sentences.filter((s: TranscriptSentence) => typeof s?.text === "string").slice(-300);
        history.current = text.map((s: TranscriptSentence, id: number) => ({ id, text: s.text, ...(typeof s.sourceText === "string" ? { sourceText: s.sourceText } : {}) }));
        nextId.current = history.current.length; setSentences(history.current); setDirection(d);
        restartCount.current = 1;
        timer.current = setTimeout(() => void latestStart.current(d, true), 0);
      }
    }
    const abort = new AbortController();
    void fetch("/api/speech", { signal: abort.signal }).then(r => r.json()).then(r => setConfigured(r.configured === true)).catch(() => {});
    const hide = () => { if (reloading.current) release(); else stop(); };
    window.addEventListener("pagehide", hide);
    return () => { mounted.current = false; abort.abort(); window.removeEventListener("pagehide", hide); release(); };
  }, []);
  function toggle() { if (active.current || recovering) stop(); else void start(); }
  function changeDirection(d: TranslationDirection) {
    stop(); setError(null); history.current = []; setSentences([]); nextId.current = 0; context.current = ""; gap.current = false;
    setDirection(d);
    try { localStorage.setItem("sermon-translator-direction", `${d.sourceLanguage}-${d.targetLanguage}`); } catch {}
  }
  function changeEnabled(value: boolean) { stop(); setError(null); setEnabled(value); }
  return { running: status === "listening", requesting: status === "requesting", stream, audioReceived, sentences, error, notice, hymn, recovering, resumeNeeded, toggle, direction, changeDirection, enabled, changeEnabled, configured, processing };
}
