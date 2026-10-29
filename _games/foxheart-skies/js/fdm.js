// Simplified 6-DOF flight model of a generic A320/737-class twin jet, with a fly-by-wire style control law,
// ground contact per gear leg, engines with spool time, and an autopilot/autothrottle (HDG, NAV, ALT, V/S,
// SPD, LOC/GS approach, flare, retard and rollout).
import * as THREE from 'three';
import { KT, FT, D2R, R2D } from './data.js';
import { DIM } from './aircraft.js';
import { ilsDeviation } from './airport.js';

const G = 9.80665, S = 122.6, CBAR = 4.19, B = 34.1;
export const FLAPS = [
  { name: 'UP', flap: 0, slat: 0, dCL: 0, dCD: 0, aS: 14.5, vfe: 350 },
  { name: '1', flap: 0.25, slat: 0.7, dCL: 0.42, dCD: 0.007, aS: 15, vfe: 230 },
  { name: '2', flap: 0.45, slat: 0.85, dCL: 0.6, dCD: 0.016, aS: 15, vfe: 200 },
  { name: '3', flap: 0.6, slat: 0.85, dCL: 0.75, dCD: 0.028, aS: 15, vfe: 185 },
  { name: 'FULL', flap: 1, slat: 1, dCL: 0.95, dCD: 0.058, aS: 15, vfe: 177 },
];
export function isa(h) { const T = 288.15 - 0.0065 * Math.min(h, 11000); const rho = 1.225 * Math.pow(Math.max(0.2, 1 - 2.25577e-5 * Math.min(h, 11000)), 4.2559) * (h > 11000 ? Math.exp(-(h - 11000) / 6341.6) : 1); return { rho, T, a: 20.0468 * Math.sqrt(T) }; }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap180 = a => ((a + 540) % 360) - 180;
const V3 = () => new THREE.Vector3();

export class FDM {
  constructor() {
    this.pos = V3(); this.vel = V3(); this.q = new THREE.Quaternion(); this.w = V3();
    this.mass = 64000; this.I = { pitch: 3.4e6, roll: 1.5e6, yaw: 4.4e6 };
    this.gearPts = [new THREE.Vector3(0, DIM.wheelY, DIM.noseGearZ), new THREE.Vector3(-DIM.mainX, DIM.wheelY, DIM.mainZ), new THREE.Vector3(DIM.mainX, DIM.wheelY, DIM.mainZ)];
    this.law = 'fbw';
    this.reset({});
  }
  reset(o) {
    this.pos.set(o.x || 0, o.y || 0, o.z || 0);
    const h = (o.hdg || 0) * D2R, p = (o.pitch || 0) * D2R;
    this.q.setFromEuler(new THREE.Euler(p, -h, 0, 'YXZ'));
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.q);
    this.vel.copy(fwd).multiplyScalar(o.speed || 0); if (o.vs) this.vel.y = o.vs;
    this.w.set(0, 0, 0);
    this.tl = o.tl ?? 0; this.n1 = [o.n1 ?? 21, o.n1 ?? 21]; this.egt = [420, 420]; this.engRun = [true, true]; this.n2 = this.n1.map(n => 58.6 + Math.max(0, n - 20) * 0.5); this.fuel = o.fuel ?? 8000;
    this.flapIdx = o.flaps ?? 0; this.flapPos = FLAPS[this.flapIdx].flap; this.slatPos = FLAPS[this.flapIdx].slat;
    this.gearDown = o.gear ?? true; this.gearPos = this.gearDown ? 1 : 0;
    this.speedbrake = 0; this.groundSpoilers = 0; this.spoilersArmed = true; this.reverser = 0; this.revCmd = false;
    this.brake = 0; this.parkBrake = o.parkBrake ?? false; this.autobrake = 0; this.steer = 0; this.trim = 0; this.ih = 0;
    this.in = { pitch: 0, roll: 0, yaw: 0 };
    this.de = 0; this.da = 0; this.dr = 0; this.qInt = 0; this.gammaHold = null; this.phiHold = 0; this.pitchHold = null;
    this.onGround = !!o.onGround; this.wow = [false, false, false]; this.airTime = this.onGround ? 0 : 100; this.gndTime = 0;
    this.ap = { on: false, athr: false, lat: 'HDG', vert: 'ALT', spd: o.spdSel ?? 150, hdg: o.hdg || 0, alt: o.altSel ?? 5000, vs: 0, ils: null, appr: false, locArmed: false, gsArmed: false, route: null, wp: 0, retard: false, flare: false, rollout: false };
    this.events = []; this.td = null; this.crashed = null; this.stall = 0; this.tailStrike = false; this.alpha = 0; this.beta = 0; this.nz = 1;
    this.windV = V3(); this.gust = V3(); this.time = 0; this.ra = this.onGround ? 0 : 1e4; this.lastVs = 0; this.maxG = 1; this.calls = {};
    this._iasPrev = 0; this.accel = 0;
    if (!this.onGround && o.speed) { this.ap.spd = Math.round(o.speed / KT); }
  }
  // ---------------- helpers ----------------
  euler() { const e = new THREE.Euler().setFromQuaternion(this.q, 'YXZ'); return { hdg: ((-e.y * R2D) + 360) % 360, pitch: e.x * R2D, bank: -e.z * R2D }; }
  get ias() { return this._ias || 0; }
  speeds() {
    const W = this.mass * G, rho0 = 1.225;
    const vs = (cfg) => { const f = FLAPS[cfg]; const clmax = 0.22 + f.dCL + 5.2 * f.aS * D2R; return Math.sqrt(2 * W / (rho0 * S * clmax)) / KT; };
    const vsNow = vs(this.flapIdx); const vref = 1.23 * vs(4);
    return { vs1g: vsNow, vls: 1.23 * vsNow, vref, vapp: vref + 5, v1: 1.06 * vs(1), vr: 1.09 * vs(1), v2: 1.13 * vs(1) + 2, vfe: FLAPS[this.flapIdx].vfe, vmo: 350, green: 1.28 * vs(0) + 0, f: 1.22 * vs(2), s: 1.23 * vs(1) };
  }
  setFlaps(i) { const n = clamp(i, 0, 4); if (n !== this.flapIdx) { this.flapIdx = n; this.events.push({ t: 'flaps', v: n }); } }
  setGear(down) { if (!down && this.onGround) return; if (down !== this.gearDown) { this.gearDown = down; this.events.push({ t: 'gear', v: down }); } }

  // ---------------- main step ----------------
  step(dt, env) {
    if (this.crashed) return;
    this.time += dt;
    const e = this.euler();
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.q), up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.q), right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.q);
    const atm = isa(Math.max(0, this.pos.y));
    // wind with gusts (Ornstein-Uhlenbeck) and a log-ish boundary layer
    const gnd = env.ground(this.pos.x, this.pos.z); const agl = Math.max(0.1, this.pos.y - gnd.h);
    const wf = Math.min(1, Math.pow(agl / 300, 0.16));
    const wind = env.wind; const ga = env.gust || 0;
    for (const k of ['x', 'y', 'z']) { const sig = (k === 'y' ? 0.35 : 1) * ga * (0.6 + 0.6 * Math.min(1, 200 / agl)); this.gust[k] += (-this.gust[k] / 3 * dt) + sig * Math.sqrt(2 * dt / 3) * (Math.random() * 2 - 1) * 1.7; }
    this.windV.set(wind.x * wf + this.gust.x, this.gust.y * Math.min(1, agl / 30), wind.z * wf + this.gust.z);
    const va = this.vel.clone().sub(this.windV); const V = Math.max(va.length(), 0.01);
    const qinv = this.q.clone().invert(); const vb = va.clone().applyQuaternion(qinv);
    const alpha = Math.atan2(-vb.y, Math.max(-vb.z, 0.1)); const beta = Math.asin(clamp(vb.x / V, -1, 1));
    this.alpha = alpha; this.beta = beta;
    const qbar = 0.5 * atm.rho * V * V; const mach = V / atm.a;
    this._ias = Math.sqrt(atm.rho / 1.225) * V / KT; this.tas = V / KT; this.mach = mach;
    // configuration transitions
    const F = FLAPS[this.flapIdx];
    this.flapPos += clamp(F.flap - this.flapPos, -dt / 7, dt / 7); this.slatPos += clamp(F.slat - this.slatPos, -dt / 5, dt / 5);
    this.gearPos = clamp(this.gearPos + (this.gearDown ? 1 : -1) * dt / 9, 0, 1);
    const ff = this.flapPos; // interpolate config
    const fi = FLAPS.reduce((b, f, i) => Math.abs(f.flap - ff) < Math.abs(FLAPS[b].flap - ff) ? i : b, 0);
    const dCL = this.interp('dCL', ff), dCD = this.interp('dCD', ff), aS = this.interp('aS', ff) * D2R;
    // aerodynamics
    const spoil = Math.max(this.speedbrake * 0.5, this.groundSpoilers);
    let CL0 = 0.22 + dCL - 0.45 * spoil, CLa = 5.2;
    let CL;
    if (alpha < aS) CL = CL0 + CLa * alpha; else { const clmax = CL0 + CLa * aS; CL = Math.max(0.55, clmax - (alpha - aS) * 3.2); }
    if (alpha < -0.2) CL = CL0 + CLa * -0.2 + (alpha + 0.2) * 1.5;
    const ge = agl < B ? 1 + 0.12 * (1 - agl / B) : 1; CL *= ge;
    let CD = 0.021 + 0.043 * CL * CL / ge + dCD + 0.019 * this.gearPos + 0.07 * spoil + (mach > 0.77 ? 2.5 * (mach - 0.77) ** 2 : 0);
    if (alpha > aS) CD += 0.6 * (alpha - aS);
    this.stall = alpha > aS - 1.2 * D2R ? clamp((alpha - (aS - 1.2 * D2R)) / (3 * D2R), 0, 1) : 0;
    const lift = qbar * S * CL, drag = qbar * S * CD;
    const vhat = va.clone().divideScalar(V);
    const liftDir = new THREE.Vector3().crossVectors(right, vhat).normalize();
    const F_ = new THREE.Vector3().addScaledVector(liftDir, lift).addScaledVector(vhat, -drag);
    F_.addScaledVector(right, qbar * S * (-0.85 * beta + 0.12 * this.dr));
    // engines
    let T = 0;
    for (let i = 0; i < 2; i++) {
      const rev = this.reverser > 0.5;
      const cmd = rev ? 20 + 50 * this.tl : 20 + 76 * this.tl;
      const run = this.engRun[i]; // a shut-down engine is driven by the systems model (start sequence / spool-down)
      if (run) { const k = cmd > this.n1[i] ? 0.16 + 0.0105 * this.n1[i] : 0.55; this.n1[i] += (cmd - this.n1[i]) * Math.min(1, k * dt); this.n2[i] += ((58.6 + Math.max(0, this.n1[i] - 20) * 0.5) - this.n2[i]) * Math.min(1, dt * 1.5); }
      const f = run ? 0.04 + 0.96 * Math.pow(clamp((this.n1[i] - 20) / 80, 0, 1.1), 1.85) : 0;
      const ti = 120000 * f * Math.pow(atm.rho / 1.225, 0.75) * (1 - 0.45 * mach + 0.25 * mach * mach);
      T += this.reverser > 0.1 ? -ti * 0.42 * this.reverser : ti;
      if (run) this.egt[i] += ((380 + this.n1[i] * 5.6) - this.egt[i]) * Math.min(1, dt * 0.8);
    }
    this.fuel = Math.max(0, this.fuel - ((this.engRun[0] ? this.n1[0] : 0) + (this.engRun[1] ? this.n1[1] : 0)) * 0.0095 * dt);
    this.reverser = clamp(this.reverser + (this.revCmd ? 1 : -1) * dt / 2, 0, 1);
    F_.addScaledVector(fwd, T);
    F_.y -= this.mass * G;
    // moments (pilot axes: L roll-right, M pitch-up, N yaw-right)
    const p = -this.w.z, qr = this.w.x, r = -this.w.y;
    const Vm = Math.max(V, 25);
    this.controlLaw(dt, e, alpha, beta, V, qbar, agl);
    let Cm = 0.035 - 1.8 * alpha - 1.6 * this.de - 1.9 * this.ih - 30 * (qr * CBAR / (2 * Vm)) - 0.07 * ff - 0.02 * spoil;
    if (alpha > aS) Cm -= 1.2 * (alpha - aS);
    let Cl = -0.09 * beta + 0.11 * this.da - 0.5 * (p * B / (2 * Vm)) + 0.08 * (r * B / (2 * Vm));
    let Cn = 0.11 * beta + 0.07 * this.dr - 0.2 * (r * B / (2 * Vm)) - 0.006 * this.da;
    if (this.stall > 0.3 && !this.onGround) { Cl += (Math.random() - 0.5) * 0.02 * this.stall; Cm += (Math.random() - 0.5) * 0.03 * this.stall; }
    let Mx = qbar * S * CBAR * Cm + T * 1.6 * 0.5 * (this.reverser > 0.1 ? 0 : 1) / 1;
    let Lr = qbar * S * B * Cl, Nn = qbar * S * B * Cn;
    // body-frame torque accumulator
    const tq = new THREE.Vector3(Mx, -Nn, -Lr);
    // ground contact
    this.contact(dt, env, fwd, right, tq, F_);
    // integrate
    const acc = F_.divideScalar(this.mass);
    this.nz = new THREE.Vector3().copy(acc).add(new THREE.Vector3(0, G, 0)).dot(up) / G;
    this.vel.addScaledVector(acc, dt);
    this.pos.addScaledVector(this.vel, dt);
    const gd = this.onGround;
    this.w.x += (tq.x / this.I.pitch - (gd ? 1.2 : 0.06) * this.w.x) * dt;
    this.w.y += (tq.y / this.I.yaw - (gd ? 2.5 : 0.05) * this.w.y) * dt;
    this.w.z += (tq.z / this.I.roll - (gd ? 4.5 : 0.06) * this.w.z) * dt;
    const wl = this.w.length();
    if (wl > 1e-9) { const dq = new THREE.Quaternion().setFromAxisAngle(this.w.clone().divideScalar(wl), wl * dt); this.q.multiply(dq).normalize(); }
    // speed trend
    const ias = this._ias; this.accel += ((ias - this._iasPrev) / dt - this.accel) * Math.min(1, dt * 2); this._iasPrev = ias;
    this.ra = Math.max(0, this.pos.y + DIM.wheelY * Math.cos(e.pitch * D2R) - gnd.h);
    this.gnd = gnd;
    this.callouts(dt);
  }
  interp(key, ff) { for (let i = 0; i < 4; i++) { const a = FLAPS[i], b = FLAPS[i + 1]; if (ff <= b.flap) { const t = (ff - a.flap) / (b.flap - a.flap || 1); return a[key] + (b[key] - a[key]) * t; } } return FLAPS[4][key]; }

  contact(dt, env, fwd, right, tq, F) {
    const qinv = this.q.clone().invert();
    const wasGround = this.onGround; let anyMain = false, any = false;
    const gearOk = this.gearPos > 0.97;
    const hFwd = new THREE.Vector3(fwd.x, 0, fwd.z).normalize(), hRight = new THREE.Vector3(-hFwd.z, 0, hFwd.x);
    const wet = env.wet || 0;
    for (let i = 0; i < 3; i++) {
      const rb = this.gearPts[i]; const rw = rb.clone().applyQuaternion(this.q); const pw = rw.clone().add(this.pos);
      const g = env.ground(pw.x, pw.z); const c = g.h - pw.y;
      this.wow[i] = gearOk && c > -0.02;
      if (!gearOk || c <= 0) continue;
      if (g.water) { this.crash('Ditched in the water'); return; }
      any = true; if (i) anyMain = true;
      const vw = this.vel.clone().add(new THREE.Vector3().crossVectors(this.w.clone().applyQuaternion(this.q), rw));
      const k = i ? 1.25e6 : 6e5, d = i ? 2.4e5 : 9e4;
      let Fn = Math.max(0, k * c - d * vw.y + (c > 0.45 ? (c - 0.45) * 1.5e7 : 0));
      // wheel axes
      let wf = hFwd.clone(), wr = hRight.clone();
      if (i === 0) { const s = this.steer; wf = hFwd.clone().multiplyScalar(Math.cos(s)).addScaledVector(hRight, Math.sin(s)).normalize(); wr = new THREE.Vector3(-wf.z, 0, wf.x); }
      const vl = vw.dot(wf), vlat = vw.dot(wr);
      const brakeMu = i ? (this.parkBrake ? 0.6 : this.brake * (wet ? 0.28 : 0.48)) : 0;
      const mu = 0.016 + brakeMu;
      const Fl = -clamp(vl * 3e5, -mu * Fn, mu * Fn);
      const latMu = (wet ? 0.38 : 0.65);
      const Flat = -clamp(vlat * 5e5, -latMu * Fn, latMu * Fn);
      const Fw = new THREE.Vector3(0, Fn, 0).addScaledVector(wf, Fl).addScaledVector(wr, Flat);
      F.add(Fw);
      tq.add(new THREE.Vector3().crossVectors(rw, Fw).applyQuaternion(qinv));
      if (i && !wasGround && this.airTime > 2 && !this.td) {
        this.td = { vs: this.vel.y, ias: this._ias, t: this.time, x: this.pos.x, z: this.pos.z, pitch: this.euler().pitch, bank: this.euler().bank, ils: this.ap.ils, gs: Math.hypot(this.vel.x, this.vel.z) };
        this.events.push({ t: 'touchdown', v: this.vel.y });
      }
    }
    this.onGround = anyMain || (any && this.onGround);
    if (this.onGround) { this.airTime = 0; this.gndTime += dt; } else { this.airTime += dt; this.gndTime = 0; }
    if (wasGround && !this.onGround) this.events.push({ t: 'liftoff' });
    // structural limits: fuselage / engines / wingtips / tail
    const probes = [[0, -2.0, -17.5], [0, -1.08, 12], [5.75, -3.0, -5], [-5.75, -3.0, -5], [17, -0.2, 3.8], [-17, -0.2, 3.8], [0, -2.1, 0]];
    for (let j = 0; j < probes.length; j++) {
      const pr = probes[j]; const pw = new THREE.Vector3(...pr).applyQuaternion(this.q).add(this.pos); const g = env.ground(pw.x, pw.z);
      if (pw.y < g.h + 0.02) {
        if (j === 1 && this.vel.y > -3 && !g.water) { if (!this.tailStrike) { this.tailStrike = true; this.events.push({ t: 'tailstrike' }); } const push = g.h + 0.02 - pw.y; this.pos.y += push; if (this.vel.y < 0) this.vel.y = 0; continue; }
        if (j === 6 && !gearOk && this.vel.y > -4 && !g.water) { this.crash('Gear-up landing'); return; }
        this.crash(g.water ? 'Crashed into the water' : j >= 4 ? 'Wingtip struck the ground' : j >= 2 ? 'Engine struck the ground' : 'Crashed'); return;
      }
    }
    if (any && this.vel.y < -6.5) this.crash('Hard landing beyond structural limits');
  }
  crash(why) { if (this.crashed) return; this.crashed = why; this.vel.set(0, 0, 0); this.w.set(0, 0, 0); this.events.push({ t: 'crash', v: why }); }

  // ---------------- control law + autopilot ----------------
  controlLaw(dt, e, alpha, beta, V, qbar, agl) {
    const ap = this.ap; const sp = this.speeds();
    const pitchRate = this.w.x, rollRate = -this.w.z, yawRate = -this.w.y;
    const phi = e.bank * D2R, theta = e.pitch * D2R;
    const gamma = Math.asin(clamp(this.vel.y / Math.max(this.vel.length(), 1), -1, 1));
    let pIn = this.in.pitch, rIn = this.in.roll, yIn = this.in.yaw;
    const air = !this.onGround && this.airTime > 1.5;
    // autopilot overrides stick
    let qCmd = null, pCmd = null;
    if (ap.on) {
      if (Math.abs(pIn) > 0.5 || Math.abs(rIn) > 0.5) { this.disconnectAP('stick input'); }
      else { const c = this.autopilot(dt, e, gamma, V, agl, sp); qCmd = c.q; pCmd = c.p; if (c.yaw != null) yIn = c.yaw; }
    }
    if (ap.athr) this.autothrottle(dt, sp);
    const qs = clamp(qbar, 400, 30000);
    // ----- pitch -----
    if (this.law === 'direct' || !air && qCmd == null) {
      const de = -pIn * 20 * D2R;
      this.de += (de - this.de) * Math.min(1, dt * 6);
      this.qInt = 0; this.gammaHold = null;
      if (this.law === 'direct') this.ih = this.trim * D2R;
      else this.ih += (0 - this.ih) * dt * 0.2;
    } else {
      if (qCmd == null) {
        const easy = this.assist === 'easy';
        if (Math.abs(pIn) > 0.04) { qCmd = pIn * (easy ? 0.07 : 0.105); this.gammaHold = null; }
        else { if (this.gammaHold == null) this.gammaHold = gamma; qCmd = 0.55 * (this.gammaHold - gamma); }
        qCmd += (G / Math.max(V, 40)) * Math.tan(phi) * Math.sin(phi) * (Math.abs(phi) < 0.6 ? 1 : 0.4);
        // easy flare (gear down, below 50 ft): the stick sets the pitch attitude around the approach attitude, gently and predictably;
        // let go and the nose returns to the approach attitude
        if (easy && this.gearDown && this.ra < 15) { if (this._flTheta == null) this._flTheta = clamp(theta, -1 * D2R, 4 * D2R);
          const tgt = clamp(this._flTheta + clamp(pIn, -0.4, 1) * 5.5 * D2R, -2 * D2R, 9 * D2R); qCmd = clamp(1.1 * (tgt - theta), -2.5 * D2R, 3 * D2R); this.gammaHold = null; }
        else if (this.ra > 20) this._flTheta = null;
        // easy: soft pitch-attitude envelope (+18 / -10 deg)
        if (easy) { if (theta > 18 * D2R) qCmd = Math.min(qCmd, 0.8 * (18 * D2R - theta)); if (theta < -10 * D2R) qCmd = Math.max(qCmd, 0.8 * (-10 * D2R - theta)); }
        // alpha protection
        const aProt = (this.interp('aS', this.flapPos) - (easy ? 3.5 : 2.0)) * D2R;
        if (alpha > aProt) qCmd = Math.min(qCmd, -0.9 * (alpha - aProt));
        // high-speed protection (and flap-limit speed protection in easy)
        if (this._ias > 345) qCmd = Math.max(qCmd, (this._ias - 345) * 0.004);
        if (easy && this.flapIdx > 0 && this._ias > sp.vfe + 3) qCmd = Math.max(qCmd, (this._ias - sp.vfe - 3) * 0.004);
      }
      const err = qCmd - pitchRate;
      const Kp = clamp(14000 / qs, 0.6, 9), Ki = Kp * 1.3;
      this.qInt = clamp(this.qInt + err * dt * Ki, -0.45, 0.45);
      const de = -(Kp * err + this.qInt);
      this.de = clamp(de, -30 * D2R, 20 * D2R);
      // bleed integrator into stabiliser trim (display + realism)
      const bleed = this.qInt * dt * 0.15; this.ih -= bleed * 0.84; this.qInt -= bleed;
      this.ih = clamp(this.ih, -4 * D2R, 13 * D2R);
    }
    this.trimDisp = -this.ih * R2D;
    // ----- roll -----
    if (this.law === 'direct' || (!air && pCmd == null)) { this.da = rIn * 20 * D2R; this.phiHold = phi; }
    else {
      if (pCmd == null) {
        if (this.assist === 'easy') { // attitude command: the stick sets the bank (max 30 deg); let go and the wings come gently level
          if (Math.abs(rIn) > 0.04) this.phiHold = rIn * 30 * D2R; else this.phiHold -= clamp(this.phiHold, -4 * D2R * dt, 4 * D2R * dt);
          pCmd = clamp(1.1 * (this.phiHold - phi), -0.18, 0.18);
        } else if (Math.abs(rIn) > 0.04) { pCmd = rIn * 15 * D2R; this.phiHold = phi; }
        else if (this.assist === 'realistic') { pCmd = clamp(0.9 * (this.phiHold - phi), -0.15, 0.15); }
        else { let tgt = this.phiHold; if (Math.abs(phi) > 33 * D2R) tgt = Math.sign(phi) * 33 * D2R; if (Math.abs(phi) < 1.5 * D2R && Math.abs(this.phiHold) < 1.5 * D2R) tgt = 0; this.phiHold = tgt; pCmd = clamp(0.9 * (tgt - phi), -0.15, 0.15); }
        if (Math.abs(phi) > 67 * D2R) pCmd = Math.min(Math.abs(pCmd), 0) * Math.sign(phi) - Math.sign(phi) * 0.1;
      }
      const Kr = clamp(9000 / qs, 0.5, 6);
      this.da = clamp(Kr * (pCmd - rollRate) + pCmd * 0.6, -25 * D2R, 25 * D2R);
    }
    // ----- yaw: rudder + yaw damper / turn coordination, nose-wheel steering -----
    const rCoord = (G / Math.max(V, 40)) * Math.tan(phi);
    if (!this.onGround) this.dr = clamp(yIn * 25 * D2R + (air ? 1.2 * beta - 0.9 * (yawRate - rCoord) : 0), -30 * D2R, 30 * D2R);
    else this.dr = clamp(yIn * 25 * D2R, -30 * D2R, 30 * D2R);
    const gsKt = Math.hypot(this.vel.x, this.vel.z) / KT;
    const steerMax = (gsKt < 20 ? 65 : gsKt < 80 ? 65 - (gsKt - 20) * 0.95 : 8) * D2R;
    this.steer += (yIn * steerMax - this.steer) * Math.min(1, dt * 3);
    // spoilers: ground spoilers deploy on touchdown when armed and thrust idle
    if (this.onGround && this.spoilersArmed && this.tl < 0.08 && gsKt > 40 && this.gndTime > 0.3) this.groundSpoilers = Math.min(1, this.groundSpoilers + dt * 2);
    else if (!this.onGround || this.tl > 0.3) this.groundSpoilers = Math.max(0, this.groundSpoilers - dt);
    // autobrake
    if (this.autobrake && this.onGround && this.gndTime > 1 && this.groundSpoilers > 0.5) {
      const tgt = this.autobrake === 1 ? 1.7 : 3.0; const a = -this.accel * KT;
      this.brake = clamp(this.brake + (tgt - a) * dt * 0.4, 0, 1);
      if (gsKt < 8) { this.autobrake = 0; }
    }
  }
  disconnectAP(why) { if (!this.ap.on) return; this.ap.on = false; this.ap.flare = false; this.events.push({ t: 'apoff', v: why }); }

  autopilot(dt, e, gamma, V, agl, sp) {
    const ap = this.ap; const phi = e.bank * D2R;
    const gs = Math.max(Math.hypot(this.vel.x, this.vel.z), 1);
    const track = (Math.atan2(this.vel.x, -this.vel.z) * R2D + 360) % 360;
    let bankCmd = 0, vsCmd = 0, yaw = null;
    // ---- lateral ----
    let dev = null;
    if (ap.ils) dev = ilsDeviation(ap.ils, this.pos);
    if (ap.locArmed && dev && dev.valid && Math.abs(dev.loc) < 6 && dev.along < 40000) { ap.lat = 'LOC'; ap.locArmed = false; this.events.push({ t: 'mode', v: 'LOC' }); }
    if (ap.gsArmed && ap.lat === 'LOC' && dev && dev.valid && dev.gsDev > -0.25 && dev.dist > 0) { ap.vert = 'G/S'; ap.gsArmed = false; this.events.push({ t: 'mode', v: 'G/S' }); }
    if (ap.lat === 'HDG') bankCmd = clamp(wrap180(ap.hdg - track) * 1.6, -25, 25);
    else if (ap.lat === 'NAV' && ap.route) {
      const wp = ap.route[ap.wp]; if (wp) {
        const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z; const d = Math.hypot(dx, dz);
        const brg = (Math.atan2(dx, -dz) * R2D + 360) % 360; ap.hdg = Math.round(brg);
        bankCmd = clamp(wrap180(brg - track) * 1.6, -25, 25);
        if (d < Math.max(1500, gs * 12) && ap.wp < ap.route.length - 1) { ap.wp++; this.events.push({ t: 'wp', v: ap.wp }); }
        else if (d < 2500 && ap.wp === ap.route.length - 1 && ap.ils) { ap.locArmed = true; ap.gsArmed = true; ap.appr = true; ap.lat = 'HDG'; ap.hdg = Math.round(ap.ils.course); this.events.push({ t: 'mode', v: 'APPR armed' }); }
      }
    } else if (ap.lat === 'LOC' && dev) {
      const crs = ap.ils.course; const xt = dev.cross; // + right of course
      const xtRate = this._xtPrev != null ? (xt - this._xtPrev) / dt : 0; this._xtPrev = xt;
      const corr = clamp(-(xt * 0.06 + xtRate * 1.9), -30, 30);
      const wantTrack = crs + corr;
      bankCmd = clamp(wrap180(wantTrack - track) * 1.8, -22, 22);
      if (this.onGround || ap.rollout) {
        ap.rollout = true; bankCmd = 0;
        const hdgErr = wrap180(crs - e.hdg);
        yaw = clamp(hdgErr * 0.12 - xt * 0.05 - xtRate * 0.25, -1, 1);
      } else if (agl < 15) bankCmd = clamp(bankCmd, -3, 3);
    }
    // ---- vertical ----
    const altFt = this.pos.y / FT;
    if (ap.vert === 'ALT' || ap.vert === 'ALT*' || ap.vert === 'V/S') {
      const err = ap.alt - altFt;
      if (ap.vert === 'V/S') { vsCmd = ap.vs; if (Math.abs(err) < Math.abs(ap.vs) * 0.12 + 60 && Math.sign(err) !== -Math.sign(ap.vs || 1)) { ap.vert = 'ALT*'; } }
      else if (Math.abs(err) > 250 && ap.vert === 'ALT') { ap.vert = 'V/S'; ap.vs = clamp(Math.round(err * 0.6 / 100) * 100, -2000, 2200) || Math.sign(err) * 1000; vsCmd = ap.vs; }
      else { vsCmd = clamp(err * 4, -1500, 1500); if (Math.abs(err) < 20) ap.vert = 'ALT'; }
    } else if (ap.vert === 'G/S' && dev) {
      const target = ap.ils.elev + Math.max(0, dev.dist) * Math.tan(3 * D2R);
      vsCmd = (-gs * Math.tan(3 * D2R) + clamp((target - this.pos.y) * 0.18, -3, 3)) / FT * 60;
      if (this.ra < 14 && !ap.flare) { ap.flare = true; ap.vert = 'FLARE'; ap.flareH0 = Math.max(this.ra, 5); ap.flareV0 = Math.max(1.5, -this.vel.y); this.events.push({ t: 'mode', v: 'FLARE' }); }
    }
    if (ap.vert === 'FLARE') {
      vsCmd = -(0.75 + (ap.flareV0 - 0.75) * Math.min(1, this.ra / ap.flareH0)) / FT * 60;
      if (this.ra < 7 && !ap.retard) { ap.retard = true; this.events.push({ t: 'retard' }); }
      if (this.onGround) { ap.vert = 'ROLL OUT'; }
    }
    let q;
    if (ap.vert === 'ROLL OUT') { q = -0.03; }
    else {
      const gCmd = Math.asin(clamp(vsCmd * FT / 60 / Math.max(V, 30), -0.3, 0.3));
      q = clamp(0.5 * (gCmd - gamma), -0.035, 0.035) + (G / Math.max(V, 40)) * Math.tan(phi) * Math.sin(phi);
      if (ap.vert === 'FLARE') q = clamp(1.8 * (gCmd - gamma), -0.03, 0.08);
      const aProt = (this.interp('aS', this.flapPos) - 3.0) * D2R; if (this.alpha > aProt) q = Math.min(q, -0.5 * (this.alpha - aProt));
    }
    if (this.onGround && ap.rollout) { if (Math.hypot(this.vel.x, this.vel.z) < 15) this.disconnectAP('rollout complete'); }
    const p = this.onGround ? 0 : clamp(0.6 * (bankCmd * D2R - phi), -0.09, 0.09);
    return { q, p, yaw };
  }
  autothrottle(dt, sp) {
    const ap = this.ap;
    if (!ap.on && !ap.retard && !this.onGround && this.gearDown && this.ra < 20 * FT && this.airTime > 3) ap.retard = true; // hand-flown with auto-speed: idle for the flare
    if (!ap.on && ap.retard && this.onGround && this.tl <= 0.001) { ap.athr = false; ap.retard = false; return; }
    if (ap.retard || ap.vert === 'ROLL OUT') { this.tl = Math.max(0, this.tl - dt * 0.6); if (this.onGround && ap.rollout) { if (this.gndTime > 1.5 && Math.hypot(this.vel.x, this.vel.z) / KT > 75) { this.revCmd = true; this.tl = 0.55; } else if (Math.hypot(this.vel.x, this.vel.z) / KT < 70) { this.tl = 0; if (Math.hypot(this.vel.x, this.vel.z) / KT < 50) { this.revCmd = false; ap.athr = false; } } } return; }
    const tgt = Math.max(ap.spd, sp.vls + 3);
    const err = tgt - this._ias;
    const rate = ap.on ? clamp(err * 0.05 - this.accel * 0.12, -0.2, 0.2) : clamp(err * 0.035 - this.accel * 0.1, -0.12, 0.12); // softer when hand-flying
    this.tl = clamp(this.tl + rate * dt, 0, 0.98);
  }
  callouts() {
    if (this.onGround || this.vel.y > 0.5) { if (this.onGround) this.calls = {}; return; }
    const ftRA = this.ra / FT;
    for (const c of [2500, 1000, 500, 400, 300, 200, 100, 50, 40, 30, 20, 10]) {
      if (ftRA < c && !this.calls[c] && this.airTime > 5) { this.calls[c] = true; if (ftRA > c - 60) this.events.push({ t: 'call', v: c === 200 ? 'MINIMUMS' : String(c) }); }
    }
    if (ftRA < 22 && ftRA > 3 && this.tl > 0.12 && !this.calls.retard && !this.ap.on) { this.calls.retard = true; this.events.push({ t: 'call', v: 'RETARD' }); }
  }
  // FMA strings
  fma() {
    const ap = this.ap;
    let thr = ap.athr ? (ap.retard || ap.vert === 'ROLL OUT' ? 'IDLE' : 'SPEED') : (this.tl > 0.97 ? 'TOGA' : 'MAN THR');
    if (!ap.athr && this.tl > 0.97) thr = 'MAN TOGA';
    const vert = ap.on ? (ap.vert === 'V/S' ? 'V/S ' + (ap.vs > 0 ? '+' : '') + ap.vs : ap.vert) : '';
    const lat = ap.on ? (ap.lat === 'NAV' ? 'NAV' : ap.lat === 'LOC' ? (ap.rollout ? 'ROLL OUT' : 'LOC') : 'HDG') : '';
    const arm = ap.on ? [(ap.gsArmed ? 'G/S' : ''), (ap.locArmed ? 'LOC' : '')].filter(Boolean).join(' ') : '';
    const cat = ap.ils ? (ap.ils.real ? 'CAT 3' : 'CAT 3*') : '';
    const eng = [ap.on ? 'AP1' : '', ap.athr ? 'A/THR' : ''].filter(Boolean).join(' ');
    return { thr, vert, lat, arm, cat, eng };
  }
}
