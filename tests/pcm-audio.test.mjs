import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pcmWav } from '../src/lib/pcm-audio.ts';
test('speech confirmation buffer produces a complete mono WAV with correct samples', async()=>{
 const blob=pcmWav([new Float32Array([-1,0]),new Float32Array([1,.5])],16000);
 assert.equal(blob.type,'audio/wav');assert.equal(blob.size,52);
 const bytes=await blob.arrayBuffer();const view=new DataView(bytes);
 assert.equal(new TextDecoder().decode(bytes.slice(0,4)),'RIFF');assert.equal(new TextDecoder().decode(bytes.slice(8,12)),'WAVE');
 assert.equal(view.getUint32(24,true),16000);assert.equal(view.getUint32(40,true),8);
 assert.equal(view.getInt16(44,true),-32768);assert.equal(view.getInt16(48,true),32767);
});
