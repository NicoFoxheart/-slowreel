export const meta = {
  name: 'ambient-studio-lib',
  description: "Tech lead builds the shared plumbing (export WAV/MP3/zip, saving, video, Nico's songs, reverb) for the three studio teams",
  phases: [{ title: 'Plumbing', detail: 'shared/lib with tests' }],
}
const S = '/home/user/nicofoxheart/studio'
phase('Plumbing')
const lib = await agent(`
You are the TECH LEAD for three teams building ambient music studios in the browser for Nico (Nicofoxheart).
Binding brief: ${S}/shared/BRIEF.md - read it fully first. Tools: Node + Playwright with Chromium (NODE_PATH=$(npm root -g)),
ffmpeg/ffprobe, unzip. No internet except the npm registry. Three teams build in parallel on a 4-core machine and will start
integrating your lib in about an hour: be fast and solid, keep browser tests short.
RESUME RULE: an earlier attempt was cut off about 10 minutes in. Look at what already exists in ${S}/shared/lib/ first and finish it.
Build ${S}/shared/lib/ exactly to the "Shared plumbing" API in the brief: export.js, storage.js, songs.js, reverb.js, README.md, plus
tests in ${S}/shared/lib/tests/ that run in Playwright Chromium. Prove with numbers and tools:
- encodeWav writes valid 24-bit stereo WAV (ffprobe); encodeMp3 (lamejs: locally ${S}/shared/vendor/lame.min.js, in production the
  pinned cdnjs URL https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.min.js loaded with a script tag on first use) gives a
  valid 320 kbps MP3 (ffprobe) without freezing the page (chunked);
- makeZip makes a zip that \`unzip -t\` accepts holding both files; saveFile works with the mock viewer (copy the MOCK from
  shared/qa.cjs) and with no viewer (anchor fallback), and reports declined / rejected_extension properly;
- renderOffline, trimTail and measure give correct numbers on known signals; recordVideo produces a playable webm or mp4 in
  Chromium (ffprobe) from a canvas + an audio node;
- storage works with the mock db + user, with IndexedDB, and in memory; autosave debounces;
- songs.js lists all 9 songs in shared/audio (after-the-storm too: compute its duration and 120-point peaks with ffmpeg the same
  way shared/tracks-data.json was made; titles: "After the Storm", "Ballet of Life", "Hopeful Romantic", "Infinite Love",
  "Nature of Love", "I'll Never Leave You (Nightcore)", "I'll Never Leave You", "I Am With You Always", "Sleepy Rain") and decodes them;
- reverb.js makes good-sounding impulses (no DC, smooth exponential decay, decorrelated stereo).
Plain ES modules, relative imports only, no dependencies besides lamejs, small and documented.
When every test passes, write ${S}/shared/lib/READY (one line: date and "all tests pass") - the teams wait for that file - and append
2-4 lines to ${S}/BUILD-LOG.md. Reply with the API summary, test results with numbers, and known limits.`,
  { label: 'tech-lead', phase: 'Plumbing', effort: 'high' })
return { lib }
