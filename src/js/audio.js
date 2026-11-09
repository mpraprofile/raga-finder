// Web Audio for the whole app: the tone, the graph every sound goes through
// (voice bus, reverb, master - specs/09 Phase 1) and the sound settings.
// See specs/02-swara-keyboard-finder.md "Audio" for the frequency formula.

import { ROUND_S, Tanpura } from "./tanpura.js";

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
const SOUND_DEFAULTS = {
  reverbMix: 0.28,
  reverbDecay: 3.2,
  // The tanpura (Phase 2). Whether it is on is not a setting - a page cannot
  // start sound before a tap, and a drone that came back by itself would be a
  // surprise - but how it is tuned and how loud it sits are.
  droneFirst: "pa", // pa | ma | ni-kaisiki | ni (kakali)
  droneLowSa: true, // the low Sa string; off leaves Pa/Ma/Ni, Sa, Sa (user, 2026-11-08)
  droneOctave: 0, // 0..+2 octaves above the usual tanpura Sa (an octave under the melody's); -1/-2 "sound really bad" (user, 2026-11-09)
  droneSwish: 1, // the swish amount, 0 (none) to 2; 1 = round 4's rated card C (user, 2026-11-09)
  // The pad's level, 0 (off) to 1. 0.5 is twice round 3's level (+6 dB): on and
  // off were "not too differentiated" (user, 2026-11-09). Was a switch, dronePad.
  dronePadLevel: 0.5,
  droneStyle: "soft", // soft | pluck ("hum", the first name for soft, still reads as soft)
  droneLevel: 0.5,
  droneUnderPlayback: true, // also sound it while a scale plays, with the button off (default on, user 2026-11-07)
  // Gṛha bhēdam moves Sa; a tanpura normally stays where it was tuned, so the
  // drone keeps the original Sa unless this is chosen (user, 2026-11-07).
  droneFollowsShift: false,
};
let soundSettings = loadSoundSettings();

function loadSoundSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(SOUND_STORAGE_KEY) || "{}");
    // The pad was a switch until 2026-11-09: switched off stays off.
    if (stored.dronePad === false && stored.dronePadLevel === undefined) stored.dronePadLevel = 0;
    delete stored.dronePad;
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
  if (drone) {
    retuneDrone();
    updateDrone();
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
  if (drone || !muted) updateDrone();
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

// --- The tanpura drone (specs/09 Phase 2) -------------------------------------
//
// One GainNode into voiceBus, so the drone shares the room and the limiter with
// everything else. Behind it, the tanpura.js worklet - or, where AudioWorklet is
// missing (Safari before 14.5), one round of the same tanpura rendered on the
// main thread and looped. Switching it never clicks: the gain fades in and out,
// and the strings are only told to stop once the fade has finished.
//
// It sounds while the Drone button is on, or - with "under playback" chosen in
// the settings - while any scale is playing. Mute silences it either way.
// Gain at level 1. Halved from 2 on round 2 of the listening page, where the
// version 6 dB quieter rated best - "in the background, soft" (user,
// 2026-11-08). At the default 0.5 the drone sits ~24 dB under a melody phrase.
const DRONE_TRIM = 0.66; // round 4: card C played the drone 3.1 dB under A (-> 0.7); the low Sa's swish at full buzz weight adds 0.5 dB (offline render through the tone filter and floor, Pa and Ma alike) (-> 0.66), so it sits where it was rated
const DRONE_FADE_IN_S = 0.4;
const DRONE_FADE_OUT_S = 1.8;
// Under playback the tanpura lays the ground before the raga is painted on it,
// and stays a moment after the last note (user, 2026-11-07): the first phrase
// waits DRONE_LEAD_IN_S for the drone's first plucks, and the drone holds
// UNDER_PLAYBACK_TAIL_MS past the end before its fade begins.
const DRONE_LEAD_IN_S = 1.6;
const UNDER_PLAYBACK_TAIL_MS = 1500;
let drone = null;
let droneWanted = false;
let droneSa = frequencyAt(0) / 2; // the tanpura's Sa sits an octave below the melody's
let activeSequences = 0;
let droneOffTimer = null;
let droneHeard = false; // sounding, or still fading out - either way already in the ear

export function setDroneOn(on) {
  droneWanted = on;
  if (on) getContext(); // inside the tap: the gesture that lets audio start
  updateDrone();
}

export function isDroneOn() {
  return droneWanted;
}

// Where Sa sits, in the same semitones-from-middle-C that frequencyAt takes:
// app.js passes the Key, plus the gṛha bhēdam shift when the finder is showing.
export function setDroneTonic(semitonesFromC4) {
  const sa = frequencyAt(semitonesFromC4) / 2;
  if (Math.abs(sa - droneSa) < 1e-6) return;
  droneSa = sa;
  if (drone) retuneDrone();
}

// Called by the scheduler around every sequence, for "under playback".
// Returns how long the first note should wait: the lead-in when this phrase
// is what brings the drone in, nothing when the drone is already in the ear.
export function sequenceStarted() {
  const alreadyHeard = droneHeard;
  activeSequences++;
  if (soundSettings.droneUnderPlayback) getContext(); // still inside the Play tap
  updateDrone();
  return droneShouldSound() && !alreadyHeard ? DRONE_LEAD_IN_S : 0;
}

export function sequenceEnded() {
  activeSequences = Math.max(0, activeSequences - 1);
  setTimeout(updateDrone, UNDER_PLAYBACK_TAIL_MS);
}

function droneShouldSound() {
  return !muted && (droneWanted || (soundSettings.droneUnderPlayback && activeSequences > 0));
}

function droneParams() {
  return { sa: droneHz(), first: soundSettings.droneFirst, style: soundSettings.droneStyle, lowSa: soundSettings.droneLowSa, swish: soundSettings.droneSwish };
}

// The tanpura's Sa with the user's octave applied.
function droneHz() {
  return droneSa * Math.pow(2, droneOctave());
}

function droneOctave() {
  return Math.max(0, Math.min(2, Math.round(soundSettings.droneOctave) || 0));
}

function updateDrone() {
  const sounding = droneShouldSound();
  if (!sounding && !drone) return;
  if (sounding && !ctx) return; // no tap yet; the next setDroneOn/sequence will get here
  if (!drone) drone = buildDrone(ctx);
  const d = drone;
  const now = ctx.currentTime;
  const gain = d.output.gain;
  gain.cancelScheduledValues(now);
  gain.setValueAtTime(gain.value, now);
  clearTimeout(droneOffTimer);
  if (sounding) {
    droneHeard = true;
    d.ready.then(() => {
      if (!droneShouldSound()) return;
      startDroneSource(d);
      const at = ctx.currentTime;
      gain.cancelScheduledValues(at);
      gain.setValueAtTime(gain.value, at);
      gain.linearRampToValueAtTime(soundSettings.droneLevel * DRONE_TRIM * droneOctaveGain(), at + DRONE_FADE_IN_S);
    });
  } else {
    gain.linearRampToValueAtTime(0, now + DRONE_FADE_OUT_S);
    droneOffTimer = setTimeout(() => {
      if (!droneShouldSound()) stopDroneSource(d);
    }, DRONE_FADE_OUT_S * 1000 + 50);
  }
}

// After the strings, a gentle low-pass: the jawari is a rectified signal, and
// left open its fizz reaches the top of the spectrum - the "harsh" the first
// version was (2026-11-07). Soft keeps only the warm shimmer below ~1.1 kHz;
// Plucked lets a little more edge through. And the drone gets its own reverb
// send, on top of the voice bus's, so it sits in the room behind the melody.
const DRONE_TONE_HZ = { soft: 1100, pluck: 1100 }; // Plucked is the old Soft, filter and all (2026-11-09); 1,800 was the harsh Plucked
const DRONE_TONE_Q = 0.4;
const DRONE_SEND = 2;
const DRONE_FLOOR_HZ = 100; // 70 left the low Sa's 65 Hz fundamental too present (user, 2026-11-07)

// The tone filter moves with the octave: round 5 rated the octave-up drone with
// its tone filter moved up (3) above the same drone with it left alone (2) -
// each string keeps the overtones it has at the usual octave.
function droneToneHz() {
  return Math.min(8000, (DRONE_TONE_HZ[soundSettings.droneStyle] ?? DRONE_TONE_HZ.soft) * Math.pow(2, droneOctave()));
}

// Each octave played as loud as the usual one, by A-weighted level (measured
// offline through the drone's filters, 2026-11-09): high strings die away
// faster, so they are lifted - Soft more than Plucked (re-measured with the
// softer Soft and its rolled pluck).
const DRONE_OCTAVE_GAIN_DB = {
  soft: { 0: 0, 1: 2.0, 2: 6.5 },
  pluck: { 0: 0, 1: 1.8, 2: 5.2 }, // the old Soft's, measured before the Soft rework
};

function droneOctaveGain() {
  const table = DRONE_OCTAVE_GAIN_DB[soundSettings.droneStyle] ?? DRONE_OCTAVE_GAIN_DB.soft;
  return Math.pow(10, table[droneOctave()] / 20);
}

function droneFloorHz() {
  return DRONE_FLOOR_HZ;
}

function buildDrone(audioCtx) {
  const output = audioCtx.createGain();
  output.gain.value = 0;
  const tone = audioCtx.createBiquadFilter();
  tone.type = "lowpass";
  tone.Q.value = DRONE_TONE_Q;
  tone.frequency.value = droneToneHz();
  const send = audioCtx.createGain();
  send.gain.value = DRONE_SEND;
  // And a gentle high-pass under it: the low Sa is 65 Hz at Key C, below what
  // phone and laptop speakers reproduce cleanly; the ear hears its pitch from
  // the harmonics either way.
  const floor = audioCtx.createBiquadFilter();
  floor.type = "highpass";
  floor.frequency.value = droneFloorHz();
  floor.Q.value = 0.6;
  output.connect(tone).connect(floor);
  const pad = audioCtx.createGain();
  pad.gain.value = 0;
  pad.connect(output);
  floor.connect(graph.voiceBus);
  floor.connect(send).connect(graph.reverb);
  const d = { output, tone, floor, pad, padVoices: null, kind: null, node: null, source: null, buffer: null, playing: false };
  const worklet = audioCtx.audioWorklet
    ? audioCtx.audioWorklet.addModule(new URL("./tanpura.js", import.meta.url)).then(() => {
        d.node = new AudioWorkletNode(audioCtx, "swaraga-tanpura", { numberOfInputs: 0, outputChannelCount: [2] });
        d.node.connect(output);
        d.node.port.postMessage(droneParams());
        d.kind = "worklet";
      })
    : Promise.reject(new Error("no AudioWorklet"));
  d.ready = worklet.catch(() => {
    d.kind = "loop";
    d.buffer = renderDroneLoop(audioCtx);
  });
  return d;
}

function startDroneSource(d) {
  if (d.playing) return;
  d.playing = true;
  startPad(d);
  if (d.kind === "worklet") {
    d.node.port.postMessage({ ...droneParams(), on: true });
    return;
  }
  d.source = ctx.createBufferSource();
  d.source.buffer = d.buffer;
  d.source.loop = true;
  d.source.connect(d.output);
  d.source.start();
}

function stopDroneSource(d) {
  droneHeard = false;
  if (!d.playing) return;
  d.playing = false;
  stopPad(d);
  if (d.kind === "worklet") {
    d.node.port.postMessage({ on: false }); // the strings ring out, already faded
    return;
  }
  d.source.stop();
  d.source = null;
}

function retuneDrone() {
  const d = drone;
  d.tone.frequency.setTargetAtTime(droneToneHz(), ctx.currentTime, 0.15); // a glide, not a jump
  d.floor.frequency.setTargetAtTime(droneFloorHz(), ctx.currentTime, 0.15);
  retunePad(d);
  if (d.kind === "worklet") {
    d.node.port.postMessage(droneParams());
  } else if (d.kind === "loop") {
    d.buffer = renderDroneLoop(ctx);
    if (d.playing) {
      stopDroneSource(d);
      startDroneSource(d);
    }
  }
}

// The pad (the user's idea, rated best in listening round 3, 2026-11-09): a
// soft power chord on the tanpura's Sa - Sa, the first string's note, upper Sa -
// each two slightly detuned saws and a triangle under a low-pass that breathes
// once a pluck round. It runs on the main thread beside the strings (worklet or
// fallback loop alike) and joins the drone's output stage, so the level slider,
// the tone filter, the floor and the reverb send all apply to it.
// PAD_GAIN is round 3's card C at the app's default level: the same absolute
// level the user rated, about 10 dB under the strings.
const PAD_GAIN = 0.0175;

// The slider's level to a gain: squared for an even feel, x8 so 0.5 is twice
// round 3's level (+6 dB) and the top +18 dB.
function padGain() {
  const v = Math.max(0, Math.min(1, soundSettings.dronePadLevel || 0));
  return PAD_GAIN * 8 * v * v;
}
const PAD_FADE_IN_S = 2.5; // slower than the strings: the stage settles in under them
const PAD_FADE_OUT_S = 0.6;
const PAD_CUTOFF_HZ = 650;
const PAD_BREATH_HZ = 180;
const PAD_UPPER = { pa: 3 / 2, ma: 4 / 3, "ni-kaisiki": 16 / 9, ni: 15 / 8 };
const PAD_LAYERS = [["sawtooth", -7, 0.5], ["sawtooth", 7, 0.5], ["triangle", 0, 0.8]];

function padRatios() {
  return [1, PAD_UPPER[soundSettings.droneFirst] ?? PAD_UPPER.pa, 2];
}

function startPad(d) {
  if (d.padVoices || !d.playing || !(padGain() > 0)) return;
  const now = ctx.currentTime;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q.value = 0.7;
  filter.frequency.value = PAD_CUTOFF_HZ;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 1 / ROUND_S;
  const breath = ctx.createGain();
  breath.gain.value = PAD_BREATH_HZ;
  lfo.connect(breath).connect(filter.frequency);
  const oscs = [];
  padRatios().forEach((ratio, i) => {
    for (const [type, cents, level] of PAD_LAYERS) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = droneHz() * ratio;
      osc.detune.value = cents;
      const g = ctx.createGain();
      g.gain.value = level;
      osc.connect(g).connect(filter);
      oscs.push({ osc, i });
    }
  });
  filter.connect(d.pad);
  [lfo, ...oscs.map((v) => v.osc)].forEach((o) => o.start(now));
  d.padVoices = { oscs, lfo, filter };
  const gain = d.pad.gain;
  gain.cancelScheduledValues(now);
  gain.setValueAtTime(gain.value, now);
  gain.linearRampToValueAtTime(padGain(), now + PAD_FADE_IN_S);
}

function stopPad(d) {
  const voices = d.padVoices;
  if (!voices) return;
  d.padVoices = null;
  const now = ctx.currentTime;
  const gain = d.pad.gain;
  gain.cancelScheduledValues(now);
  gain.setValueAtTime(gain.value, now);
  gain.linearRampToValueAtTime(0, now + PAD_FADE_OUT_S);
  const end = now + PAD_FADE_OUT_S + 0.05;
  voices.lfo.stop(end);
  for (const { osc } of voices.oscs) osc.stop(end);
  setTimeout(() => voices.filter.disconnect(), (PAD_FADE_OUT_S + 0.2) * 1000);
}

function retunePad(d) {
  if (!(padGain() > 0)) return stopPad(d);
  if (!d.padVoices) return startPad(d);
  d.pad.gain.setTargetAtTime(padGain(), ctx.currentTime, 0.1);
  const ratios = padRatios();
  for (const { osc, i } of d.padVoices.oscs) osc.frequency.setTargetAtTime(droneHz() * ratios[i], ctx.currentTime, 0.15);
}

// The fallback: two rounds to let every string reach its steady ring, then one
// round kept as the loop, its first moments crossfaded with what follows its
// last so the seam is continuous.
function renderDroneLoop(audioCtx) {
  const fs = audioCtx.sampleRate;
  const round = Math.round(ROUND_S * fs);
  const fade = Math.round(0.08 * fs);
  const total = 3 * round + fade;
  const left = new Float32Array(total);
  const right = new Float32Array(total);
  const tanpura = new Tanpura(fs);
  tanpura.set({ ...droneParams(), on: true });
  tanpura.process(left, right);
  const buffer = audioCtx.createBuffer(2, round, fs);
  [left, right].forEach((side, ch) => {
    const out = buffer.getChannelData(ch);
    out.set(side.subarray(2 * round, 3 * round));
    for (let i = 0; i < fade; i++) {
      const t = i / fade;
      out[i] = side[2 * round + i] * t + side[3 * round + i] * (1 - t);
    }
  });
  return buffer;
}
