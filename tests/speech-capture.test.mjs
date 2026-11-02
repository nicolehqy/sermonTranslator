import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SpeechCapture, processSpeech } from '../src/lib/speech-client.ts';

for (const format of ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4']) {
  test(`preserves ${format} after recorder clears its MIME type`, async () => {
    const originalRecorder = globalThis.MediaRecorder;
    const originalFetch = globalThis.fetch;
    const clock = Object.getOwnPropertyDescriptor(globalThis, 'performance');
    let now = 0;
    Object.defineProperty(globalThis, 'performance', {configurable:true, value:{now:()=>now}});
    let recorder;
    class FakeRecorder {
      static isTypeSupported(type) { return type === format; }
      constructor(stream, options) {
        assert.equal(options.mimeType, format);
        this.mimeType = format;
        this.state = 'inactive';
        recorder = this;
      }
      start() { this.state = 'recording'; }
      stop() {
        this.mimeType = '';
        this.state = 'inactive';
        this.ondataavailable?.({data: new Blob(['recorded audio'], {type: format})});
        this.onstop?.();
      }
    }
    globalThis.MediaRecorder = FakeRecorder;
    let output;
    const capture = new SpeechCapture({active:true}, blob => { output = blob; }, assert.fail);
    try {
      capture.start();
      now = 100; capture.observeLevel(.1, 100);
      now = 200; capture.observeLevel(.1, 100);
      now = 600;
      capture.finish();
      assert.equal(recorder.mimeType, '');
      assert.equal(output.type, format);
      globalThis.fetch = async (url, options) => {
        // Round-trip through real multipart serialization, as the server does.
        const request = new Request('http://localhost/api/speech', options);
        const form = await request.formData();
        assert.equal(form.get('audio').type, format);
        assert.equal(form.get('audio').name, `speech.${format.includes('ogg') ? 'ogg' : format.includes('mp4') ? 'mp4' : 'webm'}`);
        assert.equal(form.get('sourceLanguage'), 'zh');
        return Response.json({transcript:'你好', translation:'Hello'});
      };
      await processSpeech(output, {sourceLanguage:'zh',targetLanguage:'en'}, '', new AbortController().signal);
    } finally {
      capture.cancel();
      globalThis.MediaRecorder = originalRecorder;
      globalThis.fetch = originalFetch;
      Object.defineProperty(globalThis, 'performance', clock);
    }
  });
}

test('Stop immediately after recording starts discards the tiny final segment', () => {
  const original = globalThis.MediaRecorder;
  const clock = Object.getOwnPropertyDescriptor(globalThis, 'performance');
  Object.defineProperty(globalThis, 'performance', {configurable:true, value:{now:()=>0}});
  let stopped = false;
  globalThis.MediaRecorder = class {
    static isTypeSupported() { return true; }
    mimeType = 'audio/webm';
    state = 'inactive';
    start() { this.state = 'recording'; }
    stop() { stopped = true; this.state = 'inactive'; this.ondataavailable?.({data:new Blob(['header'])}); this.onstop?.(); }
  };
  const capture = new SpeechCapture({active:true}, () => assert.fail('Tiny tail must not upload'), assert.fail);
  try {
    capture.start(); capture.finish();
    assert.equal(stopped, true);
  } finally {
    capture.cancel(); globalThis.MediaRecorder = original;
    Object.defineProperty(globalThis, 'performance', clock);
  }
});

test('silence never uploads nonempty audio containers; speaking resumes without a restart', () => {
  const original = globalThis.MediaRecorder;
  const clock = Object.getOwnPropertyDescriptor(globalThis, 'performance');
  let now = 0, recorder, completed = 0;
  const uploads = [];
  Object.defineProperty(globalThis, 'performance', { configurable:true, value:{now:()=>now} });
  globalThis.MediaRecorder = class {
    static isTypeSupported() { return true; }
    mimeType='audio/mp4'; state='inactive';
    constructor() { recorder=this; }
    start() { this.state='recording'; }
    stop() {
      this.state='inactive';
      this.ondataavailable?.({data:new Blob(['nonempty compressed audio even during silence'],{type:'audio/mp4'})});
      this.onstop?.();
    }
  };
  const capture = new SpeechCapture({active:true}, audio=>uploads.push(audio), assert.fail, ()=>completed++);
  const levels = (count, rms) => { for(let i=0;i<count;i++){ now+=100;capture.observeLevel(rms,100); } };
  const quiet = () => { levels(80,.0001); recorder.stop(); };
  const speak = () => { levels(10,.1); levels(20,.0001); };
  try {
    capture.start(); quiet(); quiet();
    assert.equal(uploads.length,0);assert.equal(completed,2);
    speak();assert.equal(uploads.length,1);
    quiet();quiet();assert.equal(uploads.length,1);assert.equal(completed,5);
    speak();assert.equal(uploads.length,2); // intentional repetition remains valid
    assert.equal(recorder.state,'recording');
  } finally { capture.cancel();globalThis.MediaRecorder=original;Object.defineProperty(globalThis,'performance',clock); }
});

test('missing level evidence and a single short click cannot upload a segment', () => {
  const original=globalThis.MediaRecorder;
  let recorder;
  globalThis.MediaRecorder=class {
    static isTypeSupported(){return true;} mimeType='audio/webm';state='inactive';
    constructor(){recorder=this;} start(){this.state='recording';}
    stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['audio'],{type:'audio/webm'})});this.onstop?.();}
  };
  const capture=new SpeechCapture({active:true},assert.fail,assert.fail);
  try {
    capture.start();recorder.stop(); // no audio-level callbacks at all
    capture.observeLevel(.5,100);capture.observeLevel(.0001,100);recorder.stop();
  } finally {capture.cancel();globalThis.MediaRecorder=original;}
});
