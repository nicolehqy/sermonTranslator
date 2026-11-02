// Exercise the actual session hook with deterministic browser/audio boundaries.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { LatestQueue, LIVE_TIMING, recentReloads } from '../src/lib/live-policy.ts';
import { SpeechRequestError } from '../src/lib/speech-client.ts';
const source = stripTypeScriptTypes(readFileSync(new URL('../src/hooks/use-live-translation.ts', import.meta.url), 'utf8'))
  .replace(/import \{([^}]+)\} from ["']([^"']+)["'];/g, (_, names, path) => `const {${names}} = require(${JSON.stringify(path)});`)
  .replace('export function useLiveTranslation', 'function useLiveTranslation') + '\nexports.useLiveTranslation = useLiveTranslation;';
const flush = async () => { for (let i=0; i<20; i++) await Promise.resolve(); };
function harness({ speechError = null, saved = null, permissionDenied = false } = {}) {
  const slots = []; let index = 0; const effects = []; const timers = new Map(); const handlers = {}; let timerId = 0, reloads = 0, stops = 0;
  const storage = new Map(saved ? [['sermon-recovery-v1', JSON.stringify(saved)]] : []);
  const intervals = new Map(); let now = Date.now(); let audioUnavailable;
  const captures = []; let mode; let speechCalls = 0;
  class MicrophoneSession { async start() { if (permissionDenied) throw new DOMException('denied', 'NotAllowedError'); return true; } stop() { stops++; } getStream() { return {active:true}; } }
  class SpeechCapture { constructor(stream, onAudio, onError, onSegment) { this.onSegment=onSegment; this.onAudio=onAudio; this.onError=onError; captures.push(this); } start() {} cancel() { this.cancelled = true; } }
  class HymnDetector { constructor(callback, unavailable, level, failAudio) { mode=callback; audioUnavailable=failAudio; } start() {} stop() {} }
  const react = {
    useRef(value) { const i=index++; return slots[i] ??= {current:value}; },
    useState(value) { const i=index++; if (!(i in slots)) slots[i]=value; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useEffect(fn) { const i=index++; if (!(i in slots)) { slots[i]=true; effects.push(fn); } },
  };
  const exports = {};
  const scope = {
    exports, AbortController, DOMException, Date: class extends Date { static now() { return now; } }, console,
    setTimeout(fn, ms) { const id=++timerId; timers.set(id,{fn,ms}); return id; }, clearTimeout(id) { timers.delete(id); },
    setInterval(fn,ms) { const id=++timerId; intervals.set(id,{fn,ms}); return id; }, clearInterval(id) { intervals.delete(id); },
    sessionStorage: {getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    localStorage: {getItem:()=>null,setItem:()=>{}}, navigator:{onLine:true}, document:{visibilityState:'visible'},
    window:{addEventListener:(name,fn)=>handlers[name]=fn,removeEventListener:()=>{},location:{reload:()=>{reloads++; handlers.pagehide?.();}}},
    fetch:async()=>({status:200,json:async()=>({configured:true})}),
    require(name) {
      if (name==='react') return react;
      if (name.includes('contracts')) return {getTranslationDirection:(s,t)=>['zh-en','en-zh','zh-es','es-zh'].includes(`${s}-${t}`)?{sourceLanguage:s,targetLanguage:t}:undefined};
      if (name.endsWith('/microphone')) return {MicrophoneSession,microphoneError:e=>e.message};
      if (name.endsWith('/speech-client')) return {SpeechCapture, SpeechRequestError, processSpeech:async()=>{speechCalls++; if(speechError) throw speechError; return {transcript:'source',translation:'translated'};}};
      if (name.endsWith('/hymn-detector')) return {HymnDetector};
      if (name.endsWith('/live-policy')) return {LatestQueue,LIVE_TIMING,recentReloads};
      throw new Error(name);
    },
  };
  vm.runInNewContext(source,scope);
  const render=()=>{index=0;return exports.useLiveTranslation();};
  render(); effects.forEach(fn=>fn());
  return {render,storage,captures, audioUnavailable:()=>audioUnavailable(),
    quiet() { now+=8000;captures.at(-1).onSegment(); for(const {fn} of intervals.values())fn(); },
    mode:value=>mode(value),get reloads(){return reloads;},get stops(){return stops;},get speechCalls(){return speechCalls;},
    async timer(ms) { for(const [id,t] of timers) if(t.ms===ms){timers.delete(id);t.fn();break;} await flush(); },
    async segment() { captures.at(-1).onAudio(new Blob(['audio']),Date.now()-3000); await flush(); },
  };
}
test('repeated translation failures restart once then reload; pagehide preserves recovery snapshot', async()=>{
  const h=harness({speechError:new Error('timeout')}); h.render().toggle(); await flush();
  await h.segment(); await h.segment(); assert.equal(h.render().running,true);
  await h.segment(); assert.equal(h.render().recovering,true);
  await h.timer(1500); assert.equal(h.render().running,true);
  await h.segment(); await h.segment(); await h.segment(); await h.timer(1500);
  assert.equal(h.reloads,1); assert.ok(h.storage.has('sermon-recovery-v1'));
});
test('Stop during recovery cancels automatic restart and reload', async()=>{
  const h=harness({speechError:new Error('timeout')});h.render().toggle();await flush();
  await h.segment();await h.segment();await h.segment();h.render().toggle();await h.timer(1500);
  assert.equal(h.render().running,false);assert.equal(h.reloads,0);assert.equal(h.captures.length,1);
});
test('fatal access failures stop with actionable message instead of refreshing', async()=>{
  const h=harness({speechError:new SpeechRequestError('Enter access code',401)});h.render().toggle();await flush();await h.segment();
  assert.equal(h.render().running,false);assert.equal(h.render().error,'Enter access code');assert.equal(h.reloads,0);
});
test('hymn mode suppresses uploads, adds one marker, and speech resumes', async()=>{
  const h=harness();h.render().toggle();await flush();await h.segment();
  h.mode('hymn');h.mode('hymn');await h.segment();
  assert.equal(h.speechCalls,1);assert.equal(h.render().sentences.filter(s=>s.text==='Hymn ♫').length,1);
  h.mode('speech');await h.segment();assert.equal(h.speechCalls,2);h.render().toggle();
});
test('reload loop is capped across page loads', async()=>{
  const h=harness({speechError:new Error('timeout')});
  h.storage.set('sermon-reloads-v1',JSON.stringify([Date.now()-1000,Date.now()]));
  h.render().toggle();await flush();
  for(let i=0;i<3;i++) await h.segment();await h.timer(1500);
  for(let i=0;i<3;i++) await h.segment();await h.timer(1500);
  assert.equal(h.reloads,0);assert.equal(h.render().resumeNeeded,true);
});
test('recovery restores text and offers Resume if microphone permission is denied', async()=>{
  const h=harness({permissionDenied:true,saved:{at:Date.now(),direction:{sourceLanguage:'zh',targetLanguage:'en'},sentences:[{text:'Earlier translation'}]}});
  await h.timer(0);
  assert.equal(h.render().sentences[0].text,'Earlier translation');assert.equal(h.render().resumeNeeded,true);assert.equal(h.reloads,0);
});

test('a full minute of silent recording keeps listening without API calls or recovery', async()=>{
 const h=harness();h.render().toggle();await flush();
 for(let i=0;i<8;i++)h.quiet();
 assert.equal(h.render().running,true);assert.equal(h.render().recovering,false);
 assert.equal(h.speechCalls,0);assert.equal(h.reloads,0);h.render().toggle();
});
test('loss of audio-level monitoring pauses rather than uploading unverified audio',async()=>{
 const h=harness();h.render().toggle();await flush();h.audioUnavailable();
 assert.equal(h.render().running,false);assert.equal(h.render().resumeNeeded,true);
 assert.equal(h.speechCalls,0);assert.equal(h.reloads,0);
});
