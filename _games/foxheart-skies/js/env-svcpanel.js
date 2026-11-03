// Ground-services panel (environment artist): call or dismiss each turnaround service, call/dismiss all, and the
// automatic-turnaround toggle. Self-contained DOM in the style of the #radio / #pa glass panels; gamepad-ready
// through focusables(). Usage: const svc = ServicePanel(crew, { toast }); svc.toggle(); svc.update(dt) each frame.
const COL = { working: '#55e08f', coming: '#ffb84d', leaving: '#66d7ea', done: '#8e99a8', away: '#4b5563' };
const LABEL = { working: 'WORKING', coming: 'ON THE WAY', leaving: 'LEAVING', done: 'DONE', away: 'NOT CALLED' };
export function ServicePanel(crew, { toast = () => { }, onAuto = null } = {}) {
  const root = document.createElement('div'); root.id = 'svcPanel'; root.className = 'glass'; root.hidden = true;
  root.style.cssText = 'position:fixed;z-index:6;right:max(16px,env(safe-area-inset-right,0px));top:170px;width:min(430px,92vw);max-height:calc(100vh - 210px);overflow:auto;padding:12px;display:grid;gap:10px;pointer-events:auto;background:rgba(14,18,24,.92)';
  const btn = 'padding:5px 11px;border-radius:6px;border:1px solid var(--line2);background:rgba(255,255,255,.05);font:11px var(--f-mono);letter-spacing:.06em;color:var(--ink);white-space:nowrap';
  root.innerHTML = `<div class="rhead"><span class="rlab">GROUND SERVICES</span><span class="rname" data-k="why" style="font:11px var(--f-mono);color:var(--mute)"></span><button data-k="close" aria-label="Close ground services" style="padding:2px 8px;color:var(--mute)">✕</button></div>
    <div class="ropts" data-k="rows"></div>
    <div class="rfoot"><button data-k="all" style="${btn}">Call all</button><button data-k="none" style="${btn}">Dismiss all</button><label class="toggle"><input type="checkbox" data-k="auto"> Automatic turnaround</label></div>`;
  document.body.appendChild(root);
  const q = k => root.querySelector(`[data-k="${k}"]`), rowsEl = q('rows'), rows = new Map();
  const say = r => { if (r && r.msg) toast(r.msg); };
  q('close').onclick = () => api.toggle(false);
  q('all').onclick = () => { say(crew.callAll()); refresh(); };
  q('none').onclick = () => { say(crew.dismissAll()); refresh(); };
  const auto = q('auto'); auto.checked = crew.autoServices; auto.onchange = () => { crew.autoServices = auto.checked; if (onAuto) onAuto(auto.checked); toast(auto.checked ? 'Automatic turnaround: services come by themselves at the next gate' : 'Manual turnaround: call each service yourself'); };
  function build(list) {
    rowsEl.innerHTML = ''; rows.clear();
    for (const s of list) {
      const el = document.createElement('div'); el.className = 'ropt'; el.style.gridTemplateColumns = 'auto 1fr auto';
      el.innerHTML = `<i style="width:9px;height:9px;border-radius:50%;display:block"></i><span><span data-n></span><br><small data-s></small></span><button style="${btn}"></button>`;
      const b = el.querySelector('button'); b.onclick = () => { const cur = rows.get(s.id).state; say(cur === 'working' || cur === 'coming' ? crew.dismissService(s.id) : crew.callService(s.id)); refresh(); };
      rowsEl.appendChild(el); rows.set(s.id, { el, dot: el.querySelector('i'), name: el.querySelector('[data-n]'), sub: el.querySelector('[data-s]'), b, state: '' });
    }
  }
  function refresh() {
    const list = crew.services(); if (rows.size !== list.length) build(list);
    for (const s of list) { const r = rows.get(s.id); r.state = s.state; r.dot.style.background = COL[s.state]; r.dot.style.boxShadow = s.state === 'working' ? '0 0 6px ' + COL.working : 'none';
      r.name.textContent = s.name; r.sub.textContent = `${LABEL[s.state]} · ${s.sub}`; const dismiss = s.state === 'working' || s.state === 'coming';
      r.b.textContent = dismiss ? 'Dismiss' : s.state === 'leaving' ? 'Call again' : 'Call'; r.b.disabled = !dismiss && !s.allowed; r.b.style.opacity = r.b.disabled ? 0.45 : 1; r.b.style.borderColor = dismiss ? 'rgba(255,120,90,.55)' : 'var(--line2)'; }
    const why = list[0] && list[0].why; q('why').textContent = why || 'Parked · brake set'; q('all').disabled = !!why; q('all').style.opacity = why ? 0.45 : 1; auto.checked = crew.autoServices;
  }
  let acc = 0;
  const api = {
    toggle(open) { root.hidden = !(open ?? root.hidden); if (!root.hidden) refresh(); return !root.hidden; },
    update(dt) { if (root.hidden) return; acc += dt; if (acc > 0.25) { acc = 0; refresh(); } },
    get open() { return !root.hidden; },
    focusables() { return [...root.querySelectorAll('button, input')].filter(e => !e.disabled); },
    el: root,
  };
  return api;
}
