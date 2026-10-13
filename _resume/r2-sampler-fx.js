export const meta = {
  name: 'slowreel-round2-sampler-fx',
  description: "Slowreel round 2, phase A: chop sampler with imports, new effects (sidechain pump, tape stop, bitcrusher, auto filter, widener) and automation lanes (new files only)",
  phases: [{ title: 'Build', detail: 'SAMPLER + FX + AUTOMATION lane' }],
}
const S = '/home/user/nicofoxheart/studio'
phase('Build')
const out = await agent(`
You are on the Slowreel team (an ambient music studio in the browser for Nico / Nicofoxheart). Read ${S}/shared/ROUND2.md first (binding)
and the files it lists. Studio root ${S}; the app is ${S}/teams/tape. Tools: Node + Playwright Chromium (NODE_PATH=$(npm root -g)),
ffmpeg/ffprobe, the QA tool ${S}/shared/qa.cjs. No internet except the npm registry.
Several lanes work at the same time on a 4-core machine and a QA engineer may be fixing round-1 bugs: write ONLY your own new files
(listed in ROUND2.md for your lane), never edit existing files. Keep browser tests short; close browsers.
Nico wants this as soon as possible: be fast and solid, no gold-plating. Check offline renders with numbers (not silent, no clipping,
peak below -1 dBFS, no NaN) and that automation and each effect measurably change the sound.
RESUME RULE: if files of yours already exist, finish them instead of starting over. When done, append 2-4 lines to ${S}/BUILD-LOG.md.
You are the SAMPLER + FX + AUTOMATION lane (a sampling / effects specialist who codes UI too). Build js/sound/sampler.js,
js/sound/fx2.js, js/ui/automation.js and js/ui/sampler-ui.js as ROUND2.md says.
Reply with: files, exported API (exact names and shapes the integrator must call), test numbers, known limits.`,
  { label: 'sampler-fx', phase: 'Build', effort: 'high' })
return { out }
