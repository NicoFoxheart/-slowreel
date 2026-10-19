// assets.js - makes the heavy sample buffers ahead of time, never on play: reverb impulse responses, the noise loops
// and the night-rain loops. Jobs run in a module Worker (js/sound/gen-worker.js) when the page allows one; otherwise
// (or if the worker does not answer) they run on the main thread one job per idle slot. Results are cached per sample
// rate by util.js / reverb.js / nightrain.js, which then only copy them into an AudioBuffer (about 1 ms).
import { noiseFloats, hasNoiseFloats, putNoiseFloats } from './util.js?v=7';
import { irPlan, irFloats, hasIR, putIRFloats } from './reverb.js?v=7';
import { nightFloats, hasNightFloats, putNightFloats } from './nightrain.js?v=7';

const NOISE_TYPES = ['white', 'pink', 'brown', 'crackle'];
let worker = null, state = 'none';     // none | starting | ready | broken
const jobs = new Map();                 // key -> {job, resolve, reject, promise}
const waiting = new Map();              // worker message id -> key
let seq = 0;

function startWorker() {
  if (state !== 'none') return;
  if (typeof Worker === 'undefined') { state = 'broken'; return; }
  try {
    worker = new Worker(new URL('./gen-worker.js?v=7', import.meta.url), { type: 'module' });
    state = 'starting';
  } catch (e) { state = 'broken'; return; }
  const fail = () => {
    if (state === 'broken') return;
    state = 'broken';
    try { worker.terminate(); } catch (e) { }
    worker = null;
    waiting.clear();
    for (const key of jobs.keys()) runLocal(key);   // anything queued for the worker: do it here instead
  };
  const timer = setTimeout(() => { if (state === 'starting') fail(); }, 2500);
  worker.onerror = () => { clearTimeout(timer); fail(); };
  worker.onmessage = (e) => {
    const d = e.data || {};
    if (d.ready) { clearTimeout(timer); state = 'ready'; for (const key of jobs.keys()) if (![...waiting.values()].includes(key)) post(key); return; }
    const key = waiting.get(d.id); if (key === undefined) return;
    waiting.delete(d.id);
    if (d.error) { runLocal(key); return; }
    finish(key, d.chans);
  };
}
function post(key) {
  const j = jobs.get(key); if (!j || !worker) return;
  const id = ++seq; waiting.set(id, key);
  worker.postMessage({ id, ...j.job });
}
// main-thread fallback: one job per idle slot, so a page that cannot run workers still never computes on play
const localQueue = [];
let localBusy = false;
function runLocal(key) { if (!localQueue.includes(key)) localQueue.push(key); pumpLocal(); }
function pumpLocal() {
  if (localBusy || !localQueue.length) return;
  localBusy = true;
  const go = () => {
    const key = localQueue.shift(), j = jobs.get(key);
    if (j) { try { finish(key, compute(j.job)); } catch (e) { jobs.delete(key); j.reject(e); } }
    localBusy = false; pumpLocal();
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(go, { timeout: 200 }); else setTimeout(go, 0);
}
function compute(job) {
  if (job.kind === 'noise') return noiseFloats(job.type, job.seconds, job.sr);
  if (job.kind === 'night') return nightFloats(job.type, job.sr);
  return irFloats(job.sr, irPlan(job.type, job.opts));
}
function finish(key, chans) {
  const j = jobs.get(key); if (!j) return;
  jobs.delete(key);
  const { job } = j;
  if (job.kind === 'noise') putNoiseFloats(job.type, job.seconds, job.sr, chans);
  else if (job.kind === 'night') putNightFloats(job.type, job.sr, chans);
  else putIRFloats(job.sr, irPlan(job.type, job.opts), chans);
  j.resolve();
}
function request(key, job) {
  const have = jobs.get(key); if (have) return have.promise;
  let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; });
  jobs.set(key, { job, resolve, reject, promise });
  startWorker();
  if (state === 'ready') post(key); else if (state === 'broken') runLocal(key);   // 'starting': posted on ready
  return promise;
}

/** Resolves when the impulse response for these reverb settings is cached for this sample rate. */
export function ensureIR(sr, type, opts = {}) {
  const plan = irPlan(type, opts);
  if (hasIR(sr, plan)) return Promise.resolve();
  return request('ir|' + sr + '|' + plan.key, { kind: 'ir', sr, type: plan.type, opts: { size: plan.size, tone: plan.tone, preDelay: plan.pre, light: plan.light } });
}
export function ensureNoise(sr, type = 'white', seconds = 6) {
  if (hasNoiseFloats(type, seconds, sr)) return Promise.resolve();
  return request('noise|' + sr + '|' + type + '|' + seconds, { kind: 'noise', sr, type, seconds });
}
export function ensureNight(sr, kind = 'glass') {
  if (hasNightFloats(kind, sr)) return Promise.resolve();
  return request('night|' + sr + '|' + kind, { kind: 'night', sr, type: kind });
}
export const nightReady = (sr) => hasNightFloats('glass', sr) && hasNightFloats('city', sr);
/** Every noise loop + the night-rain loops (cheap to ask for; each is made once per sample rate). */
export function ensureBasics(sr, { night = true } = {}) {
  const all = NOISE_TYPES.map(t => ensureNoise(sr, t));
  if (night) all.push(ensureNight(sr, 'glass'), ensureNight(sr, 'city'));
  return Promise.all(all);
}
export function assetMode() { return state === 'ready' ? 'worker' : state === 'broken' ? 'main-thread idle' : state; }
