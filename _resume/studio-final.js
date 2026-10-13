export const meta = {
  name: 'ambient-studio-final',
  description: "Finish Slowreel, the one chosen ambient studio for Nico (musician + designer, integrator, QA), with grafts from the other teams",
  phases: [
    { title: 'Build', detail: 'ambient musician (sound engine + demo) and graphic designer (UI) in parallel' },
    { title: 'Integrate', detail: 'join sound + UI + shared lib into one working studio' },
    { title: 'QA', detail: 'test like Nico, fix small bugs, score, screenshots' },
  ],
}

// args: { key, look, sound, others }
const t = args
const S = '/home/user/nicofoxheart/studio'
const CTX = `
You are on a team building an ambient music studio in the browser for Nico (he releases music as Nicofoxheart).
Binding brief: ${S}/shared/BRIEF.md - read it fully before anything else. Studio root: ${S}.
Tools: Node + Playwright with Chromium (NODE_PATH=$(npm root -g)), ffmpeg/ffprobe, unzip, the QA tool ${S}/shared/qa.cjs.
No internet except the npm registry; CDNs and Google Fonts are unreachable here (the QA tool maps lamejs and three.js to local copies).
Three teams and a tech lead work AT THE SAME TIME on a 4-core machine: keep browser tests short and close browsers when done.
Nico asked for this to be done as soon as possible: work efficiently, but never ship something broken or ugly.
RESUME RULE: an earlier attempt may have been cut off. First look at what already exists in your folder (and ${S}/BUILD-LOG.md if
present); keep and finish good partial work. When you finish, append 2-5 lines to ${S}/BUILD-LOG.md (who, what works now, what is
next). Write plainly in READMEs.
PRODUCER UPDATE (binding, overrides the brief where they differ): Nico said "just make the best one and save power". There is now
ONE studio: team "tape" (Slowreel) was chosen; the other two teams are stopped and their folders are read-only references
(teams/rain = Lamplit, teams/sky = Daylong). Grafts to include in Slowreel's sound palette: a night-rain texture (rain on glass,
distant city hum) and a shimmer reverb (octave-up feedback) plus a glowing look for the granular song cloud. Save power: no
gold-plating, no extra features beyond the brief's required list, short focused test runs, reuse the shared lib as-is.
Reply with: what you built (file paths), test results with numbers, and what the next stage must know (API notes, known issues).
`

phase('Build')
const [m, d] = await parallel([
  () => agent(`${CTX}
You are the AMBIENT MUSICIAN (sound designer and composer) of team "${t.key}". Your team's sound idea (a seed - make it your own):
${t.sound} 
Your designer is building the UI at the same time against the "Sound engine API" in the brief. You own teams/${t.key}/js/sound/,
teams/${t.key}/demo.json and teams/${t.key}/SOUND-API.md. Do not wait for the shared lib; load songs yourself (fetch +
decodeAudioData of 'audio/<id>.mp3'; create teams/${t.key}/audio as a symlink to ../../shared/audio for local tests).
Build the engine to the API: at least 6 synthesized instruments with presets and 2-4 macros each, the required song-clip playback and
granular song-cloud instrument using Nico's songs, the effects (reverb is the heart: several reverb characters, shimmer, tape echo,
filters, chorus, saturation, whatever your idea needs), the Space and Echo buses, the master with a gentle safety limiter, a lookahead
scheduler for project playback, live noteOn/noteOff, meters, offline render.
Compose the demo song (1-3 minutes, beautiful and quiet, uses at least one of Nico's songs) as demo.json in the project schema.
Listen with numbers: write a Playwright test page in teams/${t.key}/tests/ that renders the demo offline and every instrument preset
and checks: not silent, no clipped samples, peak below -1 dBFS, natural reverb decay (no endless build-up), no NaN, sane voice and
node counts. Pass the demo render to Node, save it as teams/${t.key}/qa/demo-render.wav, and judge the mix with ffmpeg (ebur128,
astats, a spectrogram PNG you look at with Read): balance, low-end mud, harshness above 6 kHz, stereo width. Iterate until you are
proud of the sound. Document everything the designer needs in SOUND-API.md.`,
    { label: `musician:${t.key}`, phase: 'Build', effort: 'high' }),
  () => agent(`${CTX}
You are the GRAPHIC DESIGNER (visual + product designer who also builds the front end) of team "${t.key}". Your team's look (a seed -
make it your own): ${t.look} 
Your musician is building the sound engine at the same time to the "Sound engine API" in the brief. You own everything in
teams/${t.key}/ except js/sound/, demo.json and SOUND-API.md.
Design and build the complete studio UI in artifact form (index.html + css/js files): arrange view, piano roll, instrument and effect
panels with knobs, mixer, transport, project menu, export dialog, live QWERTY keyboard, a song browser for Nico's songs (draw their
real waveforms from the peaks in shared/tracks-data.json), the audio-reactive visual, and the phone "listen / play pads" mode. Until the
real engine exists, develop against a small mock engine in js/ui/mock-engine.js that implements the same API (simple Web Audio tones
so it makes sound) and a sample project in the schema; the integrator swaps in the real one. Name the studio.
Make it look like a team of top graphic designers made it: one strong idea, a real type system, careful spacing, beautiful knobs,
meters and clips, calm motion. It must be usable: every control works with mouse and keyboard; editors scroll inside their own
containers. Run the QA tool, look at every screenshot with Read, and fix what looks off. Write DESIGN.md (idea, name, tokens,
components, interactions).`,
    { label: `designer:${t.key}`, phase: 'Build', effort: 'high' }),
])
if (!m || !d) { log(`Team ${t.key} stopped in Build (an agent did not finish). Resume to continue.`); return { key: t.key, stopped: 'build', m, d } }

phase('Integrate')
const integ = await agent(`${CTX}
You are the INTEGRATOR of team "${t.key}": the team's lead builder, thinking like both the designer and the musician.
Musician report: ${m}
Designer report: ${d}
The tech lead builds ${S}/shared/lib/ in parallel. It is ready when ${S}/shared/lib/READY exists (read ${S}/shared/lib/README.md for the
API). If it is not ready yet, do the work that does not need it first (engine wiring, every control, undo/redo, window.__studio), then
check again. Only if it is still missing at the very end, write the minimum you need into teams/${t.key}/lib/ to the brief's API, mark
it TEMP in its README, and say so in your reply.
Join it into one working studio: copy ${S}/shared/lib/ into teams/${t.key}/lib/ (a real copy, not a symlink, without its tests/);
replace the mock engine with the real one in js/sound/; wire every control to engine calls and the project model (undo/redo, autosave,
projects via lib/storage.js with appKey '${t.key}'); export master via engine.render + lib/export.js (WAV 24-bit + MP3 320 kbps in one
.zip through saveFile); expose window.__studio per the test contract; start the AudioContext on the first click. The demo must open
ready to play and every control must do something real. Run the QA tool and your own Playwright checks, look at the screenshots, and
fix console errors, overflow, broken controls and silent tracks. Try the stretch video export if time allows. Keep the team's idea
intact: you are joining, not redesigning.`, { label: `integrator:${t.key}`, phase: 'Integrate', effort: 'high' })
if (!integ) { log(`Team ${t.key} stopped in Integrate. Resume to continue.`); return { key: t.key, stopped: 'integrate', m, d } }

phase('QA')
const QA = { type: 'object', properties: {
  studioName: { type: 'string' }, idea: { type: 'string', description: '1-2 plain sentences' },
  works: { type: 'boolean' },
  checks: { type: 'array', items: { type: 'object', properties: { area: { type: 'string' }, pass: { type: 'boolean' }, notes: { type: 'string' } }, required: ['area', 'pass', 'notes'] } },
  scores: { type: 'object', properties: { look: { type: 'number' }, sound: { type: 'number' }, usability: { type: 'number' }, stability: { type: 'number' }, ambientFeel: { type: 'number' } }, required: ['look', 'sound', 'usability', 'stability', 'ambientFeel'] },
  bestThings: { type: 'array', items: { type: 'string' } }, problems: { type: 'array', items: { type: 'string' } },
  shots: { type: 'array', items: { type: 'string' }, description: 'absolute paths of the 4-6 best screenshots' },
  demoRender: { type: 'string', description: 'absolute path of a WAV render of the demo' },
  publishFiles: { type: 'array', items: { type: 'string' }, description: 'every file path (relative to teams/<key>/) the published page needs besides index.html, excluding audio/*.mp3, tests/, qa/, shots/' },
}, required: ['studioName', 'idea', 'works', 'checks', 'scores', 'bestThings', 'problems', 'shots', 'demoRender', 'publishFiles'] }
const qa = await agent(`${CTX}
You are the QA ENGINEER of team "${t.key}". Integrator report: ${integ}
Test the studio the way Nico would, with Playwright (desktop 1440x900 and 1920x1080, phone 390x844) and the QA tool:
(1) opens with the demo and plays; (2) arrange: add / move / resize / duplicate / delete clips, loop, zoom, snap; (3) piano roll: draw /
move / resize / delete notes, velocity, scale lock, chord stamp; (4) QWERTY live playing and recording into a clip; (5) every instrument
and preset makes sound (offline renders: not silent, no clipping, no NaN); (6) Nico's songs: song clips and the granular cloud with
several songs; (7) reverbs, effects and buses change the sound measurably; (8) mixer: volume / pan / mute / solo / sends / meters;
(9) projects: new / rename / save / reload the page / open / duplicate / delete, demo recoverable; (10) export: the zip saved through
the mock downloads capability holds a valid 24-bit WAV and a 320 kbps MP3 (unzip -t, ffprobe; check loudness and that the reverb tail
is included); (11) undo / redo; (12) no console errors, no sideways scroll at 390px, visible keyboard focus, reduced motion respected;
(13) performance: audio nodes and active voices during the demo, the visual's frame cost, visuals sleep when stopped.
Fix small bugs yourself (inside teams/${t.key}/ only) and re-test; list what you could not fix. Save the 4-6 best screenshots for Nico in
teams/${t.key}/shots/ (1600x900, include the arrange view, the piano roll and the mixer). Score honestly; Nico will choose between three
studios based partly on your scores.`, { label: `qa:${t.key}`, phase: 'QA', effort: 'medium', schema: QA })

return { key: t.key, m, d, integ, qa }
