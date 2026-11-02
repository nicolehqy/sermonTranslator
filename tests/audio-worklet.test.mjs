import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
test('worklet sends pause-detection levels while preserving complete classifier windows',()=>{
 const messages=[];let Processor;
 vm.runInNewContext(readFileSync(new URL('../public/audio/pcm-worklet.js',import.meta.url),'utf8'),{
   AudioWorkletProcessor:class{port={postMessage:value=>messages.push(value)};},sampleRate:16000,Float32Array,Math,
   registerProcessor:(name,ctor)=>Processor=ctor,
 });
 const processor=new Processor();
 for(let i=0;i<125;i++) processor.process([[new Float32Array(128).fill(.25)]]);
 const levels=messages.filter(m=>'level' in m), windows=messages.filter(m=>'samples' in m);
 assert.equal(levels.length,10);assert.equal(windows.length,1);
 assert.equal(levels[0].durationMs,100);assert.equal(levels[0].level,.25);
 assert.equal(windows[0].samples.length,16000);assert.equal(windows[0].samples[15999],.25);
});
