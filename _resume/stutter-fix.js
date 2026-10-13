export const meta = {
  name: 'slowreel-stutter-fix-pc',
  description: "Fix Slowreel playback stutter on PC (PC only now; phones get a simple made-for-computers screen; Light mode for weaker PCs), then an independent checker verifies",
  phases: [{ title: 'Fix', detail: 'performance engineer' }, { title: 'Verify', detail: 'independent checker tries to prove it still stutters' }],
}
const S = '/home/user/nicofoxheart/studio'
const T = `${S}/teams/tape`
const PROBE = '/tmp/claude-0/-home-user/63fae2cc-feee-5482-a580-df58aa871eb9/scratchpad/diag/stutter.cjs'
const CTX = `
Slowreel is Nico's ambient music studio in the browser (${T}, published privately as a claude.ai artifact; Nico plays it in Chrome on a
mid-range PC). Read ${S}/shared/BRIEF.md and ${T}/SOUND-API.md first. Nico reports: "when I push play the music stutters".
Measurements so far (probe: cd ${PROBE.replace('/stutter.cjs', '')} && NODE_PATH=$(npm root -g) node stutter.cjs; it serves ${S}, plays the demo and prints
play() call time, timer drift, AudioContext latency, convolver IR lengths, node counts and main-thread long tasks):
- play() blocks the page for about 600-700 ms (notes then start late and bunch up);
- main-thread long tasks of 100-735 ms keep happening during playback (UI loop / canvases / grain or texture work / decoding?);
- 3 convolvers with impulse responses of 9.94 s, 3.25 s and 2.81 s; up to ~545 audio nodes, 29 voices, 41 grains in the demo.
Already applied (keep): latencyHint 'playback', lookahead 0.4 s, play pre-roll 0.3 s, seek pre-roll 0.2 s.
DECISION (Nico, binding): Slowreel is now PC ONLY. Phones do not run the audio engine at all: on phones show a calm, on-brand screen
("Slowreel is made for your computer. Open this link on your PC.") with the reels artwork and no AudioContext; keep the pocket-mode code
but do not start it. Earlier perf attempts were stopped after a few minutes: check BUILD-LOG.md and the files for partial changes first
and keep the good ones (remove any half-built phone listen work).
Other agents are writing NEW files for round 2 (js/sound/synths.js, arp.js, drums.js, sampler.js, fx2.js, js/ui/steps.js, automation.js,
sampler-ui.js): do not create or edit those. You may edit the existing files in ${T}.
Never change how the music sounds beyond what the fix needs: compare a full demo render before and after (integrated loudness within 0.5 LU,
peak within 1 dB, similar spectrogram, reverb tails still natural). Keep every feature working (run node ${S}/shared/qa.cjs teams/tape and
the team tests in ${T}/tests). Append 2-4 lines to ${S}/BUILD-LOG.md when done.
`
phase('Fix')
const fix = await agent(`${CTX}
You are the PERFORMANCE ENGINEER. Find every cause of stutter and fix it properly. Use Chrome tracing through Playwright (CDP Tracing or
Performance domain, or PerformanceObserver longtask + console.time around suspects) to attribute each long task to its function. Targets:
1) play() returns in under 50 ms: build the audio graph, impulse responses, noise and texture buffers and decode Nico's songs ahead of time
   (on load, after edits, in idle time or a Worker), never on play; cache everything reusable.
2) No main-thread task over 50 ms during playback: make the UI loop cheap (draw only what changed, 30 fps cap for decorative canvases,
   pause offscreen or hidden canvases, no layout thrash, no per-frame DOM rebuilds), batch granular grain scheduling, avoid allocating
   big buffers while playing.
3) Audio-thread headroom: cap impulse responses (6 s is plenty; "infinite" can use a shorter IR plus feedback), share reverbs on buses
   instead of per-track convolvers where the sound allows, keep voice and grain caps; render the demo offline and report the real-time
   factor before and after (higher is better).
4) WEAKER PCs: add a "Light mode" switch in settings (off by default; turn it on automatically only if a quick render-speed probe
   shows the PC cannot keep up): one shared reverb with a short impulse (<= 2.5 s), no per-track convolvers, cheap or no shimmer, half the
   voice and grain caps, visuals at <= 20 fps. Test it under CDP Emulation.setCPUThrottlingRate(4): the light engine renders at >= 1.5x
   real time there. Normal mode is the real sound and must stay unchanged.
5) Phones: the made-for-your-computer screen described above (detect phones by coarse pointer + narrow screen; tablets and touch laptops
   with a wide screen still get the studio).
Report before/after numbers for every target, what you changed (file:function), and the render comparison.`,
  { label: 'perf-engineer', phase: 'Fix', effort: 'high' })
if (!fix) return { stopped: 'fix' }
phase('Verify')
const V = { type: 'object', properties: {
  stutterFixed: { type: 'boolean' }, playCallMs: { type: 'number' }, maxLongTaskMsDuringPlayback: { type: 'number' },
  convolverIRseconds: { type: 'array', items: { type: 'number' } }, renderRealtimeFactor: { type: 'number' },
  soundUnchanged: { type: 'boolean' }, featuresOk: { type: 'boolean' },
  fixesMade: { type: 'array', items: { type: 'string' } }, remainingRisks: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' } },
  required: ['stutterFixed', 'playCallMs', 'maxLongTaskMsDuringPlayback', 'convolverIRseconds', 'renderRealtimeFactor', 'soundUnchanged', 'featuresOk', 'fixesMade', 'remainingRisks', 'notes'] }
const verify = await agent(`${CTX}
You are the INDEPENDENT CHECKER. The performance engineer reports: ${fix}
Do not trust the report. Try to prove the studio still stutters: run the probe several times (cold and warm), press play/stop/seek
repeatedly, play while switching tabs in the UI, while the song cloud and meters draw, and with the demo's heaviest section looping; check
the 1920x1080 window too, a 4x CPU-throttled run with Light mode on, and that a phone viewport shows the computer-only screen with no AudioContext. Confirm the sound is unchanged (render comparison) and features still work (qa tool + team tests). Fix any small
remaining problem you find, re-measure, and return the structured verdict with real numbers.`,
  { label: 'checker', phase: 'Verify', effort: 'high', schema: V })
return { fix, verify }
