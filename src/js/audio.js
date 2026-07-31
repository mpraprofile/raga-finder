// Web Audio tone playback for the swara keyboard.
// See specs/02-swara-keyboard-finder.md "Audio" for the frequency formula
// and why SA_HZ isn't user-adjustable here (that's the shruti box's job).

const SA_HZ = 220; // ~A3, a comfortable low Sa reference

let ctx = null;
function getContext() {
  if (!ctx) {
    // Called from a click handler, so we're inside a user gesture - the only
    // moment iOS lets a context leave the suspended state.
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    claimPlaybackSession();
    primeForIOS(ctx);
  }
  return ctx;
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
  if (audioCtx.state === "running") {
    scheduleTone(audioCtx, degree);
    return;
  }

  // Suspended - the first tap of the session, or iOS having interrupted us
  // while the app was backgrounded or a call came in. resume() is async, and
  // notes scheduled against a still-suspended clock get dropped on iOS, so
  // wait for it. resume() itself is called synchronously inside the click,
  // which is what keeps the gesture valid.
  // Promise.resolve wrapper: old WebKit's resume() returns undefined.
  Promise.resolve(audioCtx.resume())
    .then(() => scheduleTone(audioCtx, degree))
    .catch(() => {});
}

function scheduleTone(audioCtx, degree) {
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
