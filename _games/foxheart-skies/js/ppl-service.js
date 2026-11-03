// Cabin crew director: jump seats for taxi / takeoff / landing, and a two-pass trolley service in cruise
// (meal trays and drinks row by row, passengers eat and drink, then the rubbish is collected).
// Drives the crew and passengers of the cabin People set; positions are cabin body-frame (x right, z aft).
const ROW0 = -10.6, PITCH = 0.79, ROWS = 29, FL = -0.55;
export const SVC = { autoAfter: 180, eatTime: 150, serveT: 1.25, walk: 0.45 };
const JUMP = [[-1.43, -13.82], [-0.97, -13.82]]; // forward jump seats on the lav wall, facing aft
const GALLEY = [0.55, -13.25];
const rowOf = z => Math.round((z - 0.1 - ROW0) / PITCH), rowZ = r => ROW0 + r * PITCH + 0.1;
export class CabinDirector {
  constructor(crowd) { this.c = crowd; this.phase = 'boarding'; this.phT = 0; this.svc = null; this.t = null; this.done = { meal: false }; this.home = new Map(); this.auto = true; this.crewSt = new Map(); }
  get crew() { return this.c.p.filter(p => p.crew).slice(-2); }
  pax() { return this.c.p.filter(p => !p.crew && !p.hidden && p.mode === 'sit' && !p.baby && !p.walking && p.y > -50); }
  setPhase(ph) { if (ph === this.phase) return; this.phase = ph; this.phT = 0;
    if (ph === 'taxi' || ph === 'takeoff' || ph === 'landing' || ph === 'arrived') { if (this.svc) this.stopService(true); }
    if (ph === 'descent' && this.svc && this.svc.kind === 'meal') this.stopService(false);
    if (ph === 'landing' || ph === 'arrived' || ph === 'taxi' || ph === 'boarding') for (const p of this.c.p) if (p.prop2 === 'meal') { p.prop2 = null; p.svcAct = null; } }
  service(on) { if (on === 'stop' || on === false) return this.stopService(false); if (this.svc || ['taxi', 'takeoff', 'landing', 'arrived'].includes(this.phase)) return false;
    const meals = this.c.p.some(p => p.prop2 === 'meal'); this.svc = { kind: meals ? 'collect' : 'meal', st: 'prep', t: 0, row: 0, q: [], cur: null }; return true; }
  stopService(now) { if (!this.svc) return; if (now) { for (const p of this.crew) { if (p.prop2 === 'trolley') p.prop2 = null; p.prop = null; } this.svc = null; } else this.svc.st = 'return'; return true; }
  state() { const s = this.svc; return { phase: this.phase, phaseT: +this.phT.toFixed(1), service: s ? { kind: s.kind, st: s.st, row: s.row } : null, mealsDone: this.done.meal, trays: this.c.p.filter(p => p.prop2 === 'meal').length,
    crew: this.crew.map(p => ({ i: p.i, x: +p.x.toFixed(2), z: +p.z.toFixed(2), mode: p.mode, act: p.act, st: this.crewSt.get(p.i) || 'free', prop2: p.prop2 || null })) }; }
  // ---------------------------------------------------------------- per commit
  step(t) {
    if (this.t == null) this.t = t; let dt = t - this.t; if (dt > 0) this.t = t; else dt = 0; dt = Math.min(dt, 120);
    while (dt > 0) { const h = Math.min(dt, 0.25); this._tick(h, t); dt -= h; }
    // passengers' service acts override their normal activity unless they are reacting to something
    for (const p of this.c.p) if (p.svcAct && p.mode === 'sit' && !p.walking && (p.baseAct === undefined || p.act === p.baseAct || p.act === p.svcAct || ['idle', 'window', 'read', 'phone', 'talk'].includes(p.act))) p.act = p.svcAct;
  }
  _tick(dt, t) {
    this.phT += dt; const crew = this.crew; if (crew.length < 2) return;
    for (const p of crew) if (!this.home.has(p.i)) this.home.set(p.i, [p.x, p.z]);
    for (const p of this.c.p) if (p.prop2 === 'meal' && p.svcAct && p.svcAct !== 'take' && p.svcAct !== 'give') { p.eatT = (p.eatT || 0) + dt; p.svcAct = p.eatT > SVC.eatTime ? 'idle' : (Math.floor((p.eatT + p.seed) / 14) % 3 === 2 ? 'drink' : 'eat'); }
    const seatPh = ['taxi', 'takeoff', 'landing'].includes(this.phase);
    if (seatPh) { crew.forEach((p, k) => this._toJump(p, k, dt)); return; }
    if (this.phase === 'cruise' && this.auto && !this.svc && this.phT > SVC.autoAfter && !this.done.meal) this.service('start');
    if (this.phase === 'cruise' && this.auto && !this.svc && this.done.meal && !this.done.collect && this.phT > SVC.autoAfter + SVC.eatTime + 120) this.service('start');
    if (this.svc) return this._service(dt, t, crew);
    // free: leave jump seats and walk home, then hand control back to the cabin logic
    crew.forEach((p, k) => { const st = this.crewSt.get(p.i); if (!st || st === 'free') return;
      if (st === 'seat') { p.mode = 'stand'; p.act = 'idle'; p.prop2 = null; p.x = JUMP[k][0]; p.z = JUMP[k][1] + 0.35; this.crewSt.set(p.i, this.phase === 'arrived' ? 'door' : 'home'); return; }
      if (st === 'door') { p.mode = 'stand'; p.act = 'idle'; if (walk(p, -1.35 + k * 0.5, -12.75 + k * 0.1, 0.6, dt)) { p.yaw = Math.PI * 0.5 * (k ? -0.3 : 1); this.crewSt.set(p.i, 'free'); } return; }
      const h = this.home.get(p.i); if (path(p, [[0.0, Math.max(-12.4, Math.min(p.z, 10.8))], [h[0], h[1]]], 0.7, dt)) { p.mode = 'stand'; this.crewSt.set(p.i, 'free'); } });
  }
  _toJump(p, k, dt) { const st = this.crewSt.get(p.i); const [jx, jz] = JUMP[k];
    if (st === 'seat') { p.mode = 'sit'; p.x = jx; p.z = jz - 0.1 + 0.2; p.yaw = 0; p.prop2 = 'jumpseat'; p.seatT = (p.seatT || 0) + dt; p.act = p.seatT < 2.2 ? 'buckle' : 'idle'; p.prop = null; return; }
    this.crewSt.set(p.i, 'tojump'); p.prop = null; if (p.prop2 === 'trolley') p.prop2 = null;
    if (path(p, [[0, Math.max(-12.4, Math.min(p.z, 10.8))], [0, -12.4], [jx, jz + 0.42]], 0.9, dt)) { this.crewSt.set(p.i, 'seat'); p.seatT = 0; } }
  _service(dt, t, crew) {
    const s = this.svc, [A, Bp] = crew; s.t += dt; for (const p of crew) this.crewSt.set(p.i, 'service');
    const tz = () => A.z + 0.62;
    if (s.st === 'prep') { // both to the galley, take the trolley out
      const a = path(A, [[0, Math.min(A.z, -12.0)], [GALLEY[0] - 0.4, GALLEY[1]]], 0.8, dt), b = path(Bp, [[0, Math.min(Bp.z, -11.8)], [GALLEY[0] - 0.4, GALLEY[1] + 0.5]], 0.8, dt);
      if (a && b) { A.yaw = Math.PI / 2; Bp.yaw = Math.PI / 2; A.mode = Bp.mode = 'stand'; A.act = Bp.act = 'idle'; s.pt = (s.pt || 0) + dt; if (s.pt > 3) { s.st = 'out'; A.prop2 = 'trolley'; A.x = 0; A.z = -12.6; } } return; }
    if (s.st === 'out') { A.act = 'push'; Bp.act = 'idle'; Bp.prop = null; A.yaw = 0; const zt = rowZ(s.row) - 0.62; const a = walk(A, 0, zt, SVC.walk, dt); const b = walk(Bp, 0, zt + 1.3, SVC.walk + 0.1, dt); A.yaw = 0; Bp.yaw = 0; if (!a) A.mode = 'walk';
      if (a && b) { A.mode = Bp.mode = 'stand'; s.st = 'serve'; s.q = this._queue(s.row, A, 'L', s.kind).concat(this._queue(s.row + 1, Bp, 'R', s.kind)); s.cur = null; } return; }
    if (s.st === 'serve') { A.mode = Bp.mode = 'stand';
      for (const who of [A, Bp]) { const job = who._job; if (!job) { const k = s.q.findIndex(j => j.by === who); if (k < 0) { who.act = who === A ? 'push' : 'idle'; who.yaw = 0; who.prop = null; continue; } who._job = s.q.splice(k, 1)[0]; who._job.t = 0; continue; }
        job.t += dt; const P = job.p, side = Math.sign(P.x) || 1; who.yaw = side > 0 ? Math.PI / 2 : -Math.PI / 2; who.act = 'serve'; who.prop = s.kind === 'meal' && job.t < SVC.serveT * 0.6 ? 'tray' : null;
        P.svcAct = s.kind === 'meal' ? 'take' : 'give'; if (s.kind === 'collect' && job.t > SVC.serveT * 0.5) { P.prop2 = null; who.prop = 'tray'; }
        if (job.t > SVC.serveT) { if (s.kind === 'meal') { P.prop2 = 'meal'; P.eatT = 0; P.svcAct = 'eat'; } else { P.prop2 = null; P.svcAct = null; P.eatT = 0; } who._job = null; who.prop = null; } }
      if (!s.q.length && !A._job && !Bp._job) { s.row += 2; if (s.row >= ROWS) { s.st = 'return'; } else s.st = 'out'; } return; }
    if (s.st === 'return') { A._job = Bp._job = null; A.prop = Bp.prop = null; for (const p of this.c.p) if (p.svcAct === 'take' || p.svcAct === 'give') p.svcAct = p.prop2 === 'meal' ? 'eat' : null;
      const a = walk(A, 0, -12.6, 0.6, dt), b = walk(Bp, 0, -11.9, 0.6, dt); if (A.prop2 === 'trolley') A.yaw = Math.PI; if (a && b) { A.prop2 = null; if (s.kind === 'meal') this.done.meal = true; else this.done.collect = true; this.svc = null; for (const p of crew) this.crewSt.set(p.i, 'home'); } }
  }
  _queue(r, who, side, kind) { if (r < 0 || r >= ROWS) return []; const z = rowZ(r), out = [];
    for (const P of this.pax()) { if (Math.abs(P.z - z) > 0.2) continue; if (P.act === 'sleep' && kind === 'meal') continue; if (kind === 'meal' ? P.prop2 === 'meal' : P.prop2 !== 'meal') continue; out.push({ p: P, by: who }); }
    out.sort((a, b) => Math.abs(a.p.x) - Math.abs(b.p.x)); return out; }
}
function walk(p, x, z, sp, dt) { const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz); if (d < 0.03) { p.x = x; p.z = z; return true; } const st = Math.min(d, sp * dt); p.x += dx / d * st; p.z += dz / d * st; p.yaw = Math.atan2(dx, dz); p.mode = 'walk'; p.speed = sp; return false; }
function path(p, pts, sp, dt) { // walk a waypoint list, skipping points already passed (nearest-first)
  let k = p._pk && p._pts === pts.join() ? p._pk : 0; if (p._pts !== pts.join()) { p._pts = pts.join(); k = 0; let best = 1e9; pts.forEach((q, i) => { const d = Math.hypot(q[0] - p.x, q[1] - p.z); if (d < best) { best = d; k = i; } }); }
  for (; k < pts.length; k++) { if (!walk(p, pts[k][0], pts[k][1], sp, dt)) { p._pk = k; return false; } } p._pk = k; p.mode = 'stand'; return true; }
export { rowOf, rowZ, JUMP };
