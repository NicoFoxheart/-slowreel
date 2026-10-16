export const meta = {
  name: 'slowreel-heart-visualizer-pc-phone',
  description: "Add a 3D audio-reactive fox-ear heart visualizer to Slowreel that exports music videos with the audio (9:16, 16:9, 1:1) on PC, plus a light phone video maker",
  phases: [{ title: 'Build', detail: 'one visual engineer builds the 3D heart + video export and self-tests' }],
}
const S = '/home/user/nicofoxheart/studio'
const T = `${S}/teams/tape`
phase('Build')
const out = await agent(`
You are the VISUAL ENGINEER (3D + video) on the Slowreel team. Slowreel is Nico's ambient tape studio in the browser (${T}), published
privately as a claude.ai artifact; PC ONLY (phones see a "made for your computer" screen). An earlier attempt of this exact task was stopped after a few minutes to add the phone maker: check for partial files first and keep the good ones.
Read ${S}/shared/BRIEF.md, ${T}/README.md,
${T}/DESIGN.md, ${T}/SOUND-API.md and the tail of ${S}/BUILD-LOG.md first.

Nico (Nicofoxheart, anime-ambient producer) wants: "3D visuals for music in Slowreel so I can save my music as a visual and the audio
itself". He chose ONE style, his signature: the glowing 3D heart with fox ears from his first music page. Reference implementation:
/home/user/nicofoxheart/index.html (read its <style> tokens and the "3D heart" section: heart shape, fox ears on the lobes, dusk-violet sky,
sakura/kitsune colors, slow rotation, beat pulse). Rebuild that heart in three.js 0.160.0 (import map from
https://cdn.jsdelivr.net/npm/three@0.160.0/ - the QA tool maps it to /home/user/nicofoxheart/redesign/shared/three@0.160.0) as a beautiful
music-video scene: soft bloom-like glow (cheap: sprites or a single post pass), drifting petals or sparks, a calm camera, the heart pulsing
with the low end, ears twitching on accents, color breathing with the mids/highs. It must look like a finished anime-ambient music video,
not a tech demo. Formats Nico chose: 9:16 1080x1920 (TikTok/Reels/Shorts), 16:9 1920x1080 (YouTube), 1:1 1080x1080 (Instagram).

Build (NEW files where possible, small edits to existing UI files to add the entry points; do not touch the round-2 files synths.js, arp.js,
drums.js, sampler.js, fx2.js, steps.js, automation.js, sampler-ui.js, demo-night-garage.json - they are on hold):
1. A "Visual" panel/window in Slowreel's design language: live preview of the heart, format picker (9:16 / 16:9 / 1:1), optional title and
   artist text ("Nicofoxheart" default, song name from the project or song), 2-3 color moods, intensity. Opens from the transport/export
   area and from each song in "Nico's Tapes" (so any of his 9 songs can become a video too, audio unchanged).
2. Video export with the audio inside: render the audio first (engine.render(project) for projects, decode the mp3 for his songs - never
   alter his songs), compute per-frame audio features from that buffer (deterministic), then render frames offscreen at the target size and
   encode with WebCodecs (VideoEncoder H.264 + AudioEncoder AAC into MP4 via mp4-muxer from cdn.jsdelivr.net/npm with an exact pinned
   version at least two weeks old; vendor a local copy into ${S}/shared/vendor and add its jsdelivr mapping to ${S}/shared/qa.cjs). If H.264 or
   AAC is not supported, fall back to VP9 + Opus WebM (and say so in the UI). If WebCodecs is missing, fall back to lib/export.js
   recordVideo (real time). Progress bar, cancel, frame-perfect 30 fps, then save with lib/export.js saveFile (.mp4 or .webm are allowed by
   the downloads capability). Also keep the existing audio-only export.
3. Performance: the preview renders only while the panel is open (30 fps cap, DPR <= 1.5) and must not cause audio stutter (run the probe:
   /tmp/claude-0/-home-user/63fae2cc-feee-5482-a580-df58aa871eb9/scratchpad/diag/stutter.cjs; keep play() < 50 ms). Export does not play audio.
5. PHONE VIDEO MAKER (Nico asked for it; the studio itself stays PC only): on phones, the "made for your computer" screen gets a
   "Make a music video" button that opens a simple phone page: pick one of his 9 songs OR import an audio file from the phone (file input;
   the audio stays unchanged, never stored anywhere but the phone), title text, mood, 9:16 (default) or 1:1, a light preview (DPR 1, fewer
   particles), and export. Phone defaults: 720x1280 (option 1080x1920), lighter scene, the same deterministic offline frame renderer and
   WebCodecs path (Android Chrome usually has hardware H.264), progress bar with an estimate, keep the screen awake with the Wake Lock API
   if granted, warn that it takes a few minutes and to keep the page open. No AudioContext playback needed except for the preview; never
   start the studio engine on phones. Test it with Playwright mobile emulation (390x844, isMobile, hasTouch) and CDP CPU throttling 4x:
   the page must stay responsive (no long task > 200 ms while rendering; render in chunks) and produce a valid file.
4. Extend window.__studio with exportVideo({format, seconds, source}) -> {bytes, mime, width, height, frames, hasAudio} for tests.
Tests: headless Chromium here has no H.264 encoder, so verify the VP9/WebM path end to end (ffprobe: video stream at the right size and fps,
audio stream present, duration correct; extract 3 frames with ffmpeg and LOOK at them with Read to judge the visual), and verify the H.264
path with VideoEncoder.isConfigSupported plus careful code. Run the QA tool (cd ${S} && NODE_PATH=$(npm root -g) node shared/qa.cjs
teams/tape) and the team tests; 0 console errors. Lean budget: Nico watches his usage, so be efficient and do not gold-plate - but the
heart must be gorgeous. Append 2-4 lines to ${S}/BUILD-LOG.md.
Reply with: what you built (files), how to use it, test numbers (ffprobe output summary), the 3 frame PNG paths, the list of files the
published page needs (relative to teams/tape, excluding tests/ qa/ shots/ and the on-hold round-2 files), and known limits.`,
  { label: 'visual-engineer', phase: 'Build', effort: 'high' })
return { out }
