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

test('Mandarin recognition gets sermon vocabulary and bounded source context before translation', async () => {
  try {
    process.env.OPENAI_API_KEY = 'test-only';
    globalThis.fetch = async (url, options) => {
      if (url.endsWith('transcriptions')) {
        const prompt = options.body.get('prompt');
        assert.match(prompt, /教会基督教讲道/);
        assert.match(prompt, /饶恕/); assert.match(prompt, /马太福音/);
        assert.match(prompt, /中间有音频缺失/); assert.match(prompt, /先前的话/);
        assert.ok(prompt.length < 1500);
        assert.doesNotMatch(prompt, /6:9|六章九|Rao|Deli/); // not hard-coded to the reported example
        return Response.json({text:'马太福音记载了主祷文。'});
      }
      return Response.json({status:'completed', output:[{content:[{type:'output_text',text:"Matthew records the Lord’s Prayer."}]}]});
    };
    await transcribeAndTranslate(audio, {sourceLanguage:'zh',targetLanguage:'en'}, '前'.repeat(2000)+'先前的话', new AbortController().signal, true);
  } finally { restore(); }
});
