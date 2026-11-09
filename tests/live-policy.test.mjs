import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HymnGate, LatestQueue, recentReloads } from '../src/lib/live-policy.ts';
const wait = ms => new Promise(r => setTimeout(r, ms));
test('singing needs five seconds; speech resumes after two seconds', () => {
  const gate = new HymnGate();
  for (let i = 0; i < 20; i++) assert.equal(gate.update(.1, .1, 1000), 'speech');
  for (let i = 0; i < 4; i++) assert.equal(gate.update(.8, .1, 1000), 'candidate');
  assert.equal(gate.update(.8, .1, 1000), 'hymn');
  assert.equal(gate.update(.1, .9, 1000), 'hymn');
  assert.equal(gate.update(.1, .9, 1000), 'speech');
});
test('clear speech interrupts singing confirmation and wins over music', () => {
  const gate = new HymnGate();
  gate.update(.8, .1, 4000);
  assert.equal(gate.update(.5, .8, 1000), 'speech');
  assert.equal(gate.update(.8, .1, 1000), 'candidate');
});
test('newest segment replaces waiting backlog', async () => {
  const calls = [], results = []; let resolve; let skips = 0;
  const queue = new LatestQueue({ run: value => { calls.push(value); return value === 1 ? new Promise(r => resolve = r) : Promise.resolve(value); }, result: x => results.push(x), skip: () => skips++, error: assert.fail, busy: () => {} });
  queue.push(1, Date.now()); queue.push(2, Date.now()); queue.push(3, Date.now());
  resolve(1); await wait(10);
  assert.deepEqual(calls, [1, 3]); assert.deepEqual(results, [1, 3]); assert.equal(skips, 1); queue.cancel();
});
test('deadline advances queue even if provider ignores abort; late output is ignored', async () => {
  const results = []; let late; let errors = 0;
  const queue = new LatestQueue({ requestMs: 15, run: value => value === 1 ? new Promise(r => late = r) : Promise.resolve(value), result: x => results.push(x), skip: () => {}, error: () => errors++, busy: () => {} });
  queue.push(1, Date.now()); queue.push(2, Date.now()); await wait(40); late(1); await wait(5);
  assert.deepEqual(results, [2]); assert.equal(errors, 1); queue.cancel();
});
test('held hymn candidate releases only latest; cancellation prevents stale transcript writes', async () => {
  const results = []; let resolve;
  const queue = new LatestQueue({ run: value => new Promise(r => resolve = () => r(value)), result: x => results.push(x), skip: () => {}, error: assert.fail, busy: () => {} });
  queue.hold(true); queue.push(1, Date.now()); queue.push(2, Date.now()); assert.equal(resolve, undefined);
  queue.hold(false); queue.cancel(); resolve(); await wait(5); assert.deepEqual(results, []);
});
test('audio that has already aged out is never uploaded', () => {
  let skips = 0;
  const queue = new LatestQueue({ run: assert.fail, result: assert.fail, skip: () => skips++, error: assert.fail, busy: () => {} });
  queue.push(1, Date.now() - 16001); assert.equal(skips, 1);
});
test('reload window rejects malformed and old timestamps', () => {
  assert.deepEqual(recentReloads([0, 300001, 'bad', 900000], 400000), [300001]);
  assert.deepEqual(recentReloads({}, 400000), []);
});

test('missing classifier windows do not count as continuous singing', () => {
  const gate = new HymnGate(); gate.update(.9, .1, 4000); gate.discontinuity();
  assert.equal(gate.update(.9, .1, 1000), 'candidate');
});

test('recording boundaries wait for a sustained pause, not a brief breath or a fixed three seconds', async () => {
  const { PhraseBoundary } = await import('../src/lib/live-policy.ts');
  const phrase = new PhraseBoundary();
  for (let elapsed = 100; elapsed <= 4000; elapsed += 100) assert.equal(phrase.observe(.15, 100, elapsed), false);
  for (let elapsed = 4100; elapsed <= 4400; elapsed += 100) assert.equal(phrase.observe(.001, 100, elapsed), false);
  assert.equal(phrase.observe(.15, 100, 4500), false); // speaker continues the same thought
  for (let elapsed = 4600; elapsed <= 5000; elapsed += 100) assert.equal(phrase.observe(.001, 100, elapsed), false);
  assert.equal(phrase.observe(.001, 100, 5100), true);
});
test('silence without preceding speech does not create short phrase uploads', async () => {
  const { PhraseBoundary } = await import('../src/lib/live-policy.ts');
  const phrase = new PhraseBoundary();
  for (let elapsed = 100; elapsed <= 7000; elapsed += 100) assert.equal(phrase.observe(.001, 100, elapsed), false);
});


test('strong music with weak singing pauses, but speech over music continues', () => {
  const g = new HymnGate();
  for (let i=0;i<4;i++) assert.equal(g.update(.04,.02,1000,.85),'candidate');
  assert.equal(g.update(.04,.02,1000,.85),'hymn');
  for(let i=0;i<10;i++) assert.equal(g.update(.01,.02,1000,.05),'hymn');
  assert.equal(g.update(.1,.8,1000,.95),'hymn');
  assert.equal(g.update(.1,.8,1000,.95),'speech');
  for(let i=0;i<10;i++) assert.equal(g.update(.1,.8,1000,.95),'speech');
});
test('short uncertainty does not erase music evidence, sustained uncertainty releases candidate', () => {
  const g = new HymnGate();
  g.update(.1,.02,4000,.8);
  assert.equal(g.update(.1,.1,1000,.2),'candidate');
  assert.equal(g.update(.1,.02,1000,.8),'hymn');
  const h=new HymnGate();h.update(.1,.02,1000,.8);
  h.update(.1,.1,2000,.2);
  assert.equal(h.update(.1,.1,1000,.2),'speech');
});
test('missing windows do not add singing time and long gaps reset confirmation', () => {
  const g=new HymnGate();g.update(.1,.02,4000,.8);g.discontinuity(1000);
  assert.equal(g.mode,'candidate');assert.equal(g.update(.1,.02,1000,.8),'hymn');
  const h=new HymnGate();h.update(.1,.02,4000,.8);h.discontinuity(3000);
  assert.equal(h.update(.1,.02,1000,.8),'candidate');
});

// Captured YAMNet scores from the user-provided Nov 8 service; no audio or text.
const fixtures=JSON.parse(readFileSync(new URL('./fixtures/hymn-scores.json',import.meta.url),'utf8'));
test('recorded hymn stays paused after five seconds despite weak Singing category',()=>{
 const g=new HymnGate();const modes=fixtures[0].rows.map(r=>g.update(r.singing,r.speech,1000,r.music));
 assert.deepEqual(modes.slice(0,4),Array(4).fill('candidate'));
 assert.ok(modes.slice(4).every(m=>'hymn'));
});
test('recorded hymn-to-preaching transition resumes and stays in speech',()=>{
 const g=new HymnGate();const rows=fixtures[1].rows.map(r=>({...r,mode:g.update(r.singing,r.speech,1000,r.music)}));
 assert.ok(rows.filter(r=>r.second>=1746&&r.second<1805).every(r=>r.mode==='hymn'));
 assert.ok(rows.filter(r=>r.second>=1805).every(r=>r.mode==='speech'));
});
