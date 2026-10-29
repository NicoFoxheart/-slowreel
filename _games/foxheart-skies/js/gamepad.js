// Xbox / standard-layout gamepad: connection detection, radial dead zone + expo curve, button remapping,
// press / release / long-press edges, auto-repeat for menu navigation, and rumble through vibrationActuator.
export const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
// remappable actions → default physical buttons
export const ACTIONS = { next: ['Next step', BTN.A], brake: ['Brakes (hold)', BTN.B], atc: ['ATC menu', BTN.X], pa: ['Cabin PA menu', BTN.Y], flapsUp: ['Flaps up / hold for shift layer', BTN.LB], flapsDown: ['Flaps down', BTN.RB] };
const NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS', '↑', '↓', '←', '→', 'Xbox'];
export function btnName(i) { return NAMES[i] ?? 'B' + i; }
// small inline glyph (HTML) for a physical button index or a label
export function glyph(i) {
  const n = typeof i === 'number' ? btnName(i) : i; const cls = { A: 'gA', B: 'gB', X: 'gX', Y: 'gY' }[n] || (/^(LB|RB|LT|RT)$/.test(n) ? 'gS' : 'gK');
  const txt = n === 'View' ? '⧉' : n === 'Menu' ? '☰' : n; return `<span class="gb ${cls}">${txt}</span>`;
}
export class Pad {
  constructor() {
    this.gp = null; this.id = ''; this.standard = true; this.now = new Array(17).fill(false); this.prev = this.now.slice(); this.val = new Array(17).fill(0);
    this.axes = [0, 0, 0, 0]; this.raw = [0, 0, 0, 0]; this.t = 0; this.pressT = {}; this.rep = {}; this.used = {}; this.lastInput = -1e9; this.rumbleT = 0;
    this.cfg = { dz: 0.12, sens: 1, expo: 0.55, invert: false, rumble: true, map: {} };
    this.onConnect = null; this.onDisconnect = null;
    try { addEventListener('gamepadconnected', () => this.poll(0)); addEventListener('gamepaddisconnected', () => this.poll(0)); } catch (e) { }
  }
  get active() { return !!this.gp && this.t - this.lastInput < 30; } // pad is the input in use (touched in the last 30 s)
  phys(action) { const m = this.cfg.map[action]; return m != null ? m : ACTIONS[action] ? ACTIONS[action][1] : -1; }
  poll(dt) {
    this.t += dt; let list = [];
    try { list = navigator.getGamepads ? [...navigator.getGamepads()] : []; } catch (e) { list = []; }
    const live = list.filter(g => g && g.connected !== false);
    const gp = live.find(g => g.mapping === 'standard') || live[0] || null;
    if (gp && (!this.gp || this.gp.index !== gp.index)) { this.id = gp.id || 'Gamepad'; this.standard = gp.mapping === 'standard'; this.gp = gp; this.lastInput = this.t; this.onConnect && this.onConnect(this); }
    else if (!gp && this.gp) { this.gp = null; this.onDisconnect && this.onDisconnect(this); }
    this.gp = gp; this.prev = this.now.slice();
    if (!gp) { this.now.fill(false); this.val.fill(0); this.axes = [0, 0, 0, 0]; return null; }
    let any = false;
    for (let i = 0; i < 17; i++) { const b = gp.buttons[i]; const v = b == null ? 0 : typeof b === 'object' ? (b.value || (b.pressed ? 1 : 0)) : +b; this.val[i] = v; const p = !!(b && (b.pressed || v > 0.5)); this.now[i] = p; if (p && !this.prev[i]) { this.pressT[i] = this.t; this.used[i] = false; } if (i === 6 || i === 7 ? v > 0.08 : p) any = true; }
    for (const [a, b] of [[0, 1], [2, 3]]) {
      const x = gp.axes[a] || 0, y = gp.axes[b] || 0; this.raw[a] = x; this.raw[b] = y; const m = Math.hypot(x, y);
      if (m < this.cfg.dz) { this.axes[a] = this.axes[b] = 0; continue; } any = true;
      const n = Math.min(1, (m - this.cfg.dz) / (1 - this.cfg.dz)), e = this.cfg.expo; const c = Math.min(1, (n * (1 - e) + n * n * n * e) * this.cfg.sens) / m;
      this.axes[a] = x * c; this.axes[b] = y * c;
    }
    if (any) this.lastInput = this.t;
    return gp;
  }
  held(i) { return !!this.now[i]; }
  down(i) { return !!this.now[i] && !this.prev[i]; }
  up(i) { return !this.now[i] && !!this.prev[i]; }
  heldFor(i) { return this.now[i] ? this.t - (this.pressT[i] ?? this.t) : 0; }
  // released after a short press (not used as a modifier in between)
  tap(i, max = 0.4) { return this.up(i) && this.t - (this.pressT[i] ?? 0) < max && !this.used[i]; }
  // fires once when held past `sec`
  long(i, sec = 0.6) { if (!this.now[i]) { this.used['L' + i] = false; return false; } if (!this.used['L' + i] && this.heldFor(i) >= sec) { this.used['L' + i] = true; this.used[i] = true; return true; } return false; }
  // menu auto-repeat: on press, then every 0.14 s after 0.38 s
  repeat(i, dt) { if (!this.now[i]) { this.rep[i] = 0; return false; } if (!this.prev[i]) { this.rep[i] = -0.38; return true; } this.rep[i] += dt; if (this.rep[i] >= 0.14) { this.rep[i] = 0; return true; } return false; }
  // stick as a d-pad for menus (with repeat)
  stickDir(dt) { const x = this.axes[0], y = this.axes[1]; const d = Math.abs(x) > 0.6 ? (x > 0 ? 'R' : 'L') : Math.abs(y) > 0.6 ? (y > 0 ? 'D' : 'U') : null; if (d !== this._sd) { this._sd = d; this._sdT = -0.38; return d; } if (!d) return null; this._sdT += dt; if (this._sdT >= 0.14) { this._sdT = 0; return d; } return null; }
  markUsed(i) { this.used[i] = true; }
  clearUsed(i) { if (!this.now[i]) this.used[i] = false; }
  rumble(strong, weak, ms) {
    if (!this.cfg.rumble || !this.gp) return; const a = this.gp.vibrationActuator;
    try { if (a && a.playEffect) { const p = a.playEffect(a.type === 'trigger-rumble' ? 'trigger-rumble' : 'dual-rumble', { startDelay: 0, duration: ms, strongMagnitude: Math.min(1, Math.max(0, strong)), weakMagnitude: Math.min(1, Math.max(0, weak)) }); if (p && p.catch) p.catch(() => { }); } else if (this.gp.hapticActuators && this.gp.hapticActuators[0]) this.gp.hapticActuators[0].pulse(Math.max(strong, weak), ms); } catch (e) { }
  }
}
