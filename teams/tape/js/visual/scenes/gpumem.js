// gpumem.js - a rough GPU memory meter for tests (tests/scene-check.cjs): wraps the WebGL2 calls that allocate textures,
// renderbuffers and buffers, and keeps bytes per live object. Install it BEFORE the renderer is created. An estimate:
// it ignores driver padding and counts mip chains as 4/3 of the base level when mipmaps are generated.
const BPP = {
  0x8058: 4, 0x8C43: 4, 0x881A: 8, 0x8814: 16, 0x822F: 4, 0x822E: 4, 0x8230: 8, 0x822D: 2, 0x8229: 1, 0x822B: 2, 0x8C3A: 4, 0x8D62: 2,
  0x81A5: 2, 0x81A6: 3, 0x8CAC: 4, 0x88F0: 4, 0x8CAD: 8, 0x8051: 3, 0x881B: 6, 0x8815: 12, 0x1908: 4, 0x1907: 3, 0x1909: 1, 0x190A: 2, 0x1906: 1,
};
const typeBytes = t => (t === 0x1406 ? 4 : t === 0x140B || t === 0x8D61 ? 2 : t === 0x1405 || t === 0x84FA ? 4 : 1);
const fmtCh = f => (f === 0x1908 || f === 0x8D99 ? 4 : f === 0x1907 ? 3 : f === 0x8227 ? 2 : 1);

export function installGpuMeter(proto = self.WebGL2RenderingContext?.prototype) {
  if (!proto || proto.__kitMeter) return proto?.__kitMeter || null;
  const tex = new Map(), rb = new Map(), buf = new Map(), bound = { tex: new Map(), rb: null, buf: new Map() };
  const meter = { textures: 0, renderbuffers: 0, buffers: 0, get total() { return this.textures + this.renderbuffers + this.buffers; } };
  const sum = () => { meter.textures = [...tex.values()].reduce((a, b) => a + b, 0); meter.renderbuffers = [...rb.values()].reduce((a, b) => a + b, 0); meter.buffers = [...buf.values()].reduce((a, b) => a + b, 0); };
  const wrap = (name, fn) => { const o = proto[name]; if (!o) return; proto[name] = function (...a) { const r = o.apply(this, a); try { fn.call(this, a, r); } catch { } return r; }; };
  const texKey = t => (t >= 0x8515 && t <= 0x851A ? 0x8513 : t);   // cube faces -> the cube map binding
  wrap('bindTexture', ([t, o]) => bound.tex.set(t, o));
  wrap('bindRenderbuffer', ([, o]) => { bound.rb = o; });
  wrap('bindBuffer', ([t, o]) => bound.buf.set(t, o));
  wrap('texStorage2D', ([t, levels, f, w, h]) => { const o = bound.tex.get(t); if (!o) return; let s = 0, ww = w, hh = h; for (let i = 0; i < levels; i++) { s += ww * hh * (BPP[f] || 4); ww = Math.max(1, ww >> 1); hh = Math.max(1, hh >> 1); } tex.set(o, s * (t === 0x8513 ? 6 : 1)); sum(); });
  wrap('texStorage3D', ([t, levels, f, w, h, d]) => { const o = bound.tex.get(t); if (o) { tex.set(o, w * h * d * (BPP[f] || 4) * (levels > 1 ? 1.34 : 1)); sum(); } });
  wrap('texImage2D', a => {
    const t = a[0], o = bound.tex.get(texKey(t)); if (!o || a[1] !== 0) return;
    let w, h, f, ty;
    if (a.length >= 8 && typeof a[3] === 'number') { w = a[3]; h = a[4]; f = a[6]; ty = a[7]; } else { const src = a[5]; w = src?.width || src?.videoWidth || 0; h = src?.height || src?.videoHeight || 0; f = a[3]; ty = a[4]; }
    const bytes = w * h * fmtCh(f) * typeBytes(ty), key = o, prev = tex.get(key) || 0;
    tex.set(key, t >= 0x8515 && t <= 0x851A ? prev + bytes : bytes); sum();
  });
  wrap('generateMipmap', ([t]) => { const o = bound.tex.get(t); if (o && tex.has(o)) { tex.set(o, tex.get(o) * 1.333); sum(); } });
  wrap('deleteTexture', ([o]) => { tex.delete(o); sum(); });
  wrap('renderbufferStorage', ([, f, w, h]) => { if (bound.rb) { rb.set(bound.rb, w * h * (BPP[f] || 4)); sum(); } });
  wrap('renderbufferStorageMultisample', ([, s, f, w, h]) => { if (bound.rb) { rb.set(bound.rb, w * h * (BPP[f] || 4) * Math.max(1, s)); sum(); } });
  wrap('deleteRenderbuffer', ([o]) => { rb.delete(o); sum(); });
  wrap('bufferData', ([t, d]) => { const o = bound.buf.get(t); if (o) { buf.set(o, typeof d === 'number' ? d : d?.byteLength || 0); sum(); } });
  wrap('deleteBuffer', ([o]) => { buf.delete(o); sum(); });
  proto.__kitMeter = meter;
  return meter;
}
