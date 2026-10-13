// engine-host.js - picks the sound engine. The real one lives in js/sound/ (the musician's); until it exists, or with
// ?engine=mock in the URL, the UI runs on js/ui/mock-engine.js (same API, simple tones).
// INTEGRATOR: set REAL_ENGINE to the musician's entry module (it must export createEngine({context})).
export const REAL_ENGINE = './sound/engine.js';

export async function loadEngineFactory() {
  const wantMock = /[?&]engine=mock\b/.test(location.search);
  if (!wantMock && REAL_ENGINE) {
    try { const m = await import(REAL_ENGINE); if (typeof m.createEngine === 'function') return { createEngine: m.createEngine, kind: 'real' }; }
    catch (e) { console.warn('[daylong] real engine not available, using the mock:', e?.message || e); }
  }
  const m = await import('./ui/mock-engine.js');
  return { createEngine: m.createEngine, kind: 'mock' };
}
