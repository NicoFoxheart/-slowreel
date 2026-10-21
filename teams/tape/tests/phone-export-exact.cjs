// Phone render vs PC export render, each in a FRESH page (fresh sound modules), for the demo, Night Garage and a recipe.
//   NODE_PATH=$(npm root -g) node teams/tape/tests/phone-export-exact.cjs
// PC path  : js/ui/engine.js loadEngine(AudioContext) -> engine.load(tape) (the PC opening the tape) -> exporter.js renderProject()
// Phone    : phone-export.js renderForTest(tape) (what "Make the audio file" runs)
// Why fresh pages: the instruments draw their "randomness" from module-level seeded streams (instruments.js rng(4242) etc.),
// so two renders in the SAME page differ slightly (the second continues the stream). From a fresh start both paths must be
// identical: SHA-256 of the float samples, peak / RMS within 0.1 dB, same length.
const { chromium } = require('playwright');
const { serve, route, ARGS } = require('./serve.cjs');

(async () => {
  const srv = await serve(), base = `http://127.0.0.1:${srv.address().port}/teams/tape/`;
  const browser = await chromium.launch({ args: ARGS });
  const blank = '<!doctype html><meta charset="utf-8"><title>t</title><body>';
  const run = async (which, path) => {
    const ctx = await browser.newContext(); await route(ctx);
    await ctx.route(base + '__blank.html', r => r.fulfill({ body: blank, contentType: 'text/html' }));
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.goto(base + '__blank.html');
    const out = await page.evaluate(async ({ which, path }) => {
      const v = (await (await fetch('index.html')).text()).match(/js\/ui\/app\.js(\?v=[\w.-]+)/)?.[1] || '';   // the app's cache stamp
      let p;
      if (which === 'demo') p = JSON.parse(JSON.stringify((await import('./js/sound/demo.js' + v)).DEMO));
      else if (which === 'night') p = await (await fetch('demo-night-garage.json' + v)).json();
      else p = (await import('./js/recipes/recipes.js' + v)).recipeProject('rainy-seoul-night', 1);
      // app.js normalize()
      p.schema = p.schema || 'nfx-studio/1'; p.beatsPerBar = p.beatsPerBar || 4; p.lengthBars = p.lengthBars || 16;
      p.loop = p.loop || { on: false, startBeat: 0, endBeat: 16 }; p.buses = p.buses || {}; p.buses.space = p.buses.space || { fx: [] }; p.buses.echo = p.buses.echo || { fx: [] };
      p.master = p.master || { volumeDb: 0, atmosphere: 0.5, fx: [] }; p.master.fx = p.master.fx || [];
      p.tracks.forEach(t => { t.sends = t.sends || { space: 0.4, echo: 0 }; t.fx = t.fx || []; t.clips = t.clips || []; t.clips.forEach(c => { if (!c.song) c.notes = c.notes || []; }); });
      const t0 = performance.now();
      let buf;
      if (path === 'pc') {
        const { S } = await import('./js/ui/state.js' + v), { loadEngine } = await import('./js/ui/engine.js' + v), ex = await import('./js/ui/exporter.js' + v);
        S.ctx = new AudioContext(); S.engine = await loadEngine(S.ctx); S.project = JSON.parse(JSON.stringify(p));
        await S.engine.load(S.project);
        buf = (await ex.renderProject({})).buf;
      } else {
        const px = await import('./js/ui/phone-export.js' + v);
        buf = (await px.renderForTest(p)).buf;
      }
      const ms = Math.round(performance.now() - t0);
      let pk = 0, ss = 0; const env = [];
      const both = new Float32Array(buf.length * 2);
      for (let c = 0; c < 2; c++) { const x = buf.getChannelData(c); both.set(x, c * buf.length);
        for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > pk) pk = a; ss += x[i] * x[i]; const s = Math.floor(i / 4410); env[s] = (env[s] || 0) + x[i] * x[i]; } }
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', both.buffer))].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
      return { name: p.name, length: buf.length, seconds: +buf.duration.toFixed(3), peakDb: 20 * Math.log10(pk), rmsDb: 10 * Math.log10(ss / (2 * buf.length)), hash, ms,
        env: env.map(e => 10 * Math.log10(e / (2 * 4410) + 1e-20)) };
    }, { which, path });
    await ctx.close(); if (errs.length) out.errors = errs; return out;
  };
  const R = {}; let fail = 0;
  for (const which of ['demo', 'night', 'recipe']) {
    const pc = await run(which, 'pc'), ph = await run(which, 'phone');
    const envMax = Math.max(...pc.env.map((e, i) => (e > -70 ? Math.abs(e - ph.env[i]) : 0)));
    const r = R[which] = { name: pc.name, seconds: pc.seconds, pc: { peakDb: +pc.peakDb.toFixed(3), rmsDb: +pc.rmsDb.toFixed(3), hash: pc.hash, ms: pc.ms },
      phone: { peakDb: +ph.peakDb.toFixed(3), rmsDb: +ph.rmsDb.toFixed(3), hash: ph.hash, ms: ph.ms },
      peakDiffDb: +Math.abs(pc.peakDb - ph.peakDb).toFixed(3), rmsDiffDb: +Math.abs(pc.rmsDb - ph.rmsDb).toFixed(3), envMaxDiffDb: +envMax.toFixed(3),
      sameLength: pc.length === ph.length, identical: pc.hash === ph.hash, errors: [...(pc.errors || []), ...(ph.errors || [])] };
    const ok = r.sameLength && r.peakDiffDb <= 0.1 && r.rmsDiffDb <= 0.1 && !r.errors.length;
    if (!ok) fail++;
    console.log(ok ? 'ok  ' : 'FAIL', which, JSON.stringify(r));
  }
  await browser.close(); srv.close();
  require('fs').writeFileSync(require('path').resolve(__dirname, '../qa/phone-export-exact.json'), JSON.stringify(R, null, 1));
  console.log(fail ? `FAIL (${fail})` : 'PASS');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
