export const meta = {
  name: 'slowreel-round2-integrate',
  description: "Wire the round-2 Antent pack (synths, arp, drums, 808, step sequencer, chop sampler, new effects, automation, Night Garage demo) into Slowreel, fast",
  phases: [{ title: 'Integrate', detail: 'one integrator wires everything in and self-tests' }],
}
const S = '/home/user/nicofoxheart/studio'
const T = `${S}/teams/tape`
const TASKS = '/tmp/claude-0/-home-user/63fae2cc-feee-5482-a580-df58aa871eb9/tasks'
const CTX = `
Slowreel is Nico's ambient music studio in the browser (${T}; published privately as a claude.ai artifact; PC ONLY - phones get a
"made for your computer" screen). Read ${S}/shared/BRIEF.md, ${S}/shared/ROUND2.md (binding, including the PC-only update),
${T}/SOUND-API.md, ${T}/DESIGN.md and the tail of ${S}/BUILD-LOG.md first.
Round-2 lane reports with exact APIs (read them fully): ${TASKS}/wof995fgv.output (synths + arpeggiator, drums + 808 + step sequencer),
${TASKS}/wymiyh8lm.output (chop sampler, new effects, automation), ${TASKS}/w1qlft9ch.output (the Night Garage demo, if present; else
read ${T}/demo-night-garage.json), and the stutter-fix result ${TASKS}/wtbpzl82n.output (performance rules you must keep).
Tools: Node + Playwright Chromium (NODE_PATH=$(npm root -g)), ffmpeg/ffprobe, the QA tool (cd ${S} && node shared/qa.cjs teams/tape), the
stutter probe /tmp/claude-0/-home-user/63fae2cc-feee-5482-a580-df58aa871eb9/scratchpad/diag/stutter.cjs, and every test in ${T}/tests.
Keep the stutter fix: play() under 50 ms, no main-thread task over 50 ms while playing, convolver IRs capped, Light mode working.
RESUME RULE: if an earlier attempt left partial work, finish it. Append 2-4 lines to ${S}/BUILD-LOG.md when done.
`
phase('Integrate')
const integ = await agent(`${CTX}
You are the ROUND-2 INTEGRATOR (the team's lead builder). Wire everything in so Nico can make Antent-style music:
- Register SYNTHS, DRUM_INSTRUMENTS and SAMPLER in the instrument list before the engine is created; register FX2 effects
  (createEffect || createFx2, resolveFx2 in syncFxParams); call scheduleFx and applyAutomation inside scheduleRange for every track,
  resetAutomation on stop/seek; ensureSamples in load() before play and before render(); arpNotes in the scheduler and createLiveArp for
  live keys; respect Light mode in the new instruments where it matters (voice caps, no per-voice convolvers).
- UI: "Add track" offers every instrument grouped (Keys, Pads & Synths, Bass, Drums, Samplers, Textures, Song Cloud); the Sound tab shows
  arp controls; a new Beats tab with the step sequencer (initSteps/renderSteps); the sampler panel for Chop Sampler tracks (import your own
  audio, slices, reverse, pitch, Slowed); automation lanes under tracks (toggle per track, undoable); the new effects in the Effects tab.
  Match Slowreel's design language exactly.
- Load demo-night-garage.json as a second demo ("Night Garage") next to the first; both re-openable from the projects menu.
- Export (zip of WAV + MP3) must include everything (arp, automation, sampler, effects). Run every lane test, the team tests, the QA tool and
  the stutter probe on both demos; fix what breaks. Keep the round-1 features working.
TIME AND USAGE BUDGET: Nico wants this live within about an hour and is watching his usage. Work fast and focused: wire the core first
(register instruments/effects, arp, scheduleFx/automation/ensureSamples in the engine, Add-track menu, Beats tab, sampler panel, effects tab,
Night Garage demo), then automation lanes UI. Keep browser test runs short; no gold-plating. There is no separate QA agent after you: before
you finish, run the QA tool, the stutter probe on both demos, and one export, and fix what breaks.
Reply with what you wired (file:function), test results with numbers (including probe numbers on Night Garage), the full list of files the
published page needs (relative to teams/tape, excluding tests/ qa/ shots/), and known limits.`,
  { label: 'integrator-r2', phase: 'Integrate', effort: 'high' })
return { integ }
