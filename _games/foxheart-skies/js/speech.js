// One speech manager for everything that talks: cabin PA, ATC to you (and your readbacks), ATIS, background
// chatter and GPWS callouts. Only ever one utterance is handed to the browser at a time, so cancelling one
// item never kills another. Priorities: GPWS 5 (never over a PA) > PA 4 > ATC 3 > ATIS 2 > chatter 1.
// Text is split into short chunks (sentences, then commas, max ~180 chars) to dodge Chrome's ~15 s cut-off.
// Subtitles are shown for everything; if speech is missing or silent the subtitles carry on by themselves.
export const PRIO = { gpws: 5, pa: 4, crew: 3.5, atc: 3, atis: 2, chatter: 1 }; // crew: the first officer's checklist callouts on the flight deck
export function chunkText(t, max = 180) {
  const out = []; const sentences = String(t).replace(/\s+/g, ' ').trim().split(/(?<=[.!?。])\s+/);
  for (let s of sentences) {
    while (s.length > max) {
      let cut = -1; for (const re of [/[,;:]\s/g, /\s/g]) { let m; re.lastIndex = 0; while ((m = re.exec(s)) && m.index < max) cut = m.index + 1; if (cut > max * 0.35) break; }
      if (cut <= 0) cut = max; out.push(s.slice(0, cut).trim()); s = s.slice(cut).trim();
    }
    if (s) out.push(s);
  }
  // merge very short neighbours so the voice keeps its flow
  const merged = []; for (const c of out) { const last = merged[merged.length - 1]; if (last && last.length + c.length < 70) merged[merged.length - 1] = last + ' ' + c; else merged.push(c); }
  return merged;
}
const est = (text, rate = 1) => 0.5 + text.length * 0.062 / rate; // seconds
export class Speech {
  constructor() {
    this.items = []; this.cur = null; this.n = 0; this.tok = 0; this.timer = null; this.watch = null; this.wait = null;
    this.enabled = true; this.available = typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
    this.silent = false; this.quick = 0; this.listeners = []; this.log = [];
    if (this.available) { try { const v = () => this.emit('voices'); speechSynthesis.addEventListener ? speechSynthesis.addEventListener('voiceschanged', v) : (speechSynthesis.onvoiceschanged = v); } catch (e) { } }
  }
  on(f) { this.listeners.push(f); } emit(ev, it) { for (const f of this.listeners) try { f(ev, it, this); } catch (e) { } }
  voices() { try { return this.available ? speechSynthesis.getVoices() : []; } catch (e) { return []; } }
  canSpeak() { return this.enabled && this.available && !this.silent; }
  busyWith(ch) { return !!(this.cur && this.cur.channel === ch) || this.items.some(i => i.channel === ch); }
  // o: { text, display, who, channel, prio, voice (fn or voice), lang, rate, pitch, volume, delay (s), onstart, onend, maxWait (s) }
  say(o) {
    const channel = o.channel || 'atc', prio = o.prio ?? PRIO[channel] ?? 3, now = performance.now();
    if (channel === 'gpws' && this.cur && this.cur.channel === 'pa') return null; // never talk over the captain's PA
    const it = { id: ++this.n, channel, prio, o, chunks: chunkText(o.text || o.display || ''), i: 0, ready: now + (o.delay || 0) * 1000, born: now, started: false };
    if (!it.chunks.length) it.chunks = ['']; this.items.push(it); this.items.sort((a, b) => b.prio - a.prio || a.id - b.id);
    const c = this.cur;
    if (c && it.prio > c.prio && (c.prio <= PRIO.atis || channel === 'gpws')) this.interrupt(c.channel === 'chatter'); // chatter is dropped; ATIS / ATC resume
    this.pump(); return it.id;
  }
  cancel(channel) {
    const drop = this.items.filter(i => i.channel === channel); this.items = this.items.filter(i => i.channel !== channel);
    if (this.cur && this.cur.channel === channel) { const c = this.cur; this.stopUtt(); this.cur = null; this.end(c, true); }
    for (const d of drop) if (d !== this.cur && d.started) d.o.onend && d.o.onend(true);
    this.pump();
  }
  interrupt(drop) { const c = this.cur; if (!c) return; this.stopUtt(); this.cur = null; if (drop) { this.items = this.items.filter(i => i !== c); this.end(c, true); } }
  stopUtt() { this.tok++; clearTimeout(this.timer); clearTimeout(this.watch); if (this.available) try { speechSynthesis.cancel(); } catch (e) { } }
  pump() {
    clearTimeout(this.wait); if (this.cur) return; const now = performance.now();
    this.items = this.items.filter(i => !(i.channel === 'chatter' && !i.started && now - i.born > 12000) && !(i.o.maxWait && !i.started && now - i.born > i.o.maxWait * 1000));
    const it = this.items[0]; if (!it) return;
    if (it.ready > now) { this.wait = setTimeout(() => this.pump(), it.ready - now + 5); return; }
    this.speak(it);
  }
  speak(it) {
    this.cur = it; if (!it.started) { it.started = true; it.o.onstart && it.o.onstart(); this.log.push({ ch: it.channel, text: it.o.text, t: performance.now() }); if (this.log.length > 60) this.log.shift(); this.emit('start', it); }
    const text = it.chunks[it.i] || ''; const tok = ++this.tok; const rate = it.o.rate || 1; const t0 = performance.now();
    const next = () => { if (tok !== this.tok) return; clearTimeout(this.timer); clearTimeout(this.watch); it.i++; if (it.i >= it.chunks.length) { this.cur = null; this.items = this.items.filter(i => i !== it); this.end(it, false); this.pump(); } else this.timer = setTimeout(() => { if (tok === this.tok) this.speak(it); }, 60); };
    this.emit('chunk', it);
    if (!text || !this.canSpeak() || it.o.mute) { this.timer = setTimeout(next, est(text, rate) * 1000); return; }
    try {
      const u = new SpeechSynthesisUtterance(text); const v = typeof it.o.voice === 'function' ? it.o.voice() : it.o.voice;
      try { if (v) u.voice = v; } catch (e) { } u.lang = (v && v.lang) || it.o.lang || 'en-US'; u.rate = rate; u.pitch = it.o.pitch ?? 1; u.volume = Math.min(1, it.o.volume ?? 1);
      u.onend = () => { if (tok !== this.tok) return; if (performance.now() - t0 < 60 && text.length > 25) { if (++this.quick >= 3) this.goSilent('speech ends instantly'); } else this.quick = 0; next(); };
      u.onerror = e => { if (tok !== this.tok) return; const er = e && e.error; if (er === 'interrupted' || er === 'canceled') return; if (er === 'not-allowed') this.goSilent('not allowed yet'); next(); };
      this.watch = setTimeout(() => { if (tok === this.tok) { try { speechSynthesis.cancel(); } catch (e) { } next(); } }, est(text, rate) * 2200 + 3000);
      speechSynthesis.speak(u);
    } catch (e) { this.timer = setTimeout(next, est(text, rate) * 1000); }
  }
  end(it, aborted) { this.emit('end', it); it.o.onend && it.o.onend(aborted); }
  goSilent(why) { if (this.silent) return; this.silent = why !== 'not allowed yet'; this.emit('silent', null); if (!this.silent) { this.silentSoft = true; } }
  // called when the user interacts again (speech may now be allowed)
  unlock() { if (this.silentSoft) { this.silentSoft = false; } }
}
