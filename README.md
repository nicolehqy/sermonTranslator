# Sermon Translator

Next.js + React + TypeScript app for Mandarin ↔ English sermon interpretation.

## Run and configure

1. Open `.env.local` and enter your OpenAI API key after `OPENAI_API_KEY=`. Never put the key in chat, source control, or a variable beginning with `NEXT_PUBLIC_`.
2. Enable API billing in your OpenAI project. API usage is billed separately from ChatGPT.
3. Run `npm install` if dependencies are absent, then `npm run dev`. Restart the server after changing the key.
4. Open http://localhost:3000, select the direction, enable live translation, and press Start.
5. Allow microphone access and speak a short phrase. Translations arrive after each pause-delimited segment (three to eight seconds) plus provider processing time.

Models default to `gpt-4o-mini-transcribe` for speech recognition and `gpt-5.6-sol` with reasoning disabled for translation. Optional overrides are listed in `.env.example`. Model access depends on your API account.

For a hosted deployment, set `SITE_PASSWORD` to a shared access code and `ENABLE_HOSTED_SPEECH=true`. Visitors must enter the code before the app or paid speech endpoint can be used. The session cookie is HTTP-only, same-site, and expires after seven days.

## Controls and data

- With live translation off, Start runs a local microphone check. The level meter and five-second recording test remain available. Test recordings are only in browser memory and are cleared on replacement, Clear recording, or leaving the page.
- With live translation on, audio is sent through the Next.js server to OpenAI. Speech recognition receives general church terminology in the source language and up to 1,000 characters of recent source context. Transcribed text and up to 1,800 characters of prior source context are sent for translation. Responses use `store: false`; provider data handling still applies.
- Stop immediately releases the microphone and cancels pending translations. Starting again, switching mode/direction, or leaving cancels outstanding work. Requests already received by the provider may still incur usage.
- Switching direction clears the transcript. Completed translations remain after Stop. Ordinary reloading clears them. An automatic recovery reload restores the most recent 300 entries from a short-lived, tab-scoped snapshot.
- Recordings are never persisted. Transcript history stays in memory during a session; automatic reload recovery temporarily stores up to 300 text entries in sessionStorage and consumes that snapshot on reload (valid for two minutes).

## Architecture

```text
React screen / session hook
  → SpeechCapture (complete short audio files)
  → processSpeech HTTP client
  → POST /api/speech (validation and request limits)
  → transcribeAndTranslate provider service
  → OpenAI transcription, then Responses text translation
```

`src/contracts/translation.ts` holds shared direction types. The server service has no Next.js dependencies. A future FastAPI implementation can preserve the multipart request and JSON response, with the HTTP client pointed at the new backend.

`GET /api/speech` returns `{configured: boolean}` and never exposes the key. POST accepts `audio`, `sourceLanguage`, `targetLanguage`, and optional `context`; returns `{transcript, translation}`. The original `/api/translate` and mock service are retained as development references and are not used by live speech.

## Validation

```sh
npm run build
node --experimental-transform-types --test tests/*.test.mjs
```

Provider tests use simulated responses, not live API calls. They cover both directions, missing keys, empty transcripts, and rate limits. Microphone tests cover device release, late permission resolution, and failure handling. The UI missing-key path has been checked in the browser. Real API accuracy and latency still need testing with a configured key.

## Prototype limits and deployment

This version uses independent recordings cut after a sustained pause (at least three seconds) or capped at eight seconds, not a continuous Realtime connection. Boundaries can split words and introduce small recording gaps. Silence/noise can still lead to incorrect transcriptions. The new detector identifies singing; it is not a general silence filter or semantic sentence detector; pause detection only estimates phrase boundaries. Review sermon terminology and Bible references during practice before live use.

Requests run sequentially with only the newest waiting segment retained. `LIVE_TIMING` in `src/lib/live-policy.ts` configures an eight-second recording cap, a sixteen-second maximum age measured from recording start, and an eight-second request limit. A 600 ms quiet interval after at least three seconds can end a recording early; without working audio-level detection, the eight-second cap is used. The server has an 8.5-second provider timeout. These are freshness limits, not a guarantee that every phrase is translated within ten seconds. Audio uploads remain capped at 3.5 MB.

## Hymns and recovery

- MediaPipe Tasks Audio 1.2.0 runs the bundled YAMNet model in a local Web Worker. An AudioWorklet supplies one-second mono windows; no classifier audio is uploaded. `npm run prepare:audio` copies the pinned runtime from node_modules before dev/build. The model and license are under `public/audio/`.
- Five seconds of sustained singing/choir evidence switches to **Hymn ♫**. Instrumental music alone does not activate it. Clear speech takes priority. Two seconds of clear speech resumes translation. Thresholds in `HymnGate` are provisional and need Mandarin church audio calibration.
- Suspected singing holds the newest pending segment. Confirmed hymns cancel pending translations. While in hymn mode no translation requests are sent. At the return-to-speech boundary, the two confirmed speech windows are encoded as a short WAV and submitted before new recordings. This preserves the speech heard during confirmation while discarding the mixed recorder segment. Classification can still miss words at ambiguous boundaries.
- If the detector cannot load or stops responding, translation continues with a notice. A sixteen-second freshness limit still applies to segments held for classification.
- Skipped segments are marked as a gap in the translation prompt. Recent source context (up to 1,800 characters) expires after 30 seconds and is cleared at a hymn; missing audio is never reconstructed.
- Isolated failures are skipped. Three consecutive failed requests trigger an automatic session restart. If it fails again before a successful result, the page reloads, with at most two recovery reloads within five minutes. Stop, direction changes, and mode changes cancel recovery. Access/configuration/quota failures show an actionable message instead.
- Safari may require **Resume** to grant microphone access after a reload. Hymn detection may also require a fresh Start gesture to activate Web Audio. Keep the page in the foreground; background suspension/phone locking cannot guarantee continuous capture.
- The reference YouTube recording was not fetched or used to calibrate the classifier. Automated tests cover the state transitions, queue deadlines, and recovery; the bundled worker/model was smoke-tested with silent PCM in the in-app browser. Real iPhone/iPad Safari and Mandarin worship audio remain required field checks.

The app builds with the standard Next.js/Vercel workflow. Paid speech is disabled on Vercel unless `ENABLE_HOSTED_SPEECH=true` is explicitly configured. Set a strong `SITE_PASSWORD` first; the speech route verifies the session independently of the page redirect. For a larger audience, replace the shared code with individual accounts and durable per-user rate limits. Store the API key only as a server environment variable.

Official API guides:
- https://developers.openai.com/api/docs/guides/speech-to-text
- https://developers.openai.com/api/docs/guides/text


## Accuracy retesting

The initial three-second hard cuts were replaced after a Mandarin test produced fragmented phrases and homophone errors. About ten seconds remains the latency target, but the sixteen-second safety limit allows longer phrases to finish rather than discarding them at ten seconds. The configured models have not changed.

Enable **Show recognized Mandarin** (or the selected source language) to compare each recognized phrase with its English translation. These source phrases remain in the same browser session/history as translations; no raw audio is stored. This helps distinguish recognition errors from translation errors. Unit tests verify pause timing, context plumbing, and recovery, not actual recognition accuracy. Reread the forgiveness passage naturally, then compare the source and translated text; do not treat the supplied passage as an expected-output script.
