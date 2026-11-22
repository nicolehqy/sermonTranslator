import { mkdir, cp, readFile, rm, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const source = new URL('node_modules/@mediapipe/tasks-audio/', root);
const target = new URL('public/audio/vendor/', root);
await mkdir(target, { recursive: true });
// The 0.10.x build supports Safari without WebAssembly JSPI. Its browser bundle
// is an ES module, while the existing classic worker uses importScripts. Wrap
// the CommonJS bundle so the worker can keep its existing Audio API.
const bundle = await readFile(new URL('audio_bundle.cjs', source), 'utf8');
await writeFile(new URL('audio_bundle.js', target),
  `var exports = {};\n${bundle}\nvar Audio = { ...exports, FilesetResolver: self.FilesetResolver };\n`);
await rm(new URL('wasm/', target), { recursive: true, force: true });
await cp(new URL('wasm/', source), new URL('wasm/', target), { recursive: true });
