// gen-worker.js - module Worker that makes the heavy, pure-maths sample buffers off the main thread (see assets.js):
// reverb impulse responses, the noise loops and the night-rain loops. Same code as the main-thread fallback, so the
// samples are identical either way.
import { noiseFloats } from './util.js?v=7';
import { irFloats, irPlan } from './reverb.js?v=7';
import { nightFloats } from './nightrain.js?v=7';

self.onmessage = (e) => {
  const { id, kind, sr } = e.data || {};
  try {
    let chans;
    if (kind === 'noise') chans = noiseFloats(e.data.type, e.data.seconds, sr);
    else if (kind === 'night') chans = nightFloats(e.data.type, sr);
    else if (kind === 'ir') chans = irFloats(sr, irPlan(e.data.type, e.data.opts));
    else throw new Error('unknown job ' + kind);
    self.postMessage({ id, chans }, chans.map(c => c.buffer));
  } catch (err) { self.postMessage({ id, error: String(err && err.message || err) }); }
};
self.postMessage({ ready: true });
