// Web Audio tone playback for the swara keyboard.
// See specs/02-swara-keyboard-finder.md "Audio" for the frequency formula
// and why SA_HZ isn't user-adjustable here (that's the shruti box's job).

const SA_HZ = 220; // ~A3, a comfortable low Sa reference

let ctx = null;
function getContext() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  return ctx;
}

let muted = false;
export function setMuted(value) {
  muted = value;
}
export function isMuted() {
  return muted;
}

export function frequencyForDegree(degree) {
  return SA_HZ * Math.pow(2, degree / 12);
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

export function playPianoTone(degree) {
  if (muted) return;

  const audioCtx = getContext();
  if (audioCtx.state === "suspended") audioCtx.resume();

  const freq = frequencyForDegree(degree);
  const now = audioCtx.currentTime;
  const duration = 1.4;

  const master = audioCtx.createGain();
  master.connect(audioCtx.destination);

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
  }
}

// A short, deliberately unmusical "blocked" sound - two quick low-pitched
// square-wave blips, clearly distinct from the piano tone - for actions
// that get refused rather than performed (currently: Piano's per-note
// order-mode repeat cap, see app.js's addOrToggle). Fixed pitch, not
// derived from SA_HZ/a degree, since it isn't representing a note.
const BLOCKER_HZ = 180;
const BLOCKER_BLIP_DURATION = 0.07;
const BLOCKER_BLIP_GAP = 0.09;

export function playBlockerSound() {
  if (muted) return;

  const audioCtx = getContext();
  if (audioCtx.state === "suspended") audioCtx.resume();

  const now = audioCtx.currentTime;
  [0, 1].forEach((i) => {
    const start = now + i * BLOCKER_BLIP_GAP;
    const osc = audioCtx.createOscillator();
    osc.type = "square";
    osc.frequency.value = BLOCKER_HZ;

    const env = audioCtx.createGain();
    env.gain.setValueAtTime(0.15, start);
    env.gain.exponentialRampToValueAtTime(0.0001, start + BLOCKER_BLIP_DURATION);

    osc.connect(env);
    env.connect(audioCtx.destination);
    osc.start(start);
    osc.stop(start + BLOCKER_BLIP_DURATION + 0.02);
  });
}
