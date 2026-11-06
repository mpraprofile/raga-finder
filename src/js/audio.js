// Web Audio for the whole app: the tone, the graph every sound goes through
// (voice bus, reverb, master - specs/09 Phase 1) and the sound settings.
// See specs/02-swara-keyboard-finder.md "Audio" for the frequency formula.

// Middle C, at concert pitch (A4 = 440). Everything the app sounds is measured
// from here in semitones, and the Key/Shruti setting is nothing more than which
// semitone Sa is put on - see soundingDegree in app.js.
//
// This replaced a hard-wired `SA_HZ = 220`, which is an A, not a C, even though
// the Piano's key layout and labels have always called the home note C. That
// was invisible while nothing named the key out loud; a setting whose default
// reads "C4 / 1" cannot sound an A.
const C4_HZ = 261.63;

let ctx = null;
export function getContext() {
  if (!ctx) {
    // Called from a click handler, so we're inside a user gesture - the only
    // moment iOS lets a context leave the suspended state.
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    claimPlaybackSession();
    primeForIOS(ctx);
    buildGraph(ctx);
  }
  return ctx;
}

// Resolves once the context is running. resume() is called synchronously, so
// a caller inside a click keeps the gesture valid; the Promise.resolve wrapper
// is for old WebKit, whose resume() returns undefined.
export function whenRunning() {
  const audioCtx = getContext();
  if (audioCtx.state === "running") return Promise.resolve(audioCtx);
  return Promise.resolve(audioCtx.resume()).then(() => audioCtx);
}

// --- The graph (specs/09 Phase 1) ---------------------------------------------
//
//   voice ─► voiceBus ─► dry ───────────────────────┐
//                    └─► send ─► reverb ─► wet ─────┤
//                                                   ▼
//                         master ─► limiter ─► trim ─► safety ─► destination
//
// Every sound the app makes enters at voiceBus, so a later voice (the veena,
// Phase 3) and the drone (Phase 2) get the same room for free. `dry` stays at
// 1 whatever the reverb setting is: with the mix at 0 the output is exactly
// the old straight-to-destination tone, which is the regression check.
//
// The limiter is there because notes ring for 1.4 s: at 3x tempo about nine
// overlap, their sum peaked at 1.26 and the output clipped - the clicking and
// crackle heard at speed, present since tempo existed (measured 2026-11-05).
// It only acts above -1 dBFS, which 1x playback never reaches (peak 0.85).
// The Web Audio compressor adds an automatic makeup gain to everything,
// (1 / gain at 0 dB)^0.6 by the spec; `trim` takes it back off so a signal
// under the threshold leaves exactly as loud as it came in.
//
// `safety` catches what the limiter is too slow for. It needs ~2 ms to clamp,
// a note reaches full level in 8 ms, so a dozen free-play notes landing almost
// together (a fast glissando: 1.21 out of the limiter) slipped past it. The
// safety curve is a straight line up to SAFETY_KNEE and bends smoothly
// (tanh) towards full scale above it: an overshoot is rounded, not chopped.
// 1x never reaches the knee, and a straight line read back by linear
// interpolation is exact, so below it this stage changes nothing.
const LIMIT_THRESHOLD_DB = -1;
const LIMIT_RATIO = 20;
const SAFETY_KNEE = 0.9;
const SAFETY_RANGE = 2; // inputs up to ±2 bend; beyond that, full scale
let graph = null;

function safetyCurve() {
  const points = 4097;
  const curve = new Float32Array(points);
  const headroom = 1 - SAFETY_KNEE;
  for (let i = 0; i < points; i++) {
    const x = (i / (points - 1)) * 2 * SAFETY_RANGE - SAFETY_RANGE;
    const size = Math.abs(x);
    const y = size <= SAFETY_KNEE ? size : SAFETY_KNEE + headroom * Math.tanh((size - SAFETY_KNEE) / headroom);
    curve[i] = Math.sign(x) * y;
  }
  return curve;
}

function buildGraph(audioCtx) {
  const limiter = audioCtx.createDynamicsCompressor();
  limiter.threshold.value = LIMIT_THRESHOLD_DB;
  limiter.knee.value = 0;
  limiter.ratio.value = LIMIT_RATIO;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.15;
  const fullScaleDb = LIMIT_THRESHOLD_DB - LIMIT_THRESHOLD_DB / LIMIT_RATIO; // where 0 dB in lands
  const makeup = Math.pow(1 / Math.pow(10, fullScaleDb / 20), 0.6);
  const trim = audioCtx.createGain();
  trim.gain.value = 1 / makeup;
  // A WaveShaper reads its curve over input -1..1, so the signal is scaled
  // into that range first and the curve is drawn over ±SAFETY_RANGE.
  const toCurveRange = audioCtx.createGain();
  toCurveRange.gain.value = 1 / SAFETY_RANGE;
  const safety = audioCtx.createWaveShaper();
  safety.curve = safetyCurve();
  limiter.connect(trim).connect(toCurveRange).connect(safety).connect(audioCtx.destination);
  const master = audioCtx.createGain();
  master.connect(limiter);
  const voiceBus = audioCtx.createGain();
  const dry = audioCtx.createGain();
  voiceBus.connect(dry).connect(master);
  const reverb = audioCtx.createConvolver();
  const wet = audioCtx.createGain();
  voiceBus.connect(reverb).connect(wet).connect(master);
  graph = { master, voiceBus, dry, reverb, wet, decay: null };
  applySoundSettings();
}

// A room, synthesized: stereo noise under an exponential decay, each channel
// its own noise so the tail is wide, and darkened as it fades (a one-pole
// lowpass whose cutoff falls with time) because real rooms lose their highs
// first. Reaches -60 dB at `decay` seconds. A few lines instead of an impulse
// file, which keeps the app offline-small; an algorithmic reverb in a worklet
// can replace it later if the ear asks for more.
function makeImpulse(audioCtx, decay) {
  const rate = audioCtx.sampleRate;
  const length = Math.max(1, Math.floor(rate * decay));
  const buffer = audioCtx.createBuffer(2, length, rate);
  const fall = Math.log(1000) / decay; // amplitude 1 -> 0.001 over `decay`
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let low = 0;
    for (let i = 0; i < length; i++) {
      const t = i / rate;
      const brightness = 0.6 * Math.exp(-t * 2.5) + 0.05; // lowpass coefficient, closing over time
      low += brightness * (Math.random() * 2 - 1 - low);
      data[i] = low * Math.exp(-fall * t);
    }
  }
  return buffer;
}

// --- Sound settings -------------------------------------------------------------
//
// One object for the whole app, saved per device. Storage can be blocked (a
// private window, cleared site data), so every read and write is guarded and
// the defaults alone must sound right. Phase 3's Sound panel is the UI for
// these; until then the defaults are what everyone hears.
const SOUND_STORAGE_KEY = "soundSettings";
const SOUND_DEFAULTS = { reverbMix: 0.28, reverbDecay: 3.2 };
let soundSettings = loadSoundSettings();

function loadSoundSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(SOUND_STORAGE_KEY) || "{}");
    return { ...SOUND_DEFAULTS, ...stored };
  } catch {
    return { ...SOUND_DEFAULTS };
  }
}

export function getSoundSettings() {
  return { ...soundSettings };
}

// Only what differs from the defaults is saved, so retuning a default later
// still reaches everyone who never moved that control.
export function setSoundSettings(changes) {
  soundSettings = { ...soundSettings, ...changes };
  const own = Object.fromEntries(
    Object.entries(soundSettings).filter(([key, value]) => SOUND_DEFAULTS[key] !== value),
  );
  try {
    localStorage.setItem(SOUND_STORAGE_KEY, JSON.stringify(own));
  } catch {
    // Not saved; this session still uses it.
  }
  applySoundSettings();
}

function applySoundSettings() {
  if (!graph) return; // no context yet - buildGraph applies them when there is one
  const { reverbMix, reverbDecay } = soundSettings;
  graph.wet.gain.value = reverbMix;
  if (graph.decay !== reverbDecay) {
    graph.reverb.buffer = makeImpulse(ctx, reverbDecay);
    graph.decay = reverbDecay;
  }
}

// iOS puts a page's Web Audio output in the "ambient" audio session: it is
// silenced by the iPhone's Ring/Silent switch and follows the ringer volume
// rather than the media volume. Android has no such switch, and neither does
// an iPad - which is exactly the split we see. Safari 16.4+ lets a page ask
// for the "playback" session instead, which ignores the switch and uses the
// media volume. Claimed only once the user has asked for a tone, so merely
// opening the app doesn't interrupt whatever they were listening to.
function claimPlaybackSession() {
  try {
    if (navigator.audioSession) navigator.audioSession.type = "playback";
  } catch {
    // Read-only or unsupported: nothing to fall back to, tones still work
    // whenever the ringer is up.
  }
}

// Older WebKit only really unlocks a context once a source node has been
// started on it inside the gesture; a bare resume() isn't always enough.
// One inaudible sample is the cheapest thing that counts.
function primeForIOS(audioCtx) {
  try {
    const source = audioCtx.createBufferSource();
    source.buffer = audioCtx.createBuffer(1, 1, audioCtx.sampleRate);
    source.connect(audioCtx.destination);
    source.start(0);
  } catch {
    // Non-fatal: the real tone below is still scheduled either way.
  }
}

// Write-only from this module's point of view: app.js owns the user-facing
// mute state and pushes it down here, so there is no isMuted() to read it back.
let muted = false;
export function setMuted(value) {
  muted = value;
}

// The one place a number becomes a pitch. Its argument is semitones from
// middle C, *not* a swara degree: by the time a tone is asked for, the Key
// setting and any gṛha bhēdam shift have both been folded in, so what arrives
// here is a physical key on a physical keyboard. Callers get there through
// soundingDegree (app.js), which is the only thing that knows about either
// offset.
export function frequencyAt(semitonesFromC4) {
  return C4_HZ * Math.pow(2, semitonesFromC4 / 12);
}

// Piano-ish struck-string tone: fast attack, quick decay to a lower level,
// then a long natural release tail (the "sustain" - resonance after the key
// is struck, not a held-while-pressed drone, since this fires on a single
// click). A few harmonic partials at decreasing gain stand in for a real
// piano's overtone-rich timbre without needing sampled audio.
const PARTIALS = [
  { mult: 1, gain: 0.6 },
  { mult: 2, gain: 0.25 },
  { mult: 3, gain: 0.12 },
  { mult: 4, gain: 0.06 },
];

export function playPianoTone(semitonesFromC4) {
  if (muted) return;

  const audioCtx = getContext();
  if (audioCtx.state === "running") {
    scheduleTone(audioCtx, semitonesFromC4);
    return;
  }

  // Suspended - the first tap of the session, or iOS having interrupted us
  // while the app was backgrounded or a call came in. resume() is async, and
  // notes scheduled against a still-suspended clock get dropped on iOS, so
  // wait for it. resume() itself is called synchronously inside the click,
  // which is what keeps the gesture valid.
  // Promise.resolve wrapper: old WebKit's resume() returns undefined.
  Promise.resolve(audioCtx.resume())
    .then(() => scheduleTone(audioCtx, semitonesFromC4))
    .catch(() => {});
}

// For the scheduler (scheduler.js): the same tone at an exact AudioContext
// time, laid down ahead of when it sounds. Assumes a running context - the
// scheduler waits for one. Returns a handle whose cancel() silences the note
// if it has not started yet, so a Stop pressed with notes already queued
// inside the look-ahead window does not let them through.
export function playPianoToneAt(semitonesFromC4, when) {
  if (muted) return { cancel() {} };
  return scheduleTone(getContext(), semitonesFromC4, when);
}

function scheduleTone(audioCtx, semitonesFromC4, when = audioCtx.currentTime) {
  const freq = frequencyAt(semitonesFromC4);
  const now = when;
  const duration = 1.4;

  const master = audioCtx.createGain();
  master.connect(graph.voiceBus);
  const oscs = [];

  for (const { mult, gain } of PARTIALS) {
    const osc = audioCtx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq * mult;

    const env = audioCtx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(gain, now + 0.008); // fast attack
    env.gain.exponentialRampToValueAtTime(Math.max(gain * 0.3, 0.0001), now + 0.25); // decay
    env.gain.exponentialRampToValueAtTime(0.0001, now + duration); // release tail

    osc.connect(env);
    env.connect(master);
    osc.start(now);
    osc.stop(now + duration + 0.05);
    oscs.push(osc);
  }

  const voice = { start: now, end: now + duration, master, oscs };
  makeRoomFor(voice);

  return {
    cancel() {
      if (audioCtx.currentTime >= now) return; // already sounding: let it ring out, as before
      master.disconnect();
      oscs.forEach((osc) => osc.stop());
      const at = voices.indexOf(voice);
      if (at !== -1) voices.splice(at, 1); // the cap may already have let it go
    },
  };
}

// The voice cap. Every note rings 1.4 s, so a fast free-play run piles up a
// dozen or more of them, and the sum is what overloaded the output. Past
// MAX_VOICES the oldest note still ringing when a new one starts is faded out
// over VOICE_FADE_S - by then it is buried under the newer ones and its
// absence is not heard, only its weight. 3x playback overlaps about nine, so
// playback never reaches the cap; it is for hands on the keys.
const MAX_VOICES = 14;
const VOICE_FADE_S = 0.03;
const voices = []; // in start order

function makeRoomFor(voice) {
  for (let i = voices.length - 1; i >= 0; i--) {
    if (voices[i].end <= voice.start) voices.splice(i, 1); // finished by the time this one starts
  }
  voices.push(voice);
  voices.sort((a, b) => a.start - b.start); // a scheduled note can arrive ahead of a tap
  while (voices.length > MAX_VOICES) {
    const oldest = voices.shift();
    const at = Math.max(voice.start, oldest.start);
    // A linear ramp from where the gain is, not a jump, or the cut would click.
    oldest.master.gain.setValueAtTime(1, at);
    oldest.master.gain.linearRampToValueAtTime(0, at + VOICE_FADE_S);
    oldest.oscs.forEach((osc) => osc.stop(at + VOICE_FADE_S + 0.01));
  }
}
