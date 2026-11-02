"use client";
import { useEffect, useRef, useState } from "react";
import { MicrophoneCheck } from "@/components/microphone-check";
import { useLiveTranslation } from "@/hooks/use-live-translation";
import type { TranslationDirection } from "@/contracts/translation";

const directionOptions: { value: string; label: string; direction: TranslationDirection }[] = [
  { value: "zh-en", label: "Mandarin → English", direction: { sourceLanguage: "zh", targetLanguage: "en" } },
  { value: "en-zh", label: "English → Mandarin", direction: { sourceLanguage: "en", targetLanguage: "zh" } },
  { value: "zh-es", label: "Mandarin → Spanish", direction: { sourceLanguage: "zh", targetLanguage: "es" } },
  { value: "es-zh", label: "Spanish → Mandarin", direction: { sourceLanguage: "es", targetLanguage: "zh" } },
];

const languageNames = { zh: "Mandarin", en: "English", es: "Spanish" } as const;

export function TranslationWorkspace() {
  const { running, requesting, stream, audioReceived, sentences, error, toggle, direction, changeDirection, enabled, changeEnabled, configured, processing, hymn, recovering, resumeNeeded, notice } = useLiveTranslation();
  const [showSource, setShowSource] = useState(false);
  const source = languageNames[direction.sourceLanguage];
  const target = languageNames[direction.targetLanguage];
  const directionValue = `${direction.sourceLanguage}-${direction.targetLanguage}`;
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (panel.current) panel.current.scrollTop = panel.current.scrollHeight;
  }, [sentences]);
  return <main className="workspace">
    <header className="masthead"><a className="brand" href="/" aria-label="Sermon Translator home"><span className="brand-mark" aria-hidden="true">✦</span> Sermon Translator</a><span className="demo-badge">{enabled ? "LIVE TRANSLATION" : "MICROPHONE CHECK"}</span></header>
    <section className="intro"><span className="eyebrow">A SHARED WORD</span><h1>Listen together.<br /><em>Understand together.</em></h1></section>
    <section className="translator" aria-label="Live sermon translation">
      <div className="controls"><div className="direction"><span className="language-symbol" aria-hidden="true">文</span><label><span className="small-label">TRANSLATION DIRECTION</span><select className="direction-select" value={directionValue} onChange={event => {
        const selected = directionOptions.find(option => option.value === event.target.value);
        if (selected) changeDirection(selected.direction);
      }}>{directionOptions.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label></div><button className={running || requesting ? "toggle stop" : "toggle"} onClick={toggle}>{running || requesting ? <span aria-hidden="true">■</span> : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/></svg>}{requesting ? "Cancel" : running ? "Stop" : resumeNeeded ? "Resume" : "Start"}</button></div>
      <div className="translation-mode"><label><input type="checkbox" checked={enabled} onChange={event => changeEnabled(event.target.checked)} /> Enable live translation</label><p>{enabled ? "Start sends microphone audio to OpenAI for transcription and translation. API usage is billed to your account." : "Microphone check only. Audio stays in this browser."}</p>{!configured && <p>Live translation needs an OpenAI API key configured on the server.</p>}</div>
      {enabled && <div className="translation-mode"><label><input type="checkbox" checked={showSource} onChange={event => setShowSource(event.target.checked)} /> Show recognized {source}</label></div>}
      {!enabled && <MicrophoneCheck stream={stream} />}
      <div className="panel-heading"><h2>Live translation</h2><span className={running ? "status active" : "status"} role="status"><i />{recovering ? "Reconnecting…" : hymn ? "Hymn ♫" : requesting ? "Allow microphone access…" : running ? processing ? "Listening · translating…" : "Listening · microphone on" : processing ? "Finishing translation…" : "Microphone off"}</span></div>
      <div className="transcript" ref={panel} role="log" aria-label={`${target} translation`} lang={direction.targetLanguage} aria-live="polite" aria-relevant="additions" tabIndex={0}>
        {sentences.length === 0 ? <div className="empty" lang="en"><div className="sound-lines" aria-hidden="true"><i/><i/><i/><i/><i/></div><h3>{running ? enabled ? "Listening for your message." : "Your microphone is on." : requesting ? "Waiting for your permission." : "A little space for the Word."}</h3><p>{running ? enabled ? "Speak naturally. Translation will appear after pauses or short sections." : "Use the microphone test above to listen back." : requesting ? "Allow microphone access in your browser, or press Cancel." : "Press Start to turn on your microphone."}<br/>{enabled ? "Translations arrive in short segments with a few seconds of delay." : "Enable live translation when you are ready."}</p></div> : <div className="sentences">{sentences.map(sentence => <p key={sentence.id}><span className="sentence-number" aria-hidden="true">{String(sentence.id + 1).padStart(2, "0")}</span>{sentence.text}{showSource && sentence.sourceText && <span className="recognized-source" lang={direction.sourceLanguage}>{sentence.sourceText}</span>}</p>)}</div>}
      </div>
      <div className="panel-footer"><span>{running ? audioReceived ? "Audio capture active" : "Starting audio capture…" : "Microphone off"}</span><span>New sentences scroll into view <span aria-hidden="true">↓</span></span></div>
    </section>
    {notice && <p className="demo-note" role="status">{notice}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    <p className="demo-note"><span aria-hidden="true">◌</span> {enabled ? "Audio is sent to OpenAI while listening. Stop releases the microphone. Delayed segments are skipped to keep up with the service." : "Test clips stay in this tab until cleared or you leave. No audio is uploaded in microphone-check mode."}</p>
    <footer className="page-footer">{source.toUpperCase()} → {target.toUpperCase()}<span>Nicole Han for Pastor Duncan &amp; Frances</span></footer>
  </main>;
}
