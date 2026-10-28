// Aircraft systems behind the overhead panel: batteries, ground power, APU, generators, bleed air, packs,
// fuel pumps, engine start (N2 / EGT sequence), exterior lights and cabin signs. Simplified but causal:
// AC power needs ground power, the APU generator or an engine generator; an engine start needs bleed air.
export class Systems {
  constructor() { this.reset(false); }
  reset(cold) {
    const on = !cold;
    this.cold = cold;
    this.sw = {
      bat1: on, bat2: on, extPwr: false, gen1: true, gen2: true, apuGen: true, busTie: true,
      apuMaster: false, apuStart: false, apuBleed: false, xbleed: 'AUTO',
      pack1: on, pack2: on, bleed1: true, bleed2: true,
      fuelL1: on, fuelL2: on, fuelC1: on, fuelC2: on, fuelR1: on, fuelR2: on, fuelMode: true,
      hyd1: true, hyd2: true, hydElec: false, ptu: true, crewOxy: on,
      ir1: on ? 'NAV' : 'OFF', ir2: on ? 'NAV' : 'OFF', ir3: on ? 'NAV' : 'OFF',
      strobe: on ? 'AUTO' : 'OFF', beacon: on, wing: false, nav: on, rwyTurnoff: false, landL: false, landR: false, nose: on ? 'TAXI' : 'OFF',
      belts: true, smoke: true, emerExit: on ? 'ARM' : 'OFF', dome: 'OFF', annLt: 'BRT', wipers: 'OFF', rainRpl: false,
      engMode: 'NORM', master1: on, master2: on,
      integ: on ? 0.55 : 0, floodMain: 0, floodPed: 0, console: 0,
    };
    this.apuN = 0; this.apuFlap = 0; this.apuEgt = 25; this.apuAvail = false; this.extAvail = false; this._ac = on;
    this.eng = [{ st: on ? 'run' : 'off', msg: '' }, { st: on ? 'run' : 'off', msg: '' }];
    this.touched = {}; this.memo = [];
  }
  get ac() { return this._ac; }
  get dc() { return this.sw.bat1 || this.sw.bat2 || this._ac; }
  get bleedAvail() { return (this.apuAvail && this.sw.apuBleed) || this.engBleed; }
  // fdm: engines (n1, n2, egt, engRun) are driven from here while not running
  update(dt, fdm, env) {
    const s = this.sw, oat = env.oat ?? 20;
    this.extAvail = !!env.gpu; if (!this.extAvail) s.extPwr = false;
    const dcNow = s.bat1 || s.bat2 || this._ac;
    // APU: master opens the inlet flap, START spins it up to AVAIL
    if (s.apuMaster && dcNow) this.apuFlap = Math.min(1, this.apuFlap + dt / 3); else { this.apuFlap = Math.max(0, this.apuFlap - dt / 3); s.apuStart = false; }
    if (s.apuStart && this.apuFlap >= 1 && this.apuN < 100) this.apuN = Math.min(100, this.apuN + dt * (this.apuN < 60 ? 4.2 : 6.5));
    if (!s.apuMaster) this.apuN = Math.max(0, this.apuN - dt * 5);
    this.apuAvail = s.apuMaster && this.apuN >= 95; if (this.apuAvail) s.apuStart = false;
    const egtT = this.apuN > 5 ? (this.apuN < 95 ? 300 + this.apuN * 6.5 : 420) : oat; this.apuEgt += (egtT - this.apuEgt) * Math.min(1, dt * 0.6);
    // electrics
    const gen = [fdm.engRun[0] && s.gen1 && fdm.n2[0] > 50, fdm.engRun[1] && s.gen2 && fdm.n2[1] > 50];
    this._ac = (s.extPwr && this.extAvail) || (this.apuAvail && s.apuGen) || gen[0] || gen[1];
    this.acSrc = s.extPwr && this.extAvail ? 'EXT PWR' : this.apuAvail && s.apuGen ? 'APU GEN' : gen[0] || gen[1] ? 'ENG GEN' : this.dc ? 'BAT' : 'NONE';
    // bleed air
    this.engBleed = (fdm.engRun[0] && s.bleed1) || (fdm.engRun[1] && s.bleed2);
    const air = this.bleedAvail; this.packs = air && (s.pack1 || s.pack2);
    this.duct = air ? (this.apuAvail && s.apuBleed ? 38 : 32) : 0;
    // engines
    this.memo = [];
    for (let i = 0; i < 2; i++) {
      const e = this.eng[i], master = i ? s.master2 : s.master1;
      if (!master) { if (e.st !== 'off') { e.st = 'off'; fdm.engRun[i] = false; } }
      else if (e.st === 'off' || e.st === 'wait') {
        if (fdm.engRun[i]) e.st = 'run';
        else if (s.engMode !== 'IGN') { e.st = 'wait'; this.memo.push(`ENG ${i + 1}: SET ENG MODE TO IGN/START`); }
        else if (!this.dc) { e.st = 'wait'; this.memo.push(`ENG ${i + 1}: NO ELECTRICAL POWER`); }
        else if (!this.apuAvail && !(fdm.engRun[1 - i] && (i ? s.bleed1 : s.bleed2))) { e.st = 'wait'; this.memo.push(`ENG ${i + 1} START: NO BLEED AIR (APU)`); }
        else if (!(this.apuAvail ? s.apuBleed : true)) { e.st = 'wait'; this.memo.push(`ENG ${i + 1} START: APU BLEED OFF`); }
        else e.st = 'start';
      }
      if (e.st === 'start') {
        const n2 = fdm.n2[i];
        if (!this.bleedAvail && n2 < 50) { e.st = 'wait'; continue; }
        if (n2 < 16) { fdm.n2[i] += dt * 1.5; fdm.n1[i] += (n2 * 0.12 - fdm.n1[i]) * Math.min(1, dt); }
        else if (n2 < 50) { fdm.n2[i] += dt * 1.35; fdm.n1[i] += (n2 * 0.33 - fdm.n1[i]) * Math.min(1, dt * 0.8); fdm.egt[i] += (Math.min(690, 200 + (n2 - 16) * 18) - fdm.egt[i]) * Math.min(1, dt * 0.9); }
        else { fdm.n2[i] += (58.6 - n2) * Math.min(1, dt * 0.35) + dt * 0.25; fdm.n1[i] += (20.5 - fdm.n1[i]) * Math.min(1, dt * 0.4); fdm.egt[i] += (470 - fdm.egt[i]) * Math.min(1, dt * 0.25); }
        e.msg = n2 < 16 ? 'START VALVE OPEN' : n2 < 50 ? 'IGNITION · FUEL ON' : 'STABILISING';
        if (fdm.n2[i] >= 57.8) { e.st = 'run'; fdm.engRun[i] = true; }
      }
      if (!fdm.engRun[i] && e.st !== 'start') { // spooling down / cold
        fdm.n2[i] = Math.max(0, fdm.n2[i] - dt * (fdm.n2[i] * 0.08 + 0.3)); fdm.n1[i] = Math.max(Math.min(fdm.ias * 0.06, 12), fdm.n1[i] - dt * (fdm.n1[i] * 0.1 + 0.2));
        fdm.egt[i] += (oat - fdm.egt[i]) * Math.min(1, dt * 0.05);
      }
    }
    if (this.cold && fdm.engRun[0] && fdm.engRun[1] && s.engMode === 'IGN') this.memo.push('ENG MODE: BACK TO NORM');
  }
  // exterior light states for the aircraft model
  lights(onGround) {
    const s = this.sw, p = this.dc;
    return { nav: p && s.nav, beacon: p && s.beacon, strobe: p && (s.strobe === 'ON' || (s.strobe === 'AUTO' && !onGround)), landing: p && (s.landL || s.landR), taxi: p && s.nose !== 'OFF', wing: p && s.wing };
  }
}
