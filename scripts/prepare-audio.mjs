import { mkdir, copyFile, cp } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const source = new URL('node_modules/@mediapipe/tasks-audio/', root);
const target = new URL('public/audio/vendor/', root);
await mkdir(target, { recursive: true });
await copyFile(new URL('audio_bundle.js', source), new URL('audio_bundle.js', target));
await cp(new URL('wasm/', source), new URL('wasm/', target), { recursive: true });
