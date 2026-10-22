// deck.js - the audio-reactive visual: a reel-to-reel transport behind dark glass and a dual-needle meter.
// Reels turn at constant tape speed (the fuller reel turns slower), the tape pack moves from left to right over the
// song, the tape between the heads trembles with the waveform. Everything rests when the music stops.

// Canvas sizes come from a ResizeObserver, not getBoundingClientRect() per frame (that forced a layout every frame).
const sizes = new WeakMap();
const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(es => { for (const e of es) { const bb = e.borderBoxSize?.[0]; sizes.set(e.target, bb ? { width: bb.inlineSize, height: bb.blockSize } : { width: e.contentRect.width, height: e.contentRect.height }); } }) : null;
export function canvasSize(canvas) {
  let r = sizes.get(canvas);
  if (!r) { const b = canvas.getBoundingClientRect(); r = { width: b.width, height: b.height }; sizes.set(canvas, r); ro?.observe(canvas); }
  return r;
}
function fit(canvas) {
  const dpr = Math.min(2, window.devicePixelRatio || 1), r = canvasSize(canvas);
  const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  return { g: canvas.getContext('2d'), w, h, dpr };
}

export function createDeck(canvas) {
  let angL = 0, angR = 0, last = performance.now();
  const wave = new Float32Array(256);
  function reel(g, x, y, R, pack, ang, dpr) {
    // flange (aluminium, three windows)
    g.save(); g.translate(x, y);
    g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.fillStyle = 'rgba(184,190,196,.22)'; g.fill();
    g.lineWidth = 1 * dpr; g.strokeStyle = 'rgba(238,240,234,.28)'; g.stroke();
    // tape pack
    g.beginPath(); g.arc(0, 0, pack, 0, Math.PI * 2);
    const gr = g.createRadialGradient(0, 0, R * 0.2, 0, 0, pack); gr.addColorStop(0, '#2A221E'); gr.addColorStop(1, '#4A3B32');
    g.fillStyle = gr; g.fill();
    g.strokeStyle = 'rgba(255,255,255,.08)'; g.lineWidth = 0.6 * dpr;
    for (let r = R * 0.3; r < pack; r += 3 * dpr) { g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke(); }
    // flange windows (rotate)
    g.rotate(ang);
    g.fillStyle = 'rgba(20,24,26,.0)'; g.strokeStyle = 'rgba(238,240,234,.22)'; g.lineWidth = 1.2 * dpr;
    for (let i = 0; i < 3; i++) {
      g.save(); g.rotate(i * Math.PI * 2 / 3);
      g.beginPath(); g.arc(0, 0, R * 0.86, -0.42, 0.42); g.arc(0, 0, R * 0.42, 0.62, -0.62, true); g.closePath();
      g.fillStyle = 'rgba(5,7,10,.6)'; g.fill(); g.stroke(); g.restore();
    }
    // hub
    g.beginPath(); g.arc(0, 0, R * 0.26, 0, Math.PI * 2); g.fillStyle = '#D9DEDB'; g.fill();
    g.fillStyle = '#1B2023';
    for (let i = 0; i < 3; i++) { g.save(); g.rotate(i * Math.PI * 2 / 3); g.fillRect(-1.6 * dpr, -R * 0.24, 3.2 * dpr, R * 0.1); g.restore(); }
    g.beginPath(); g.arc(0, 0, R * 0.08, 0, Math.PI * 2); g.fillStyle = '#F0622A'; g.fill();
    g.restore();
  }
  return {
    draw({ playing, frac = 0, level = 0, analyser, dt, still = false }) {   // still: prefers-reduced-motion (no spinning, no tremble)
      const { g, w, h, dpr } = fit(canvas);
      const now = performance.now(); dt = dt ?? Math.min(0.05, (now - last) / 1000); last = now;
      g.clearRect(0, 0, w, h);
      const R = Math.min(h * 0.36, w * 0.2), y = h * 0.44, xL = w * 0.5 - R * 1.25, xR = w * 0.5 + R * 1.25;
      const hub = R * 0.3, full = R * 0.9;
      const pL = Math.sqrt(hub * hub + (1 - frac) * (full * full - hub * hub)), pR = Math.sqrt(hub * hub + frac * (full * full - hub * hub));
      if (playing && !still) { const v = 26 * dpr; angL += dt * v / pL; angR += dt * v / pR; }
      // tape path: left pack -> guide -> head -> guide -> right pack
      const gy = h * 0.88, gL = xL + R * 0.55, gR = xR - R * 0.55;
      if (analyser && playing && !still) analyser.getFloatTimeDomainData(wave); else wave.fill(0);
      g.strokeStyle = '#6E5A4E'; g.lineWidth = 1.6 * dpr; g.lineCap = 'round';
      g.beginPath(); g.moveTo(xL - pL, y); g.lineTo(gL - 4 * dpr, gy); g.stroke();
      g.beginPath(); g.moveTo(xR + pR, y); g.lineTo(gR + 4 * dpr, gy); g.stroke();
      g.beginPath();
      for (let i = 0; i <= 64; i++) { const t = i / 64, x = gL + (gR - gL) * t, env = Math.sin(Math.PI * t); const yy = gy + wave[i * 4] * env * 7 * dpr; i ? g.lineTo(x, yy) : g.moveTo(x, yy); }
      g.strokeStyle = '#8A7262'; g.stroke();
      // guides + head
      g.fillStyle = '#C9CED0';
      [gL, gR].forEach(x => { g.beginPath(); g.arc(x, gy, 3.2 * dpr, 0, Math.PI * 2); g.fill(); });
      const hw = 16 * dpr, glow = Math.min(1, level * 1.4);
      if (glow > 0.01) { const rg = g.createRadialGradient(w / 2, gy, 0, w / 2, gy, 34 * dpr); rg.addColorStop(0, `rgba(255,150,60,${0.45 * glow})`); rg.addColorStop(1, 'rgba(255,150,60,0)'); g.fillStyle = rg; g.fillRect(w / 2 - 40 * dpr, gy - 40 * dpr, 80 * dpr, 80 * dpr); }
      g.fillStyle = '#D9DEDB'; g.fillRect(w / 2 - hw / 2, gy - 1 * dpr, hw, 8 * dpr);
      g.fillStyle = '#1B2023'; g.fillRect(w / 2 - 1, gy - 1 * dpr, 2, 8 * dpr);
      reel(g, xL, y, R, pL, angL, dpr); reel(g, xR, y, R, pR, angR, dpr);
    },
  };
}

/** Dual-needle meter: VU (ink, RMS ballistics, 0 VU = -18 dBFS) and peak (vermilion, 0 = -1 dBFS). */
export function createVU(canvas) {
  let vu = -40, pk = -40;
  const buf = new Float32Array(1024);
  return {
    draw({ analyser, playing, dt = 1 / 60 }) {
      const { g, w, h, dpr } = fit(canvas);
      if (w < 24 * dpr || h < 24 * dpr) return false;   // hidden (narrow windows hide the VU): nothing to draw
      let rms = -60, peak = -60;
      if (analyser && playing) { analyser.getFloatTimeDomainData(buf); let s = 0, p = 0; for (let i = 0; i < buf.length; i++) { const x = buf[i]; s += x * x; if (Math.abs(x) > p) p = Math.abs(x); } rms = 10 * Math.log10(s / buf.length || 1e-12); peak = 20 * Math.log10(p || 1e-6); }
      const tv = rms + 18, tp = peak + 1;
      vu += (tv - vu) * Math.min(1, dt / 0.3);
      pk = tp > pk ? pk + (tp - pk) * Math.min(1, dt / 0.01) : pk + (tp - pk) * Math.min(1, dt / 1.2);
      g.clearRect(0, 0, w, h);
      const pad = 8 * dpr, fx = pad, fy = pad, fw = w - pad * 2, fh = h - pad * 2;
      { const fg = g.createRadialGradient(fx + fw / 2, fy + fh * 0.75, 0, fx + fw / 2, fy + fh * 0.6, fw * 0.75); fg.addColorStop(0, '#FFD592'); fg.addColorStop(0.6, '#F0B061'); fg.addColorStop(1, '#C47E34');
        g.fillStyle = fg; roundRect(g, fx, fy, fw, fh, 5 * dpr); g.fill(); }
      const cx = fx + fw / 2, cy = fy + fh * 1.25, r = fh * 1.02;
      const ang = db => { const x = Math.max(-20, Math.min(3, db)); const n = Math.pow((x + 20) / 23, 1.3); return -0.78 + n * 1.56; };
      g.lineWidth = 1 * dpr; g.strokeStyle = '#2A1A0C';
      g.beginPath(); g.arc(cx, cy, r * 0.82, -Math.PI / 2 + ang(-20), -Math.PI / 2 + ang(0)); g.stroke();
      g.strokeStyle = '#B8320A'; g.lineWidth = 2.2 * dpr; g.beginPath(); g.arc(cx, cy, r * 0.82, -Math.PI / 2 + ang(0), -Math.PI / 2 + ang(3)); g.stroke();
      g.font = `600 ${7.5 * dpr}px "IBM Plex Mono", ui-monospace, monospace`; g.textAlign = 'center'; g.fillStyle = '#3A2614';
      [-20, -10, -5, 0, 3].forEach(d => { const a = -Math.PI / 2 + ang(d); const x0 = cx + Math.cos(a) * r * 0.82, y0 = cy + Math.sin(a) * r * 0.82; const x1 = cx + Math.cos(a) * r * 0.9, y1 = cy + Math.sin(a) * r * 0.9;
        g.strokeStyle = d > 0 ? '#B8320A' : '#2A1A0C'; g.lineWidth = 1 * dpr; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
        g.fillStyle = d > 0 ? '#B8320A' : '#3A2614'; g.fillText(d > 0 ? '+' + d : String(d), cx + Math.cos(a) * r * 1.0, cy + Math.sin(a) * r * 1.0 + 3 * dpr); });
      g.font = `700 ${7 * dpr}px "Archivo", system-ui, sans-serif`; g.fillStyle = '#4A3018'; g.textAlign = 'left'; g.fillText('VU', fx + 6 * dpr, fy + fh - 6 * dpr);
      g.fillStyle = '#B8320A'; g.textAlign = 'right'; g.fillText('PEAK', fx + fw - 6 * dpr, fy + fh - 6 * dpr);
      g.save(); g.beginPath(); roundRect(g, fx, fy, fw, fh, 5 * dpr); g.clip();
      const needle = (db, col, lw) => { const a = -Math.PI / 2 + ang(db); g.strokeStyle = col; g.lineWidth = lw * dpr; g.beginPath(); g.moveTo(cx + Math.cos(a) * r * 0.25, cy + Math.sin(a) * r * 0.25); g.lineTo(cx + Math.cos(a) * r * 0.93, cy + Math.sin(a) * r * 0.93); g.stroke(); };
      needle(pk, '#C23A0E', 1); needle(vu, '#1A1008', 1.4);
      g.restore();
      return Math.abs(vu - tv) > 0.3 || Math.abs(pk - tp) > 0.3; // still moving
    },
  };
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
