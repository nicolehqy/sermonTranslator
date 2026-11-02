import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transcribeAndTranslate } from '../src/services/openai-speech-service.ts';

const audio = new File(['example'], 'speech.webm', { type: 'audio/webm' });
const originalFetch = globalThis.fetch;
const originalKey = process.env.OPENAI_API_KEY;
const originalVercelKey = process.env.SERMON_TRANSLATOR_OPENAI_API_KEY;
const restore = () => { globalThis.fetch = originalFetch; if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey; if (originalVercelKey === undefined) delete process.env.SERMON_TRANSLATOR_OPENAI_API_KEY; else process.env.SERMON_TRANSLATOR_OPENAI_API_KEY = originalVercelKey; };

test('missing key fails before any provider call', async () => {
  try {
    delete process.env.OPENAI_API_KEY;
    delete process.env.SERMON_TRANSLATOR_OPENAI_API_KEY;
    globalThis.fetch = () => assert.fail('No network call expected');
    await assert.rejects(transcribeAndTranslate(audio, { sourceLanguage:'zh', targetLanguage:'en' }, '', new AbortController().signal), /OPENAI_API_KEY/);
  } finally { restore(); }
});
test('accepts the Vercel-specific API key name', async () => {
  try {
    delete process.env.OPENAI_API_KEY;
    process.env.SERMON_TRANSLATOR_OPENAI_API_KEY = 'test-only';
    globalThis.fetch = async (url) => url.endsWith('transcriptions')
      ? Response.json({ text: 'spoken text' })
      : Response.json({ status:'completed', output:[{content:[{type:'output_text',text:'translated text'}]}] });
    assert.equal((await transcribeAndTranslate(audio,{sourceLanguage:'zh',targetLanguage:'en'},'',new AbortController().signal)).translation, 'translated text');
  } finally { restore(); }
});
for (const [sourceLanguage, targetLanguage, expected] of [['zh','en','English'],['en','zh','Simplified Chinese'],['es','zh','Simplified Chinese'],['zh','es','Spanish']]) {
  test(`transcription feeds translation in ${sourceLanguage} to ${targetLanguage}`, async () => {
    try {
      process.env.OPENAI_API_KEY = 'test-only';
      let calls = 0;
      globalThis.fetch = async (url, options) => {
        calls++;
        if (url.endsWith('transcriptions')) {
          assert.equal(options.body.get('language'), sourceLanguage);
          assert.equal(options.body.get('file').size, audio.size);
          return Response.json({ text: 'spoken text' });
        }
        const body = JSON.parse(options.body);
        assert.match(body.instructions, new RegExp(expected));
        assert.equal(JSON.parse(body.input).currentTranscript, 'spoken text');
        assert.equal(body.store, false);
        assert.equal(body.model, 'gpt-5.6-sol');
        assert.deepEqual(body.reasoning, { effort: 'none' });
        return Response.json({ status:'completed', output:[{content:[{type:'output_text',text:'translated text'}]}] });
      };
      assert.deepEqual(await transcribeAndTranslate(audio, {sourceLanguage,targetLanguage}, 'earlier words', new AbortController().signal), { transcript:'spoken text', translation:'translated text' });
      assert.equal(calls, 2);
    } finally { restore(); }
  });
}
test('empty transcription does not request a translation', async () => {
  try {
    process.env.OPENAI_API_KEY = 'test-only';
    let calls = 0;
    globalThis.fetch = async () => { calls++; return Response.json({text:' '}); };
    assert.equal((await transcribeAndTranslate(audio,{sourceLanguage:'zh',targetLanguage:'en'},'',new AbortController().signal)).translation,'');
    assert.equal(calls,1);
  } finally { restore(); }
});
test('provider rate limits produce an actionable message without leaking response data', async () => {
  try {
    process.env.OPENAI_API_KEY = 'test-only';
    globalThis.fetch = async () => new Response('private upstream error',{status:429});
    await assert.rejects(transcribeAndTranslate(audio,{sourceLanguage:'zh',targetLanguage:'en'},'',new AbortController().signal), error => error.status === 429 && /billing/.test(error.message) && !error.message.includes('private'));
  } finally { restore(); }
});

for (const [status, message, expected] of [
  [400, 'Audio file is too short', /too short/],
  [400, 'Invalid audio format', /could not decode/],
  [500, 'private upstream detail', /Audio transcription failed.*500/],
]) {
  test(`reports transcription failure specifically: ${status} ${message}`, async () => {
    try {
      process.env.OPENAI_API_KEY = 'test-only';
      globalThis.fetch = async () => Response.json({error:{message}}, {status});
      await assert.rejects(transcribeAndTranslate(audio,{sourceLanguage:'zh',targetLanguage:'en'},'',new AbortController().signal), error => expected.test(error.message) && !error.message.includes('private upstream detail'));
    } finally { restore(); }
  });
}

test('skipped audio is explicitly marked in translation context', async () => {
  try {
    process.env.OPENAI_API_KEY = 'test-only';
    globalThis.fetch = async (url, options) => {
      if (url.endsWith('transcriptions')) return Response.json({text:'current words'});
      const input = JSON.parse(JSON.parse(options.body).input);
      assert.equal(input.gapBeforeCurrent, true);
      assert.equal(input.previousContext, 'earlier words');
      return Response.json({status:'completed', output:[{content:[{type:'output_text',text:'translated'}]}]});
    };
    await transcribeAndTranslate(audio, {sourceLanguage:'zh',targetLanguage:'en'}, 'earlier words', new AbortController().signal, true);
  } finally { restore(); }
});

test('recognition receives audio and language only, never old text or glossary hints', async () => {
  try {
    process.env.OPENAI_API_KEY = 'test-only';
    globalThis.fetch = async (url, options) => {
      if (url.endsWith('transcriptions')) {
        assert.equal(options.body.has('prompt'), false);
        assert.equal(options.body.has('context'), false);
        assert.equal(options.body.get('language'), 'zh');
        return Response.json({text:'马太福音记载了主祷文。'});
      }
      const input = JSON.parse(JSON.parse(options.body).input);
      assert.equal(input.previousContext, '先前真实说过的话');
      return Response.json({status:'completed', output:[{content:[{type:'output_text',text:"Matthew records the Lord’s Prayer."}]}]});
    };
    await transcribeAndTranslate(audio, {sourceLanguage:'zh',targetLanguage:'en'}, '先前真实说过的话', new AbortController().signal, true);
  } finally { restore(); }
});

for (const echo of [
  '教会基督教讲道。常见词汇：上帝、神、耶稣基督。此前听到的片段（仅供词汇参考，不要重复或补全）：马可福音11:25。',
  'Christian church sermon. Common terms: God, Jesus Christ. Previously heard excerpt (for terminology reference only; do not repeat or complete): Mark 11:25.',
  'Fragmento anterior (solo vocabulario; no repetir ni completar): Mateo.',
]) {
  test('recognition hint echoes are discarded before translation: '+echo.slice(0,25), async()=>{
    try {
      process.env.OPENAI_API_KEY='test-only';let calls=0;
      globalThis.fetch=async()=>{calls++;return Response.json({text:echo});};
      const result=await transcribeAndTranslate(audio,{sourceLanguage:'zh',targetLanguage:'en'},'',new AbortController().signal);
      assert.deepEqual(result,{transcript:'',translation:'',discarded:true});assert.equal(calls,1);
    } finally {restore();}
  });
}
test('contaminated context is excluded and real repeated speech is still translated',async()=>{
  try {
    process.env.OPENAI_API_KEY='test-only';let translations=0;
    globalThis.fetch=async(url,options)=>{
      if(url.endsWith('transcriptions'))return Response.json({text:'饶恕别人。'});
      translations++;const input=JSON.parse(JSON.parse(options.body).input);
      assert.equal(input.previousContext,'');
      return Response.json({status:'completed',output:[{content:[{type:'output_text',text:'Forgive others.'}]}]});
    };
    for(let i=0;i<2;i++)assert.equal((await transcribeAndTranslate(audio,{sourceLanguage:'zh',targetLanguage:'en'},'此前听到的片段（仅供词汇参考）：饶恕别人。',new AbortController().signal)).translation,'Forgive others.');
    assert.equal(translations,2);
  } finally {restore();}
});
test('hint text generated at the translation stage is also discarded',async()=>{
 try {
  process.env.OPENAI_API_KEY='test-only';
  globalThis.fetch=async(url)=>url.endsWith('transcriptions')?Response.json({text:'真实说过的话'}):Response.json({status:'completed',output:[{content:[{type:'output_text',text:'Previously heard excerpt: earlier words'}]}]});
  assert.equal((await transcribeAndTranslate(audio,{sourceLanguage:'zh',targetLanguage:'en'},'',new AbortController().signal)).discarded,true);
 }finally{restore();}
});
