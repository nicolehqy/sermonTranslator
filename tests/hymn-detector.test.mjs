import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const code=stripTypeScriptTypes(readFileSync(new URL('../src/lib/hymn-detector.ts',import.meta.url),'utf8'),{mode:'transform'})
 .replace(/^import .*;$/gm,'').replace('export class HymnDetector','class HymnDetector')+'\nglobalThis.Detector=HymnDetector;';
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function harness({workletPending=false}={}){
 let now=0,id=0,worker,node,resolveWorklet;const timers=new Map(),errors=[];
 const scope={Float32Array,Date:{now:()=>now},HymnGate:class{mode='speech';update(){return 'speech'}},clearSpeech:()=>false,pcmWav:()=>{},
 setTimeout(fn,ms){timers.set(++id,{fn,ms,at:now,repeat:false});return id},clearTimeout:i=>timers.delete(i),
 setInterval(fn,ms){timers.set(++id,{fn,ms,at:now,repeat:true});return id},clearInterval:i=>timers.delete(i),
 AudioContext:class{sampleRate=48000;destination={};resume(){return Promise.resolve()}close(){return Promise.resolve()}
 audioWorklet={addModule:()=>workletPending?new Promise(r=>resolveWorklet=r):Promise.resolve()};
 createMediaStreamSource(){return {connect(){},disconnect(){}}}createGain(){return {gain:{value:1},connect(){},disconnect(){}}}},
 AudioWorkletNode:class{constructor(){node=this}port={};connect(){}disconnect(){}},
 Worker:class{constructor(){worker=this}postMessage(){}terminate(){this.terminated=true}}};
 vm.runInNewContext(code,scope);const detector=new scope.Detector(()=>{},e=>errors.push(e));
 return {detector,errors,get worker(){return worker},get node(){return node},
 async advance(ms){now+=ms;for(const [i,t] of [...timers])if(now-t.at>=t.ms){if(t.repeat)t.at=now;else timers.delete(i);t.fn()}await flush()},
 ready(){worker.onmessage({data:{ready:true}})},resolveWorklet:()=>resolveWorklet(),get timerCount(){return timers.size}};
}
test('permission delay and 30-second cold load do not consume the runtime deadline',async()=>{
 const h=harness();await h.advance(60000);const started=h.detector.start({});
 await h.advance(30000);assert.deepEqual(h.errors,[]);assert.equal(h.worker.terminated,undefined);
 h.ready();assert.equal(await started,true);h.detector.stop();assert.equal(h.timerCount,0);
});
test('startup times out with the last worker stage and cancels the worker',async()=>{
 const h=harness();const started=h.detector.start({});
 h.worker.onmessage({data:{stage:'downloading music model'}});await h.advance(90000);
 assert.equal(await started,false);assert.match(h.errors[0],/90 seconds.*downloading music model/);
 assert.equal(h.worker.terminated,true);h.detector.stop();assert.equal(h.timerCount,0);
});
test('Stop during initialization resolves startup false and ignores a late ready message',async()=>{
 const h=harness();const started=h.detector.start({});const old=h.worker;h.detector.stop();
 old.onmessage({data:{ready:true}});assert.equal(await started,false);assert.equal(h.node,undefined);assert.equal(h.timerCount,0);
});
test('a ready worker cannot hide a stalled worklet download',async()=>{
 const h=harness({workletPending:true});const started=h.detector.start({});h.ready();await flush();
 await h.advance(90000);assert.equal(await started,false);assert.match(h.errors[0],/connecting audio processing/);
 h.resolveWorklet();await flush();assert.equal(h.node,undefined);h.detector.stop();
});
test('runtime watchdog starts only after readiness and reports stalled inference',async()=>{
 const h=harness();const started=h.detector.start({});h.ready();assert.equal(await started,true);
 await h.advance(21000);assert.match(h.errors[0],/stopped responding/);h.detector.stop();
});
test('worker error details survive to the session callback',async()=>{
 const h=harness();const started=h.detector.start({});
 h.worker.onmessage({data:{error:true,stage:'initializing WebAssembly',message:'CompileError: unsupported instruction'}});
 assert.equal(await started,false);assert.match(h.errors[0],/initializing WebAssembly: CompileError/);h.detector.stop();
});
