// Failures and emergencies (lead-owned): engine failure (also at V1 on the takeoff roll), engine fire, landing gear that
// will not extend, green hydraulic failure, bird strike, cabin depressurisation, double generator failure and jammed flaps.
// Each one sets the aircraft up in the FDM / systems, raises the ECAM warning (red: master warning + continuous chime;
// amber: master caution + single chime) and the first officer calls the procedure one line at a time ("ECAM actions");
// the next line runs from the smart A button, the E key, or the matching flight-deck control (fire pushbuttons).
export const FAILS = [
  { id: 'eng', label: 'Engine failure' }, { id: 'v1', label: 'Engine failure at V1 (next takeoff)' }, { id: 'fire', label: 'Engine fire' },
  { id: 'gear', label: 'Landing gear will not extend' }, { id: 'hyd', label: 'Hydraulic failure (green system)' }, { id: 'bird', label: 'Bird strike' },
  { id: 'depress', label: 'Cabin depressurisation' }, { id: 'elec', label: 'Electrical failure (both generators)' }, { id: 'flap', label: 'Flaps jammed' },
];
const NUM = ['one', 'two'];
export class Failures {
  // o: { fdm, sys, audio, say(text) → FO voice, toast(text), pa(id), assist() → 'easy' | 'normal' | 'realistic' }
  constructor(o) { this.o = o; this.random = 'off'; this.reset(); }
  reset() {
    const f = this.o.fdm, s = this.o.sys; this.list = []; this.armV1 = null; this.t = 0; this.crc = false; this.crcT = 0; this.seen = new Set(); this.foQ = []; this.foT = 0; this.cabAlt = 0; this.belly = null;
    f.fail = { thr: [1, 1], flapJam: null, flapMax: 4, gearJam: 0, gravity: false, hyd: false, noAP: false, vappAdd: 0 }; f.rudTrim = 0;
    s.fire = [{ on: false, pushed: false, agents: 0 }, { on: false, pushed: false, agents: 0 }]; s.engFault = [false, false]; s.emerElec = false;
    this.randAt = null; this.randDone = false;
  }
  get active() { return this.list.filter(x => !x.cleared); }
  get emergency() { const a = this.active; return a.length ? (a.some(x => x.sev === 'mayday') ? 'mayday' : 'pan') : null; }
  nature() { const a = this.active; return a.length ? a.map(x => x.nature).join(', and ') : ''; }
  has(id) { return this.list.some(x => x.id === id && !x.cleared); }
  // ---------------------------------------------------------------- trigger
  trigger(id, opt = {}) {
    const f = this.o.fdm, s = this.o.sys, i = opt.eng ?? (Math.random() < 0.5 ? 0 : 1), n = i + 1, N = NUM[i];
    if (id === 'v1') { this.armV1 = { eng: i }; this.o.toast && this.o.toast('Failure armed: an engine will fail at V1 on the next takeoff.'); return true; }
    if (this.has(id === 'eng' || id === 'bird' ? 'eng' + n : id)) return false;
    const F = { id, t: this.t, step: 0, eng: i };
    const thrIdle = { t: `THR LEVER ${n} ........ IDLE`, say: `Thrust lever ${N}, idle.`, run: () => { f.fail.thr[i] = 0.05; } };
    const master = { t: `ENG MASTER ${n} ........ OFF`, say: `Engine master ${N}, off.`, run: () => { s.sw['master' + n] = false; s.engFault[i] = true; f.engRun[i] = false; } };
    switch (id) {
      case 'eng': Object.assign(F, { id: 'eng' + n, title: `ENG ${n} FAIL`, c: 'a', sev: 'mayday', nature: `engine failure, engine ${N}`, fo: [`Engine failure, engine ${N}!`, 'I have the rudder trimmed. E C A M actions when you are ready.'],
        acts: [thrIdle, master, { t: 'APU ........ START', say: 'A P U, start.', run: () => { s.sw.apuMaster = true; s.sw.apuStart = true; } }, { t: 'LAND ASAP', say: 'Land as soon as possible. Single-engine approach, flaps three.', run: () => { f.fail.flapMax = 3; } }] });
        s.engFault[i] = true; f.engRun[i] = false; break;
      case 'fire': Object.assign(F, { id: 'fire' + n, title: `ENG ${n} FIRE`, c: 'r', sev: 'mayday', nature: `engine fire, engine ${N}`, fo: [`Engine ${N} fire!`, 'E C A M actions.'],
        acts: [thrIdle, master, { t: `ENG ${n} FIRE P/B ........ PUSH`, say: `Engine ${N} fire pushbutton, push.`, run: () => this.firePb(i, true) }, { t: 'AGENT 1 ........ DISCH', say: 'Agent one, discharge.', run: () => this.agent(i) },
          { t: 'AGENT 2 (IF FIRE AFTER 30 S) ... DISCH', say: 'Fire still on. Agent two, discharge.', run: () => this.agent(i), when: () => s.fire[i].on, ready: () => !s.fire[i].on || this.t - (s.fire[i].agT || 0) > 15 }, { t: 'LAND ASAP', say: 'Land as soon as possible.', run: () => { f.fail.flapMax = 3; } }] });
        s.fire[i] = { on: true, pushed: false, agents: 0, outT: null, t: 0 }; break;
      case 'bird': Object.assign(F, { id: 'eng' + n, title: `ENG ${n} STALL`, c: 'a', sev: 'mayday', nature: `bird strike, engine ${N} damaged`, fo: ['Bird strike!', `Engine ${N} has stalled, heavy vibrations. E C A M actions.`],
        acts: [thrIdle, master, { t: 'LAND ASAP', say: 'Land as soon as possible.', run: () => { f.fail.flapMax = 3; } }] });
        f.fail.thr[i] = 0.5; this.o.audio && this.o.audio.thump && (this.o.audio.thump(0.9), setTimeout(() => this.o.audio.thump(0.5), 140)); this.vib = { i, t: 0 }; break;
      case 'gear': Object.assign(F, { title: 'L/G GEAR NOT DOWNLOCKED', c: 'a', sev: 'pan', nature: 'landing gear will not extend', fo: ['The gear is not coming down.', 'E C A M: gravity extension.'], hidden: true,
        acts: [{ t: 'L/G LEVER ........ DOWN', say: 'Gear lever, down.', run: () => f.setGear(true) }, { t: 'GRAVITY EXTN ..... TURN 3 TIMES', say: 'Gravity extension, cranking now.', run: () => { f.fail.gravity = true; this.gravityT = this.t; } },
          { t: 'IF GEAR NOT DOWN: BELLY LANDING', say: 'The gear is still up. We will land on the belly. Prepare the cabin and brief the brace.', run: () => { F.sev = 'mayday'; F.nature = 'landing gear will not extend, belly landing'; this.o.pa && this.o.pa('emerg'); }, when: () => f.gearPos < 0.97, ready: () => this.gravityT == null }] });
        f.fail.gearJam = 2; break;
      case 'hyd': Object.assign(F, { title: 'HYD G SYS LO PR', c: 'a', sev: 'pan', nature: 'hydraulic failure', fo: ['Green hydraulic system, low pressure.', 'E C A M actions.'],
        acts: [{ t: 'PTU ........ CHECK', say: 'P T U, checked, no pressure.', run: () => { } }, { t: 'APPR: FLAPS 3, VAPP +10', say: 'For the approach: flaps three, approach speed plus ten.', run: () => { } }, { t: 'L/G: GRAVITY EXTN', say: 'Gear by gravity extension, landing distance times one point five.', run: () => { f.fail.gravity = true; this.gravityT = this.t; } }] });
        Object.assign(f.fail, { hyd: true, gearJam: Math.max(f.fail.gearJam, 1), flapMax: 3, vappAdd: 10 }); f.autobrake = 0; break;
      case 'depress': Object.assign(F, { title: 'CAB PR EXCESS CAB ALT', c: 'r', sev: 'mayday', nature: 'rapid decompression, emergency descent', fo: ['Cabin altitude! We have lost pressurisation.', 'Masks on. Emergency descent.'],
        acts: [{ t: 'CREW OXY MASKS ........ USE', say: 'Oxygen masks on, crew communication established.', run: () => { } }, { t: 'EMER DESCENT ........ INITIATE', say: 'Emergency descent. Altitude ten thousand, speed maximum, speed brakes.', run: () => this.emerDescent() },
          { t: 'PAX OXY MASKS ........ MAN ON', say: 'Passenger oxygen masks, on.', run: () => { this.o.toast && this.o.toast('Passenger oxygen masks are down.'); this.o.pa && this.o.pa('masks'); } }] });
        this.cabAlt = Math.max(this.cabAlt, 8000); this.decomp = true; break;
      case 'elec': Object.assign(F, { title: 'ELEC EMER CONFIG', c: 'r', sev: 'mayday', nature: 'electrical failure, both generators', fo: ['Electrical emergency configuration. Both generators lost, the RAT is out.', 'E C A M actions.'],
        acts: [{ t: 'GEN 1+2 ...... OFF THEN ON', say: 'Generators off, then on. No reset.', run: () => { } }, { t: 'APU ........ START', say: 'A P U, start. Its generator will take the load.', run: () => { s.sw.apuMaster = true; s.sw.apuStart = true; s.sw.apuGen = true; } }, { t: 'LAND ASAP', say: 'Land as soon as possible.', run: () => { } }] });
        s.emerElec = true; f.fail.noAP = true; if (f.ap.on) f.disconnectAP('elec'); f.ap.athr = false; break;
      case 'flap': Object.assign(F, { title: 'F/CTL FLAPS LOCKED', c: 'a', sev: 'pan', nature: 'flaps jammed', fo: ['Flaps are locked.', 'E C A M actions.'],
        acts: [{ t: 'FLAPS LEVER ...... RECYCLE', say: 'Flaps lever recycled. No movement.', run: () => { } }, { t: 'VAPP / LDG DIST ...... INCREASE', say: () => `Approach speed ${Math.round(f.speeds().vapp)} knots, landing distance increased.`, run: () => { } }] });
        f.fail.flapJam = f.flapPos; break;
      default: return false;
    }
    this.list.push(F); this.foQ.push(...F.fo); if (!F.hidden) this.alert(F); return true;
  }
  alert(F) { if (F.alerted) return; F.alerted = true; F.hidden = false; const a = this.o.audio; if (F.c === 'r') { this.crc = true; this.crcT = 0; } else a && a.cautionChime && a.cautionChime(); this.o.onAlert && this.o.onAlert(F); }
  firePb(i, viaChecklist) { const s = this.o.sys, f = this.o.fdm; const F = s.fire[i]; s.sw['master' + (i + 1)] = false; s.engFault[i] = true; f.engRun[i] = false; F.pushed = true; this.crc = false; if (!viaChecklist) this.skipTo('fire' + (i + 1), 3); return F.on; }
  agent(i) { const F = this.o.sys.fire[i]; if (!F.pushed) this.firePb(i, true); F.agents++; F.agT = this.t; if (F.on && F.outT == null) F.outT = this.t + (F.agents >= 2 || Math.random() < 0.65 ? 4 + Math.random() * 8 : 1e9); }
  skipTo(id, step) { const x = this.list.find(x => x.id === id); if (x && x.step < step) x.step = step; }
  emerDescent() { const f = this.o.fdm, ap = f.ap; const tgt = Math.max(10000, Math.round(((f.gnd?.h || 0) / 0.3048 + 4000) / 1000) * 1000); ap.alt = tgt; if (!f.fail.noAP && !ap.on && !f.onGround && f.ra > 30) { ap.on = true; ap.lat = 'HDG'; ap.hdg = Math.round(f.euler().hdg); } ap.vert = 'V/S'; ap.vs = -5000; ap.athr = !f.fail.noAP; ap.spd = 300; f.speedbrake = 1; this.o.toast && this.o.toast(`Emergency descent: ALT ${tgt.toLocaleString('en-US')}, V/S -5000, speed brakes out`); }
  silence() { this.crc = false; }
  // ---------------------------------------------------------------- the next ECAM line for the smart A / E key
  nextAction() {
    const f = this.o.fdm; if (f.onGround && !this.belly && !this.list.some(x => x.id.startsWith('fire') && !x.cleared)) return null;
    if (!f.onGround && f.ra / 0.3048 < 400 && f.airTime < 60) return null; // no procedures below 400 ft after takeoff: fly the aircraft
    for (const x of this.active) { if (x.hidden) continue; let a = x.acts[x.step]; if (a && a.ready && !a.ready()) continue; while (a && a.when && !a.when()) { x.step++; a = x.acts[x.step]; } if (!a) { if (!x.done) { x.done = true; this.foQ.push('E C A M actions complete.'); } continue; }
      return { label: 'ECAM: ' + a.t.replace(/\s*\.{2,}\s*/, ' '), run: () => { this.crc = false; const say = typeof a.say === 'function' ? a.say() : a.say; this.o.say && this.o.say(say); a.run(); x.step++; if (x.step >= x.acts.length) { x.done = true; this.foQ.push('E C A M actions complete.'); } } }; }
    return null;
  }
  // ---------------------------------------------------------------- per sim step
  update(dt) {
    const f = this.o.fdm, s = this.o.sys, a = this.o.audio; this.t += dt; const agl = f.ra / 0.3048, alt = f.pos.y / 0.3048;
    if (this.armV1 && f.onGround && f.tl > 0.6 && f.ias >= f.speeds().v1) { const i = this.armV1.eng; this.armV1 = null; this.trigger('eng', { eng: i }); this.list[this.list.length - 1].fo = []; this.foQ = ['Engine failure!', 'V one.']; this.v1Calls = { vr: false, pos: false }; }
    if (this.v1Calls) { if (!this.v1Calls.vr && f.onGround && f.ias >= f.speeds().vr) { this.v1Calls.vr = true; this.foQ.push('Rotate.'); } if (!this.v1Calls.pos && !f.onGround && f.vel.y > 1.5 && agl > 30) { this.v1Calls.pos = true; this.foQ.push('Positive climb. Keep it straight, rudder.'); } if (agl > 400 && !this.v1Calls.ecam && !f.onGround) { this.v1Calls.ecam = true; const e = this.list.find(x => x.id.startsWith('eng')); this.foQ.push(`Four hundred feet. Engine ${NUM[e ? e.eng : 0]} is out, rudder trimmed. E C A M actions.`); } }
    // random failure during the flight
    if (this.random !== 'off' && !this.randDone) {
      if (this.randAt == null && !f.onGround && agl > 1500) { const p = this.random === 'rare' ? 0.25 : 0.6; this.randDone = Math.random() > p; this.randAt = this.t + 60 + Math.random() * 900; }
      else if (this.randAt != null && this.t > this.randAt && !f.onGround && agl > 1500) { this.randDone = true; const pool = ['eng', 'fire', 'hyd', 'bird', 'elec', 'flap', 'gear']; if (alt > 15000) pool.push('depress', 'depress'); this.trigger(pool[(Math.random() * pool.length) | 0]); }
    }
    // gear: discovered when the lever goes down
    for (const x of this.list) if (x.hidden && x.id === 'gear' && f.gearDown && !f.onGround) { x.hiddenT = (x.hiddenT || 0) + dt; if (x.hiddenT > 9) { x.step = 1; this.alert(x); this.foQ.push(...x.fo); } }
    if (f.fail.gravity && this.gravityT != null && this.t - this.gravityT > 18) { this.gravityT = null; if (f.fail.gearJam === 2) { f.fail.gravity = false; this.foQ.push('Gravity extension failed. Three red, the gear is still up.'); } else this.foQ.push('Gear down by gravity. Three green.'); }
    // fire: burns until agents put it out; an unattended fire eventually kills the engine
    for (let i = 0; i < 2; i++) { const F = s.fire[i]; if (!F.on) continue; F.t = (F.t || 0) + dt; if (F.outT != null && this.t > F.outT) { F.on = false; this.foQ.push(`Fire is out, engine ${NUM[i]}.`); const x = this.list.find(x => x.id === 'fire' + (i + 1)); if (x) { x.c = 'a'; x.title = `ENG ${i + 1} SHUT DOWN`; x.sev = 'pan'; } }
      if (F.t > 120 && f.engRun[i]) { f.engRun[i] = false; s.engFault[i] = true; } }
    // bird strike: vibration and a hot engine until it is brought to idle
    if (this.vib && f.fail.thr[this.vib.i] > 0.2 && f.engRun[this.vib.i]) { const i = this.vib.i; f.n1[i] += (Math.random() - 0.5) * 6 * dt * 10; f.egt[i] = Math.min(1100, f.egt[i] + dt * 6); }
    // depressurisation: the cabin climbs toward the aircraft altitude; red above 9,550 ft; resolved once below 10,000 ft
    if (this.decomp) { this.cabAlt += Math.sign(alt - this.cabAlt) * Math.min(Math.abs(alt - this.cabAlt), dt * 6000); const x = this.list.find(x => x.id === 'depress' && !x.cleared); if (x && this.cabAlt < 9550 && alt < 10500 && x.step > 1) { x.cleared = true; this.foQ.push('Ten thousand feet. Cabin altitude is safe, masks can come off.'); f.speedbrake = 0; if (f.ap.vert === 'V/S') { f.ap.vert = 'ALT'; } } }
    // electrics: the APU generator restores AC power
    if (s.emerElec && s.apuAvail && s.sw.apuGen) { s.emerElec = false; f.fail.noAP = false; const x = this.list.find(x => x.id === 'elec'); if (x) { x.c = 'a'; x.title = 'ELEC GEN 1+2 FAULT (APU GEN ON)'; x.sev = 'pan'; } this.foQ.push('A P U generator is on line. We have the autopilot back.'); }
    // aural: continuous repetitive chime for a red warning until silenced or a procedure line is run
    if (this.crc && this.active.some(x => x.c === 'r' && !x.hidden)) { this.crcT -= dt; if (this.crcT <= 0) { this.crcT = 0.62; a && a.masterChime && a.masterChime(); } } else this.crc = false;
    // first officer callouts, one at a time
    this.foT -= dt; if (this.foQ.length && this.foT <= 0) { const t = this.foQ.shift(); this.o.say && this.o.say(t); this.foT = 1.2 + t.length * 0.06; }
    // engine-out rudder trim: the first officer / autopilot trims out the yaw (not in Realistic with the autopilot off)
    f.autoTrim = this.o.assist() !== 'realistic' || f.ap.on;
  }
  // ECAM lines for the E/WD: titles in red / amber, open actions in cyan
  ecam(out) {
    for (const x of this.active) { if (x.hidden) continue; out.push({ t: x.title, c: x.c }); for (let k = x.step; k < x.acts.length && k < x.step + 2; k++) out.push({ t: ' - ' + x.acts[k].t, c: 'b' }); }
    if (this.decomp && this.cabAlt > 9550) out.push({ t: `CAB ALT ${Math.round(this.cabAlt / 100) * 100}`, c: 'a' });
    return out;
  }
  // after a belly landing / fire: evacuation and the rescue services
  touchdown(belly) { if (belly) { this.belly = { t: this.t }; this.foQ.push('We are down. Stop, stop!'); } }
}
