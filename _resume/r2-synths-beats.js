export const meta = {
  name: 'slowreel-round2-synths-beats',
  description: "Slowreel round 2, phase A: classic synths + arpeggiator, and the drum machine + 808 + step sequencer (new files only)",
  phases: [{ title: 'Build', detail: 'SYNTHS lane and BEATS lane in parallel' }],
}
const S = '/home/user/nicofoxheart/studio'
const CTX = `
You are on the Slowreel team (an ambient music studio in the browser for Nico / Nicofoxheart). Read ${S}/shared/ROUND2.md first (binding)
and the files it lists. Studio root ${S}; the app is ${S}/teams/tape. Tools: Node + Playwright Chromium (NODE_PATH=$(npm root -g)),
ffmpeg/ffprobe, the QA tool ${S}/shared/qa.cjs. No internet except the npm registry.
Several lanes work at the same time on a 4-core machine and a QA engineer may be fixing round-1 bugs: write ONLY your own new files
(listed in ROUND2.md for your lane), never edit existing files. Keep browser tests short; close browsers.
Nico wants this as soon as possible: be fast and solid, no gold-plating. Sound quality still matters: check offline renders with
numbers (not silent, no clipping, peak below -1 dBFS, no NaN, sane voice counts) and look at one spectrogram PNG per instrument family.
RESUME RULE: if files of yours already exist, finish them instead of starting over. When done, append 2-4 lines to ${S}/BUILD-LOG.md.
Reply with: files, exported API (exact names and shapes the integrator must call), test numbers, known limits.
`
phase('Build')
const [synths, beats] = await parallel([
  () => agent(`${CTX}\nYou are the SYNTHS lane (a synth sound designer who codes). Build js/sound/synths.js and js/sound/arp.js as ROUND2.md says.`,
    { label: 'synths', phase: 'Build', effort: 'high' }),
  () => agent(`${CTX}\nYou are the BEATS lane (a drum and bass sound designer who codes, plus the step-sequencer UI). Build js/sound/drums.js and js/ui/steps.js as ROUND2.md says.`,
    { label: 'beats', phase: 'Build', effort: 'high' }),
])
return { synths, beats }
