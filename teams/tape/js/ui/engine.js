// engine.js - picks the sound engine. The real one lives in js/sound/engine.js (the musician's); until it is
// complete the UI runs on js/ui/mock-engine.js, which has the same API. Force one with ?engine=mock or ?engine=real.
// INTEGRATOR: set USE_REAL = true once js/sound/ is complete (or delete the mock path).
const USE_REAL = true;

export async function loadEngine(context) {
  const q = new URLSearchParams(location.search).get('engine');
  const wantReal = q ? q === 'real' : USE_REAL;
  if (wantReal) {
    try {
      const m = await import('../sound/engine.js?v=10a');
      const e = await m.createEngine({ context });
      e.isMock = false;
      return e;
    } catch (err) { console.warn('[slowreel] real engine unavailable, using the mock', err); }
  }
  const m = await import('./mock-engine.js?v=10a');
  return m.createEngine({ context });
}
