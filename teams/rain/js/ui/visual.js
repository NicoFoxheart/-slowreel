// visual.js - "the window": the city at night seen through wet glass. Bokeh lights breathe with the music
// (each light listens to one frequency band), drops slide faster when it gets louder, and the desk lamp's
// reflection warms the glass once the sound is on. When the music stops it settles and the loop sleeps.
const COLORS = [[242, 181, 107], [255, 214, 160], [217, 138, 122], [143, 180, 204], [111, 177, 176], [236, 229, 216], [227, 194, 122]];
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const sprites = new Map();
function sprite([r, g, b]) {
  const k = r + ',' + g + ',' + b; if (sprites.has(k)) return sprites.get(k);
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, `rgba(${r},${g},${b},1)`); gr.addColorStop(0.55, `rgba(${r},${g},${b},.55)`); gr.addColorStop(0.8, `rgba(${r},${g},${b},.18)`); gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
  x.fillStyle = gr; x.fillRect(0, 0, 128, 128); sprites.set(k, c); return c;
}

export class RainWindow {
  constructor(canvas, { getAnalyser, isPlaying, lampOn, seed = 7, lampX = 0.1, density = 1 }) {
    Object.assign(this, { canvas, getAnalyser, isPlaying, lampOn, seed, lampX, density });
    this.ctx = canvas.getContext('2d'); this.level = 0; this.bands = new Float32Array(10); this.lamp = 0; this.running = false; this.quietFor = 0; this.t = 0;
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(canvas);
    document.addEventListener('visibilitychange', () => (document.hidden ? this.sleep() : this.wake()));
    this.resize();
  }
  resize() {
    const r = this.canvas.getBoundingClientRect(); if (!r.width || !r.height) return;
    const dpr = Math.min(1.5, devicePixelRatio || 1); this.w = Math.round(r.width * dpr); this.h = Math.round(r.height * dpr); this.dpr = dpr;
    this.canvas.width = this.w; this.canvas.height = this.h; this.build(); this.draw(0);
  }
  build() {
    const { w, h, dpr } = this, R = rng(this.seed);
    // the city: sky, far towers with a few lit windows, the street glow
    const bg = this.bg = document.createElement('canvas'); bg.width = w; bg.height = h; const g = bg.getContext('2d');
    const sky = g.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, '#16202b'); sky.addColorStop(0.55, '#223041'); sky.addColorStop(1, '#2a3340');
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    const haze = g.createRadialGradient(w * 0.62, h * 1.1, 0, w * 0.62, h * 1.1, Math.max(w * 0.5, h));
    haze.addColorStop(0, 'rgba(217,150,110,.22)'); haze.addColorStop(1, 'rgba(217,150,110,0)'); g.fillStyle = haze; g.fillRect(0, 0, w, h);
    g.filter = `blur(${2.5 * dpr}px)`;
    for (let layer = 0; layer < 2; layer++) {
      let x = -20; const base = h * (layer ? 0.98 : 0.92);
      while (x < w + 20) {
        const bw = (30 + R() * 90) * dpr * (layer ? 1.2 : 0.8), bh = h * (0.25 + R() * (layer ? 0.55 : 0.45));
        g.fillStyle = layer ? 'rgba(14,20,28,.92)' : 'rgba(30,42,56,.85)'; g.fillRect(x, base - bh, bw, bh + 10);
        const cols = Math.max(1, bw / (9 * dpr) | 0), rows = Math.max(1, bh / (11 * dpr) | 0);
        for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) if (R() < (layer ? 0.07 : 0.05)) {
          const c = COLORS[R() < 0.7 ? 0 : (R() * COLORS.length) | 0]; g.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${0.25 + R() * 0.4})`;
          g.fillRect(x + 3 * dpr + i * 9 * dpr, base - bh + 4 * dpr + j * 11 * dpr, 4 * dpr, 5 * dpr);
        }
        x += bw + R() * 14 * dpr;
      }
    }
    g.filter = 'none';
    // bokeh lights: out-of-focus city lights, each tied to a band
    const n = Math.round((w / dpr) / 26 * this.density);
    this.bokeh = Array.from({ length: n }, (_, i) => { const c = COLORS[R() < 0.45 ? 0 : (R() * COLORS.length) | 0]; return { x: R() * w, y: h * (0.25 + R() * 0.8), r: (8 + R() * 26) * dpr * (h / dpr > 200 ? 1.6 : 1), c, img: sprite(c), band: (R() * 10) | 0, a: 0.06 + R() * 0.16, ph: R() * 6.28 }; });
    // glass: static droplets baked once
    const gl = this.glass = document.createElement('canvas'); gl.width = w; gl.height = h; const q = gl.getContext('2d');
    const nd = Math.round(w * h / (dpr * dpr) / 260 * this.density);
    for (let i = 0; i < nd; i++) this.drop(q, R() * w, R() * h, (0.6 + Math.pow(R(), 3) * 3.2) * dpr, R);
    // running drops
    this.runners = Array.from({ length: Math.round(w / dpr / 70 * this.density) }, () => this.newRunner(R, true));
    this.R = R;
  }
  drop(q, x, y, r, R) {
    q.fillStyle = 'rgba(8,12,18,.35)'; q.beginPath(); q.ellipse(x, y + r * 0.25, r, r * 1.1, 0, 0, 7); q.fill();
    q.fillStyle = `rgba(200,220,235,${0.08 + R() * 0.1})`; q.beginPath(); q.ellipse(x, y, r * 0.9, r, 0, 0, 7); q.fill();
    q.fillStyle = 'rgba(255,240,220,.55)'; q.beginPath(); q.arc(x - r * 0.3, y - r * 0.35, Math.max(0.5, r * 0.28), 0, 7); q.fill();
  }
  newRunner(R, anywhere) { const dpr = this.dpr; return { x: R() * this.w, y: anywhere ? R() * this.h : -10 * dpr, v: (6 + R() * 18) * dpr, r: (1.2 + R() * 1.8) * dpr, wob: R() * 6.28, trail: [] }; }
  readAudio() {
    const an = this.getAnalyser?.(); if (!an || !this.isPlaying?.()) { this.level *= 0.94; this.bands.forEach((v, i) => (this.bands[i] = v * 0.94)); return; }
    const d = this.fd && this.fd.length === an.frequencyBinCount ? this.fd : (this.fd = new Uint8Array(an.frequencyBinCount)); an.getByteFrequencyData(d);
    let tot = 0; const N = d.length;
    for (let b = 0; b < 10; b++) { const lo = Math.floor(Math.pow(N, b / 10)), hi = Math.max(lo + 1, Math.floor(Math.pow(N, (b + 1) / 10))); let s = 0; for (let i = lo; i < hi; i++) s += d[i]; const v = s / (hi - lo) / 255; this.bands[b] += (v - this.bands[b]) * 0.12; tot += v; }
    this.level += (tot / 10 - this.level) * 0.08;
  }
  draw(dt) {
    const { ctx: g, w, h } = this; if (!w) return; const still = reduce.matches;
    this.lamp += ((this.lampOn?.() ? 1 : 0.3) - this.lamp) * Math.min(1, dt * 1.2 || 1);
    g.globalCompositeOperation = 'source-over'; g.drawImage(this.bg, 0, 0);
    g.globalCompositeOperation = 'lighter';
    for (const b of this.bokeh) {
      const e = this.bands[b.band], br = 0.5 + 0.5 * Math.sin(this.t * 0.4 + b.ph);
      const a = Math.min(0.85, b.a * (0.7 + br * 0.3) + e * 0.9); const r = b.r * (1 + e * 0.35);
      g.globalAlpha = a; g.drawImage(b.img, b.x - r, b.y - r, r * 2, r * 2);
    }
    // the lamp, reflected in the glass, low-left
    const lx = w * this.lampX, ly = h * 0.78, lr = Math.max(w * 0.22, h * 1.4);
    const lg = g.createRadialGradient(lx, ly, 0, lx, ly, lr); lg.addColorStop(0, `rgba(255,205,140,${0.34 * this.lamp})`); lg.addColorStop(0.35, `rgba(242,170,95,${0.12 * this.lamp})`); lg.addColorStop(1, 'rgba(242,170,95,0)');
    g.globalAlpha = 1; g.fillStyle = lg; g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 0.9; g.drawImage(this.glass, 0, 0); g.globalAlpha = 1;
    // running drops with their wet trails
    const speed = still ? 0 : (0.15 + this.level * 5);
    g.lineCap = 'round';
    for (let i = 0; i < this.runners.length; i++) {
      const d = this.runners[i];
      if (speed > 0) { d.y += d.v * speed * dt * (0.6 + 0.4 * Math.sin(this.t * 3 + d.wob)); d.x += Math.sin(this.t * 1.7 + d.wob) * 0.15 * this.dpr; }
      if (d.y - 40 * this.dpr > h) this.runners[i] = this.newRunner(this.R, false);
      const len = Math.min(d.y, 60 * this.dpr);
      const tg = g.createLinearGradient(d.x, d.y - len, d.x, d.y);
      tg.addColorStop(0, 'rgba(190,215,235,0)'); tg.addColorStop(1, 'rgba(190,215,235,.16)');
      g.strokeStyle = tg; g.lineWidth = d.r * 1.1; g.beginPath(); g.moveTo(d.x, d.y - len); g.lineTo(d.x, d.y); g.stroke();
      this.drop(g, d.x, d.y, d.r * 1.4, this.R);
    }
    // glass sheen + vignette
    const v = g.createLinearGradient(0, 0, w, h); v.addColorStop(0, 'rgba(255,255,255,.03)'); v.addColorStop(0.5, 'rgba(255,255,255,0)'); v.addColorStop(1, 'rgba(0,0,0,.18)');
    g.fillStyle = v; g.fillRect(0, 0, w, h);
  }
  loop = (now) => {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - (this.last || now)) / 1000); this.last = now; this.t += dt;
    this.readAudio(); this.draw(dt);
    const busy = this.isPlaying?.() || this.level > 0.004 || Math.abs((this.lampOn?.() ? 1 : 0.3) - this.lamp) > 0.01;
    this.quietFor = busy ? 0 : this.quietFor + dt;
    if (this.quietFor > 2.5) { this.sleep(); return; }   // calm: the loop stops, the last frame stays
    this.raf = requestAnimationFrame(this.loop);
  };
  wake() { if (this.running || document.hidden || !this.w) return; this.running = true; this.quietFor = 0; this.last = 0; this.raf = requestAnimationFrame(this.loop); }
  sleep() { this.running = false; cancelAnimationFrame(this.raf); }
}
