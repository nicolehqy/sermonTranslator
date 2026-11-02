import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MicrophoneSession, microphoneError } from '../src/lib/microphone.ts';

function setup(getUserMedia) {
  const track = { readyState: 'live', onended: null, stops: 0, stop() { this.stops++; } };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  class Recorder {
    static latest;
    state = 'inactive';
    constructor() { Recorder.latest = this; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.onstop?.(); }
  }
  Object.defineProperty(globalThis, 'isSecureContext', { value: true, configurable: true });
  Object.defineProperty(globalThis, 'navigator', { value: { mediaDevices: { getUserMedia: getUserMedia ?? (async () => stream) } }, configurable: true });
  globalThis.MediaRecorder = Recorder;
  return { track, stream, Recorder };
}

test('captures chunks then releases microphone and suppresses late output', async () => {
  const { track, Recorder } = setup();
  const session = new MicrophoneSession();
  let bytes = 0;
  assert.equal(await session.start(n => bytes += n, assert.fail), true);
  const late = Recorder.latest.ondataavailable;
  late({ data: { size: 32 } });
  assert.equal(bytes, 32);
  session.stop();
  late({ data: { size: 64 } });
  assert.equal(bytes, 32);
  assert.equal(track.stops, 1);
  assert.equal(Recorder.latest.state, 'inactive');
});

test('permission resolving after cancellation releases stream without recording', async () => {
  let resolve;
  const { track, stream, Recorder } = setup(() => new Promise(r => resolve = r));
  const session = new MicrophoneSession();
  const start = session.start(assert.fail, assert.fail);
  session.stop();
  resolve(stream);
  assert.equal(await start, false);
  assert.equal(track.stops, 1);
  assert.equal(Recorder.latest, undefined);
});

test('device disconnection stops recording and reports a recoverable error', async () => {
  const { track, Recorder } = setup();
  let message;
  const session = new MicrophoneSession();
  await session.start(() => {}, m => message = m);
  track.onended();
  assert.match(message, /disconnected/);
  assert.equal(track.stops, 1);
  assert.equal(Recorder.latest.state, 'inactive');
});

test('denied permission and missing/busy devices have useful messages', async () => {
  setup(async () => { throw new DOMException('', 'NotAllowedError'); });
  await assert.rejects(new MicrophoneSession().start(assert.fail, assert.fail), { name: 'NotAllowedError' });
  for (const [name, text] of [['NotAllowedError', /denied/], ['NotFoundError', /No microphone/], ['NotReadableError', /another app/]]) {
    assert.match(microphoneError(new DOMException('', name)), text);
  }
});

test('recorder initialization failure releases acquired microphone', async () => {
  const { track } = setup();
  globalThis.MediaRecorder = class { constructor() { throw new Error('Recorder unavailable'); } };
  await assert.rejects(new MicrophoneSession().start(assert.fail, assert.fail), /Recorder unavailable/);
  assert.equal(track.stops, 1);
});
