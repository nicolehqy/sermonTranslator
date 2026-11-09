import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/audio/hymn-worker.js',import.meta.url),'utf8');
async function classify(categories){
 const messages=[];const self={postMessage:m=>messages.push(m)};
 vm.runInNewContext(source,{self,importScripts:()=>{},Audio:{FilesetResolver:{forAudioTasks:async()=>({})},AudioClassifier:{createFromOptions:async()=>({classify:()=>[{classifications:[{categories}]}]})}}});
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
