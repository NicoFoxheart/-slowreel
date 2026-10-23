// neon-night-glyphs.js - procedural sign glyph atlases for the neon-night scene (no fonts: every stroke is drawn here).
// 'hangul': real jamo shapes (initial consonant + vowel + optional final) composed into syllable blocks at random, so the
// signs read as Korean shop signs without spelling any real name. 'kanji': CJK-like blocks built from radicals
// (box, sun, tree, person, water, cross, roof...) composed left/right or top/bottom, plus a few kana-like cells.
// Atlas: 8 x 8 cells. R = tube profile (1 at the stroke centre falling to 0 at its edge: threshold it for thin neon or
// bold lightbox lettering), G = wide soft glow, B = 1 inside the glyph's bounding block (for panel cut-outs).
import * as kit from './kit.js?v=10a';

const L = (...p) => ({ k: 'l', p });         // polyline in the unit box (y down)
const O = (cx, cy, rx, ry) => ({ k: 'o', c: [cx, cy, rx, ry ?? rx] });

// ---------------------------------------------------------------------------------------------- hangul jamo
const CONS = {
  g: [L(0, 0, 1, 0, 1, 1)], n: [L(0, 0, 0, 1, 1, 1)], d: [L(1, 0, 0, 0, 0, 1, 1, 1)],
  r: [L(0, 0, 1, 0, 1, 0.5, 0, 0.5, 0, 1, 1, 1)], m: [L(0, 0, 1, 0, 1, 1, 0, 1, 0, 0)],
  b: [L(0, 0, 0, 1, 1, 1, 1, 0), L(0, 0.5, 1, 0.5)], s: [L(0.5, 0, 0, 1), L(0.5, 0.15, 1, 1)],
  ng: [O(0.5, 0.5, 0.5, 0.5)], j: [L(0, 0, 1, 0), L(0.5, 0, 0.05, 1), L(0.5, 0.25, 0.95, 1)],
  h: [L(0.35, 0, 0.65, 0), L(0, 0.22, 1, 0.22), O(0.5, 0.66, 0.36, 0.34)], k: [L(0, 0, 1, 0, 1, 1), L(0, 0.5, 1, 0.5)],
  t: [L(1, 0, 0, 0, 0, 1, 1, 1), L(0, 0.5, 1, 0.5)], p: [L(0, 0, 1, 0), L(0, 1, 1, 1), L(0.3, 0, 0.3, 1), L(0.7, 0, 0.7, 1)],
  ch: [L(0.35, 0, 0.65, 0), L(0, 0.25, 1, 0.25), L(0.5, 0.25, 0.05, 1), L(0.5, 0.45, 0.95, 1)],
};
const CONS_IDS = Object.keys(CONS), FINAL_IDS = ['n', 'ng', 'r', 'm', 'g', 'b', 'n', 'ng'];
// vertical vowels: drawn in the right column; horizontal vowels: below
const VV = {
  a: [L(0.5, 0, 0.5, 1), L(0.5, 0.45, 0.95, 0.45)], eo: [L(0.6, 0, 0.6, 1), L(0.6, 0.45, 0.1, 0.45)], i: [L(0.5, 0, 0.5, 1)],
  ae: [L(0.3, 0, 0.3, 1), L(0.85, 0, 0.85, 1), L(0.3, 0.45, 0.85, 0.45)], ya: [L(0.45, 0, 0.45, 1), L(0.45, 0.32, 0.95, 0.32), L(0.45, 0.6, 0.95, 0.6)],
  yeo: [L(0.6, 0, 0.6, 1), L(0.6, 0.32, 0.1, 0.32), L(0.6, 0.6, 0.1, 0.6)],
};
const HV = {
  o: [L(0, 0.8, 1, 0.8), L(0.5, 0.8, 0.5, 0.2)], u: [L(0, 0.2, 1, 0.2), L(0.5, 0.2, 0.5, 0.85)], eu: [L(0, 0.5, 1, 0.5)],
  yo: [L(0, 0.8, 1, 0.8), L(0.33, 0.8, 0.33, 0.25), L(0.67, 0.8, 0.67, 0.25)],
};
const VV_IDS = Object.keys(VV), HV_IDS = Object.keys(HV);

function place(shapes, x, y, w, h, out) {
  for (const s of shapes) {
    if (s.k === 'l') { const p = []; for (let i = 0; i < s.p.length; i += 2) p.push(x + s.p[i] * w, y + s.p[i + 1] * h); out.push({ k: 'l', p }); }
    else out.push({ k: 'o', c: [x + s.c[0] * w, y + s.c[1] * h, s.c[2] * w, s.c[3] * h] });
  }
}
function hangulBlock(r) {
  const out = [], C = CONS[r.pick(CONS_IDS)], fin = r.chance(0.45) ? CONS[r.pick(FINAL_IDS)] : null;
  if (r.chance(0.6)) {                       // C | V (+ F below)
    const V = VV[r.pick(VV_IDS)], top = fin ? 0.58 : 1;
    place(C, 0.04, 0.06, 0.46, top * 0.86, out); place(V, 0.5, 0.0, 0.48, fin ? 0.62 : 1, out);
    if (fin) place(fin, 0.14, 0.7, 0.72, 0.28, out);
  } else {                                   // C over V (+ F)
    const V = HV[r.pick(HV_IDS)];
    if (fin) { place(C, 0.18, 0.0, 0.64, 0.3, out); place(V, 0.02, 0.3, 0.96, 0.3, out); place(fin, 0.18, 0.66, 0.64, 0.32, out); }
    else { place(C, 0.16, 0.02, 0.68, 0.45, out); place(V, 0.02, 0.42, 0.96, 0.58, out); }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- CJK-like radicals
const RAD = {
  kou: [L(0.1, 0.15, 0.1, 0.9), L(0.1, 0.15, 0.9, 0.15, 0.9, 0.9), L(0.1, 0.9, 0.9, 0.9)],
  ri: [L(0.12, 0.05, 0.12, 0.95), L(0.12, 0.05, 0.88, 0.05, 0.88, 0.95), L(0.12, 0.5, 0.88, 0.5), L(0.12, 0.95, 0.88, 0.95)],
  ki: [L(0.05, 0.3, 0.95, 0.3), L(0.5, 0.0, 0.5, 1.0), L(0.5, 0.32, 0.08, 0.8), L(0.5, 0.32, 0.92, 0.8)],
  hito: [L(0.6, 0.0, 0.1, 0.5), L(0.38, 0.25, 0.38, 1.0)],
  mizu: [L(0.2, 0.08, 0.45, 0.2), L(0.1, 0.42, 0.38, 0.55), L(0.1, 1.0, 0.45, 0.65)],
  ju: [L(0.05, 0.45, 0.95, 0.45), L(0.5, 0.0, 0.5, 1.0)],
  dai: [L(0.05, 0.35, 0.95, 0.35), L(0.5, 0.0, 0.5, 0.35, 0.05, 1.0), L(0.5, 0.35, 0.95, 1.0)],
  yama: [L(0.5, 0.05, 0.5, 0.9), L(0.1, 0.3, 0.1, 0.9, 0.9, 0.9, 0.9, 0.3)],
  ta: [L(0.08, 0.1, 0.08, 0.92, 0.92, 0.92, 0.92, 0.1, 0.08, 0.1), L(0.08, 0.5, 0.92, 0.5), L(0.5, 0.1, 0.5, 0.92)],
  tsuchi: [L(0.15, 0.35, 0.85, 0.35), L(0.5, 0.05, 0.5, 0.9), L(0.02, 0.9, 0.98, 0.9)],
  ukan: [L(0.5, 0.0, 0.5, 0.15), L(0.05, 0.45, 0.05, 0.2, 0.95, 0.2, 0.95, 0.45)],
  kusa: [L(0.02, 0.35, 0.98, 0.35), L(0.3, 0.05, 0.3, 0.6), L(0.7, 0.05, 0.7, 0.6)],
  ito: [L(0.5, 0.0, 0.15, 0.35, 0.7, 0.55, 0.1, 0.85, 0.9, 0.8), L(0.5, 0.6, 0.5, 1.0)],
  gen: [L(0.05, 0.2, 0.95, 0.2), L(0.2, 0.45, 0.8, 0.45), L(0.2, 0.65, 0.8, 0.65), L(0.15, 0.85, 0.15, 1, 0.85, 1, 0.85, 0.85, 0.15, 0.85)],
  mon: [L(0.1, 1.0, 0.1, 0.05, 0.4, 0.05, 0.4, 0.4, 0.1, 0.4), L(0.9, 1.0, 0.9, 0.05, 0.6, 0.05, 0.6, 0.4, 0.9, 0.4)],
};
const RAD_IDS = Object.keys(RAD);
const KANA = [
  [L(0.15, 0.2, 0.85, 0.2, 0.55, 0.55), L(0.55, 0.55, 0.3, 0.95)],                     // ア-like
  [L(0.1, 0.25, 0.9, 0.25), L(0.6, 0.05, 0.55, 0.6, 0.2, 0.95)],                         // ナ-like
  [L(0.2, 0.15, 0.4, 0.4), L(0.15, 0.95, 0.9, 0.15)],                                   // ン-like
  [L(0.2, 0.1, 0.2, 0.9, 0.85, 0.9)], [L(0.15, 0.3, 0.85, 0.3), L(0.5, 0.3, 0.5, 0.95)], // レ / ト-ish
];
function kanjiBlock(r) {
  const out = [], u = r();
  if (u < 0.18) { place(r.pick(KANA), 0.1, 0.05, 0.8, 0.9, out); return out; }
  if (u < 0.3) { place(RAD[r.pick(RAD_IDS)], 0.08, 0.05, 0.84, 0.9, out); return out; }
  if (u < 0.68) { const w = r.range(0.32, 0.42); place(RAD[r.pick(['hito', 'mizu', 'ki', 'kou', 'ito', 'tsuchi'])], 0.02, 0.05, w, 0.9, out); place(RAD[r.pick(RAD_IDS)], w + 0.06, 0.02, 0.92 - w, 0.96, out); return out; }
  const h = r.range(0.3, 0.45); place(RAD[r.pick(['ukan', 'kusa', 'ju', 'dai', 'yama'])], 0.08, 0.0, 0.84, h, out); place(RAD[r.pick(RAD_IDS)], 0.05, h + 0.04, 0.9, 0.96 - h, out); return out;
}

function strokePaths(ctx, shapes, s, ox, oy) {
  ctx.beginPath();
  for (const g of shapes) {
    if (g.k === 'l') { ctx.moveTo(ox + g.p[0] * s, oy + g.p[1] * s); for (let i = 2; i < g.p.length; i += 2) ctx.lineTo(ox + g.p[i] * s, oy + g.p[i + 1] * s); }
    else { ctx.moveTo(ox + (g.c[0] + g.c[2]) * s, oy + g.c[1] * s); ctx.ellipse(ox + g.c[0] * s, oy + g.c[1] * s, g.c[2] * s, g.c[3] * s, 0, 0, Math.PI * 2); }
  }
  ctx.stroke();
}

/** 8x8 glyph atlas -> CanvasTexture (linear data, mipmapped). style 'hangul' | 'kanji'. cell = px per glyph. */
export function glyphAtlas(THREE, renderer, { style = 'hangul', cell = 128, seed = 1 } = {}) {
  return kit.cached(renderer, `neon:glyphs:${style}:${cell}:${seed}`, () => {
    const N = 8, S = N * cell, r = kit.rng(kit.hashSeed('neon-glyphs', style, seed));
    const tex = kit.canvasTexture(THREE, S, S, ctx => {
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, S, S);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < N * N; i++) {
        const shapes = style === 'kanji' ? kanjiBlock(r) : hangulBlock(r);
        const pad = cell * 0.2, s = cell - pad * 2, ox = (i % N) * cell + pad, oy = Math.floor(i / N) * cell + pad, w = cell * 0.085;
        // glow (G): wide and blurred
        ctx.save(); ctx.beginPath(); ctx.rect((i % N) * cell, Math.floor(i / N) * cell, cell, cell); ctx.clip();
        ctx.strokeStyle = 'rgba(0,90,0,1)'; ctx.shadowColor = 'rgba(0,255,0,1)'; ctx.shadowBlur = cell * 0.09; ctx.lineWidth = w * 2.2; strokePaths(ctx, shapes, s, ox, oy);
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(0,40,0,1)'; ctx.lineWidth = w * 4.5; strokePaths(ctx, shapes, s, ox, oy);
        // block mask (B)
        ctx.fillStyle = 'rgb(0,0,255)'; ctx.fillRect(ox - pad * 0.45, oy - pad * 0.45, s + pad * 0.9, s + pad * 0.9);
        // tube profile (R): stacked strokes, each adding 1/6 -> a linear ridge 1 at the centre, 0 at the rim
        for (let k = 0; k < 6; k++) { ctx.strokeStyle = 'rgba(43,0,0,1)'; ctx.lineWidth = w * (1 - k / 6) + 0.5; strokePaths(ctx, shapes, s, ox, oy); }
        ctx.restore();
      }
    }, { srgb: false, mipmaps: true });
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return tex;
  });
}
