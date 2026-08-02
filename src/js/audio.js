// Web Audio tone playback for the swara keyboard.
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

function scheduleTone(audioCtx, semitonesFromC4) {
  const freq = frequencyAt(semitonesFromC4);
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
