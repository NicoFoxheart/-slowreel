// Airport site planning (environment artist): an exclusion mask built from the REAL runway geometry (runway strip
// and safety areas: 150 m each side of the runway edge, 300 m past each end) plus every taxiway and apron strip.
// Buildings are oriented boxes; anything that intersects the mask is shifted to a clear spot or culled.
export const obb = (cx, cz, ux, uz, hl, hw) => ({ cx, cz, ux, uz, hl, hw });
// separating-axis test for two oriented rectangles on the ground plane
export function overlap(a, b) {
  const dx = b.cx - a.cx, dz = b.cz - a.cz;
  const axes = [a.ux, a.uz, -a.uz, a.ux, b.ux, b.uz, -b.uz, b.ux];
  for (let i = 0; i < 8; i += 2) {
    const nx = axes[i], nz = axes[i + 1];
    const ra = a.hl * Math.abs(nx * a.ux + nz * a.uz) + a.hw * Math.abs(-nx * a.uz + nz * a.ux);
    const rb = b.hl * Math.abs(nx * b.ux + nz * b.uz) + b.hw * Math.abs(-nx * b.uz + nz * b.ux);
    if (Math.abs(dx * nx + dz * nz) > ra + rb) return false;
  }
  return true;
}
// runway as an oriented box with margins (lateral from the edge, longitudinal past each end)
export const runwayBox = (r, side = 150, end = 300) => obb(r.cx, r.cz, r.dir.x, r.dir.z, r.L / 2 + end, r.W / 2 + side);
export function stripBox(a, b, hw, ext = 0) { const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1; return obb((a.x + b.x) / 2, (a.z + b.z) / 2, dx / L, dz / L, L / 2 + ext, hw); }

export class Site {
  constructor(g) { this.g = g; this.rw = g.runways.map(r => runwayBox(r)); this.tw = []; this.ap = []; this.placed = []; this.culled = 0; }
  addTaxi(a, b, hw) { this.tw.push(stripBox(a, b, hw + 20, 15)); }
  addApron(o) { this.ap.push(o); }
  hits(o, sets = ['rw', 'tw', 'ap']) { for (const s of sets) for (const e of this[s]) if (overlap(o, e)) return true; return false; }
  // footprint centred at (x, z), long axis (ux, uz), half sizes; tries each shift [dx, dz] in order; returns the clear box or null (culled)
  place(x, z, ux, uz, hl, hw, shifts = [[0, 0]], sets) {
    for (const [sx, sz] of shifts) { const o = obb(x + sx, z + sz, ux, uz, hl, hw); if (!this.hits(o, sets)) { this.placed.push(o); return o; } }
    this.culled++; return null;
  }
}
