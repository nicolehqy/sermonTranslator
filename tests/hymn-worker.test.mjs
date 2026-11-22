import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync, readdirSync} from 'node:fs';
const source=readFileSync(new URL('../public/audio/hymn-worker.js',import.meta.url),'utf8');
test('packaged music runtime resolves its audio files without WebAssembly JSPI',async()=>{
 const vendor=new URL('../public/audio/vendor/',import.meta.url);
 const context={WebAssembly,TextDecoder,TextEncoder};context.self=context;
 vm.runInNewContext(readFileSync(new URL('audio_bundle.js',vendor),'utf8'),context);
 assert.equal(typeof context.Audio.AudioClassifier.createFromOptions,'function');
 const files=await context.Audio.FilesetResolver.forAudioTasks('/audio/vendor/wasm');
 assert.match(files.wasmLoaderPath,/audio_wasm_(nosimd_)?internal\.js$/);
 for(const filename of readdirSync(new URL('wasm/',vendor)).filter(name=>name.endsWith('.js'))){
  const glue=readFileSync(new URL(`wasm/${filename}`,vendor),'utf8');
  assert.doesNotMatch(glue,/WebAssembly\.(Suspending|promising)/,filename);
 }
});
async function classify(categories){
 const messages=[];const self={postMessage:m=>messages.push(m)};
 vm.runInNewContext(source,{self,fetch:async()=>({ok:true,status:200,headers:{get:()=>"application/octet-stream"},arrayBuffer:async()=>new ArrayBuffer(8)}),importScripts:()=>{},Audio:{FilesetResolver:{forAudioTasks:async()=>({})},AudioClassifier:{createFromOptions:async()=>({classify:()=>[{classifications:[{categories}]}]})}}});
 await self.onmessage({data:{init:true}});
 await self.onmessage({data:{samples:new Float32Array(1),sampleRate:16000,at:123}});
 return messages.at(-1);
}
test('worker returns music evidence independently of speech and singing',async()=>{
 const r=await classify([{categoryName:'Music',score:.9},{categoryName:'Vocal music',score:.7},{categoryName:'Singing',score:.1},{categoryName:'Speech',score:.8}]);
 assert.equal(r.music,.9);assert.equal(r.singing,.1);assert.equal(r.speech,.8);assert.equal(r.at,123);
});
test('worker recognizes chant and humming without treating unrelated sounds as music',async()=>{
 const r=await classify([{categoryName:'Chant',score:.7},{categoryName:'Humming',score:.8},{categoryName:'Noise',score:.99}]);
 assert.equal(r.singing,.8);assert.equal(r.music,0);assert.equal(r.speech,0);
});


test('worker reports runtime import failures with the stage and original message', async()=>{
 const messages=[];const self={postMessage:m=>messages.push(m)};
 vm.runInNewContext(source,{self,importScripts:()=>{throw new Error('Runtime unavailable');}});
 await self.onmessage({data:{init:true}});
 assert.equal(messages.at(-1).error,true);assert.equal(messages.at(-1).stage,'loading runtime');
 assert.equal(messages.at(-1).message,'Runtime unavailable');
});
test('worker detects expired access instead of passing HTML to the model runtime', async()=>{
 const messages=[];const self={postMessage:m=>messages.push(m)};let created=false;
 vm.runInNewContext(source,{self,importScripts:()=>{},fetch:async()=>({redirected:true,status:200}),Audio:{FilesetResolver:{forAudioTasks:async()=>({})},AudioClassifier:{createFromOptions:()=>{created=true;}}}});
 await self.onmessage({data:{init:true}});
 assert.equal(created,false);assert.equal(messages.at(-1).stage,'downloading music model');
 assert.match(messages.at(-1).message,/Access expired/);
});
