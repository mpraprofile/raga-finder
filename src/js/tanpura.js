// The tanpura (specs/09 Phase 2): four plucked strings with a jawari buzz,
// plucked in the instrument's uneven cycle.
//
// One file, two lives. Loaded with audioWorklet.addModule() it registers the
// processor at the bottom and runs on the audio thread. Imported as an ordinary
// module (browsers without AudioWorklet), it only exports the classes, and
// audio.js renders one cycle into a looping buffer on the main thread. The DSP
// is plain JS for exactly that reason - nothing in it knows which life it is in.
//
// Techniques, all standard: a Karplus-Strong string (a noise burst circulating
// in a delay line through a loss filter) with a first-order allpass for the
// fractional part of the period, so every string is in tune rather than rounded
// to a whole sample; the pluck position as a comb on the burst; and the jawari
// as a rectified copy of the string that blooms in just after each pluck, the
// way the buzz of a curved bridge arrives a moment after the string is struck,
// heard through a resonant band that sweeps down the string's overtones as the
// note rings - the "swish" (listening round 4, rated above everything else).

class PluckedString {
  constructor(sampleRate, lowestHz = 30) {
    this.fs = sampleRate;
    let size = 1;
    while (size < sampleRate / lowestHz + 8) size <<= 1;
    this.buf = new Float32Array(size);
    this.mask = size - 1;
    this.w = 0;
    this.n = 100; // integer part of the loop delay
    this.c = 0; // allpass coefficient, the fractional part
    this.s = 0.5; // loss filter blend: 0 = no smoothing, 0.5 = two-point average (darkest)
    this.g = 0.999; // loss per pass, from the decay time
    this.prev = 0;
    this.apX = 0;
    this.apY = 0;
    this.level = 0;
    this.roll = null; // a soft pluck still being fed in (see pluck)
  }

  // `brightness` 0..1 maps onto the loss filter (1 = brightest). The decay
  // `t60` is the time to fall 60 dB.
  tune(hz, t60, brightness) {
    this.s = 0.5 * (1 - Math.min(1, Math.max(0, brightness)));
    const period = this.fs / hz;
    this.period = period;
    // Loop delay = n + s (the loss filter) + d (the allpass). Keeping d in
    // [0.5, 1.5) keeps the allpass well-behaved.
    this.n = Math.max(2, Math.floor(period - this.s - 0.5));
    const d = period - this.s - this.n;
    this.c = (1 - d) / (1 + d);
    const w = (2 * Math.PI * hz) / this.fs;
    const filterGain = Math.sqrt((1 - this.s) ** 2 + this.s ** 2 + 2 * this.s * (1 - this.s) * Math.cos(w));
    this.g = Math.min(0.99999, Math.pow(10, -3 / (hz * t60)) / filterGain);
  }

  // Lays a fresh burst over what is already in the loop. `keep` is how much of
  // the old vibration survives (a real re-pluck does not silence the string
  // completely); `softness` darkens the burst; `position` is where along the
  // string it is plucked, as a fraction. `attackS` > 0 rolls the pluck in: the
  // burst is fed into the loop a little at a time over that long, on a
  // raised-cosine swell, instead of all at once - a finger pad rolling over the
  // string rather than snapping it. The instant start is what made Soft still
  // sound "plucked" (user, 2026-11-09).
  pluck({ amp, softness = 0.4, position = 0.18, keep = 0.3, attackS = 0, random }) {
    const n = this.n;
    const burst = new Float32Array(n);
    let low = 0;
    for (let i = 0; i < n; i++) {
      low += (1 - softness) * (random() * 2 - 1 - low);
      burst[i] = low;
    }
    const k = Math.max(1, Math.round(position * n));
    for (let i = n - 1; i >= k; i--) burst[i] -= burst[i - k];
    let mean = 0;
    for (let i = 0; i < n; i++) mean += burst[i];
    mean /= n;
    let peak = 1e-9;
    for (let i = 0; i < n; i++) {
      burst[i] -= mean;
      peak = Math.max(peak, Math.abs(burst[i]));
    }
    const scale = amp / peak;
    const rollLength = Math.round(attackS * this.fs);
    if (rollLength > n) {
      for (let i = 0; i < n; i++) {
        const at = (this.w - n + i) & this.mask;
        this.buf[at] *= keep;
        burst[i] *= scale;
      }
      // Each burst sample is added about rollLength / period times; weighting
      // each addition by period / rollLength (times a swell averaging 1) feeds in the
      // same total as an instant pluck.
      // Fed in step with the string's exact period (not the whole-sample n),
      // or the passes drift apart and cancel - badly at high pitch.
      this.roll = { burst, k: 0, length: rollLength, weight: this.period / rollLength, period: this.period };
    } else {
      for (let i = 0; i < n; i++) {
        const at = (this.w - n + i) & this.mask;
        this.buf[at] = this.buf[at] * keep + burst[i] * scale;
      }
    }
    this.level = Math.max(this.level, amp);
  }

  tick() {
    const x = this.buf[(this.w - this.n) & this.mask];
    const lp = this.g * ((1 - this.s) * x + this.s * this.prev);
    this.prev = x;
    const y = this.c * lp + this.apX - this.c * this.apY;
    this.apX = lp;
    this.apY = y;
    let fed = y;
    const roll = this.roll;
    if (roll) {
      const swell = 1 - Math.cos((2 * Math.PI * roll.k) / roll.length);
      const n = roll.burst.length;
      const at = ((roll.k % roll.period) / roll.period) * n;
      const i0 = Math.floor(at);
      const frac = at - i0;
      const sample = roll.burst[i0 % n] * (1 - frac) + roll.burst[(i0 + 1) % n] * frac;
      fed += sample * swell * roll.weight;
      if (++roll.k >= roll.length) this.roll = null;
    }
    this.buf[this.w] = fed;
    this.w = (this.w + 1) & this.mask;
    const size = Math.abs(x);
    this.level = size > this.level ? size : this.level * 0.99997;
    return x;
  }

  get silent() {
    return this.level < 1e-5;
  }
}

// The strings against the tanpura's Sa: the first string (Pa below, Ma
// below, or Ni below), two at Sa, and the low Sa an octave down - in just
// intervals, which is how a tanpura is tuned, by ear, against itself.
// Two nishadas (user, 2026-11-08): `ni` is kakali (15/8 below the octave),
// kept as the plain name because it was the only Ni before; `ni-kaisiki` is
// kaisiki (16/9 below the octave).
const FIRST_STRING = { pa: 3 / 4, ma: 2 / 3, "ni-kaisiki": 8 / 9, ni: 15 / 16 };
const SA_STRINGS = [1, 1, 1 / 2];
// The cycle: first string, Sa, Sa, then the low Sa, which is given the longer
// gap before the round begins again. Times in seconds within one round.
const PLUCK_AT = [0, 1.2, 2.25, 3.3];
export const ROUND_S = 4.8;
const JITTER_S = 0.03; // a player's hand, not a sequencer
const STRENGTH = [0.8, 0.7, 0.7, 0.9];
// The low Sa sits well back. At 1.2 (the first refinement) its 65 Hz tone
// stood out - "I can hear the sine"; at 0.9 it still "clashes notably with the
// next note", and on the listening page the version without it rated best
// (user, 2026-11-07). Measured, the strings are in tune to 0.1 cent with no
// beating: the clash is two heavy fundamentals a fifth apart (65 and 98 Hz) in
// a register where the ear cannot hold them apart, so the low string is kept
// mostly as overtones. The spread is narrow: width comes from the reverb.
const WEIGHT = [0.84, 0.84, 0.84, 0.25]; // 0.25: round 2 of the listening page (0.45 rated below it)
// The buzz has its own weight: the low Sa's body stays down (its 65 Hz is what
// clashed), but its swish is heard as fully as the others' - the user wanted
// the swish in the low Sa too (2026-11-09), and on a real tanpura the low
// string buzzes most.
const BUZZ_WEIGHT = [0.84, 0.84, 0.84, 0.84];
// The swish (listening round 4, card C, 2026-11-09): each string's buzz is
// heard through a resonant band (Q 4) whose centre glides from the string's
// 12th harmonic down to its 3rd after every pluck (time constant 1 s). Being
// tied to the string's own pitch, the low Sa swishes as much as the others.
// Rated 4 against 3 for the rising sweep and for half strength.
const SWISH = { from: 12, to: 3, tauS: 1.0, q: 4, gain: 1.5 };
const SWISH_UPDATE = 32; // samples between coefficient updates
// The swish amount is the user's (2026-11-09): a multiplier k on the buzz, 1 =
// round 4's card C. More buzz is more loudness, so the strings are scaled to
// hold their level: measured (A-weighted, through the drone's filters) the buzz
// carries ~2x the body's power at k = 1 and grows as k^1.6.
const SWISH_POWER = { ratio: 2.0, exponent: 1.6 };
function swishNorm(k) {
  return Math.sqrt((1 + SWISH_POWER.ratio) / (1 + SWISH_POWER.ratio * Math.pow(Math.max(0, k), SWISH_POWER.exponent)));
}
const PAN = [-0.12, -0.04, 0.04, 0.12];
// The two styles. Soft is the default and the gentlest; Plucked is what Soft
// was until 2026-11-09 - the user missed it, and the brighter Plucked before it
// was "too harsh; nobody plays tanpura plucking like that". `loop` is the
// string's own brightness; the drone's tone filter in audio.js does the rest.
const STYLES = {
  // Soft made much softer (user, 2026-11-09: "still a lot plucked"): the pluck
  // rolled in over 0.18 s, a darker burst, a longer ring, and a jawari that
  // swells in over 0.8 s and lingers ~7 s, so each pluck renews a continuous
  // sound. Measured against Plucked: the jump in a pluck's first 20 ms 3.3 dB
  // vs 7.3 (was 5.0), the drone's pulsing 6.3 dB vs 13.9 (was 9.4); same
  // A-weighted level as before.
  soft: { amp: 0.6, softness: 0.96, keep: 0.85, t60: 18, loop: 0.35, attackS: 0.18, bloomInS: 0.8, bloomOutS: 7 },
  // The old Soft: a dark burst laid over the string that is still ringing, so
  // a pluck renews the sound instead of striking it.
  pluck: { amp: 0.6, softness: 0.92, keep: 0.85, t60: 12, loop: 0.35, attackS: 0, bloomInS: 0.3, bloomOutS: 3.2 },
};
const styleOf = (name) => STYLES[name === "hum" ? "soft" : name] ?? STYLES.soft;

// Deterministic noise (xorshift), so the main-thread render of the fallback
// loop is reproducible and two strings never share a burst.
function makeRandom(seed) {
  let x = seed >>> 0 || 0x9e3779b9;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}

export class Tanpura {
  constructor(sampleRate) {
    this.fs = sampleRate;
    this.strings = [0, 1, 2, 3].map(() => new PluckedString(sampleRate));
    this.random = makeRandom(12345);
    this.sa = 130.81;
    this.first = "pa";
    this.style = "soft";
    this.jawari = 0.55;
    this.swish = 1; // the user's swish amount, a multiplier on the buzz
    this.norm = 1;
    this.lowSa = true; // the low Sa string can be left out altogether (user's option)
    this.on = false;
    this.clock = 0;
    this.roundStart = 0; // sample index where the current round began (unjittered)
    this.nextAt = 0; // sample index of the next pluck
    this.index = 0; // which string plucks next
    this.since = [1e9, 1e9, 1e9, 1e9]; // samples since each string's pluck
    // per string: the swish band-pass (RBJ, constant 0 dB peak) and its state
    this.band = this.strings.map(() => ({ hz: 130, b0: 0, a1: 0, a2: 0, x1: 0, x2: 0, y1: 0, y2: 0 }));
    this.dcX = [0, 0];
    this.dcY = [0, 0];
    this.retune();
  }

  set(message) {
    if (message.sa !== undefined) this.sa = message.sa;
    if (message.first !== undefined) this.first = message.first;
    if (message.style !== undefined) this.style = message.style;
    if (message.jawari !== undefined) this.jawari = message.jawari;
    if (message.swish !== undefined) {
      this.swish = message.swish;
      this.norm = swishNorm(message.swish);
    }
    if (message.lowSa !== undefined) this.lowSa = message.lowSa;
    if (message.sa !== undefined || message.first !== undefined || message.style !== undefined) this.retune();
    if (message.on !== undefined && message.on !== this.on) {
      this.on = message.on;
      if (this.on) {
        this.index = 0;
        this.roundStart = this.clock;
        this.nextAt = this.clock;
      }
    }
  }

  retune() {
    const ratios = [FIRST_STRING[this.first] ?? FIRST_STRING.pa, ...SA_STRINGS];
    const style = styleOf(this.style);
    this.strings.forEach((string, i) => {
      const hz = this.sa * ratios[i];
      // Low strings ring longer.
      const t60 = style.t60 * Math.min(1.3, Math.sqrt(130 / hz));
      string.tune(hz, t60, style.loop);
      this.band[i].hz = hz;
    });
  }

  pluckNext() {
    const i = this.index;
    const style = styleOf(this.style);
    if (i !== 3 || this.lowSa) this.strings[i].pluck({
      amp: STRENGTH[i] * style.amp,
      softness: style.softness,
      position: 0.2,
      keep: style.keep,
      attackS: style.attackS ?? 0,
      random: this.random,
    });
    this.since[i] = 0;
    this.index = (i + 1) % 4;
    // The grid stays exact; only each pluck is nudged, so the cycle never drifts.
    if (this.index === 0) this.roundStart += ROUND_S * this.fs;
    this.planned = this.roundStart + PLUCK_AT[this.index] * this.fs;
    this.nextAt = this.planned + (this.random() * 2 - 1) * JITTER_S * this.fs;
  }

  get silent() {
    return !this.on && this.strings.every((s) => s.silent);
  }

  // Fills `left` and `right` (Float32Arrays of one block).
  process(left, right) {
    // The buzz arrives over a moment and lingers (per style): a slow bloom is
    // what makes it a shimmer rather than a rattle.
    const style = styleOf(this.style);
    const bloomIn = 1 / ((style.bloomInS ?? 0.3) * this.fs);
    const bloomOut = 1 / ((style.bloomOutS ?? 3.2) * this.fs);
    const sweep = 1 / (SWISH.tauS * this.fs);
    for (let n = 0; n < left.length; n++) {
      if (this.on && this.clock >= this.nextAt) this.pluckNext();
      let l = 0;
      let r = 0;
      for (let i = 0; i < 4; i++) {
        const string = this.strings[i];
        if (string.silent && this.since[i] > this.fs) continue;
        const x = string.tick();
        // The jawari: the half of the swing that presses into the bridge,
        // through the swish band, faded in after the pluck and out with time.
        const pressed = Math.max(0, x * 3 - 0.02);
        const t = this.since[i]++;
        const b = this.band[i];
        if (t % SWISH_UPDATE === 0) {
          const harmonic = SWISH.to + (SWISH.from - SWISH.to) * Math.exp(-t * sweep);
          const w0 = (2 * Math.PI * Math.min(this.fs * 0.45, harmonic * b.hz)) / this.fs;
          const alpha = Math.sin(w0) / (2 * SWISH.q);
          const a0 = 1 + alpha;
          b.b0 = alpha / a0;
          b.a1 = (-2 * Math.cos(w0)) / a0;
          b.a2 = (1 - alpha) / a0;
        }
        const buzz = b.b0 * (pressed - b.x2) - b.a1 * b.y1 - b.a2 * b.y2;
        b.x2 = b.x1;
        b.x1 = pressed;
        b.y2 = b.y1;
        b.y1 = buzz;
        const bloom = (1 - Math.exp(-t * bloomIn)) * Math.exp(-t * bloomOut);
        const voice = x * WEIGHT[i] + this.jawari * this.swish * 2.5 * bloom * SWISH.gain * buzz * BUZZ_WEIGHT[i];
        l += voice * (0.5 - PAN[i] * 0.5);
        r += voice * (0.5 + PAN[i] * 0.5);
      }
      // DC blocker per side - the rectifier leaves an offset.
      const outL = l - this.dcX[0] + 0.995 * this.dcY[0];
      this.dcX[0] = l;
      this.dcY[0] = outL;
      const outR = r - this.dcX[1] + 0.995 * this.dcY[1];
      this.dcX[1] = r;
      this.dcY[1] = outR;
      left[n] = outL * 0.5 * this.norm;
      right[n] = outR * 0.5 * this.norm;
      this.clock++;
    }
  }
}

// The audio-thread life. AudioWorkletProcessor only exists in that scope, so
// the class is defined inside the check, and a main-thread import of this file
// never touches it.
if (typeof registerProcessor === "function") {
  class TanpuraProcessor extends AudioWorkletProcessor {
    constructor() {
      super();
      this.tanpura = new Tanpura(sampleRate);
      this.port.onmessage = (event) => this.tanpura.set(event.data);
    }

    process(_inputs, outputs) {
      const [left, right] = outputs[0];
      if (this.tanpura.silent) {
        left.fill(0);
        right?.fill(0);
        return true;
      }
      this.tanpura.process(left, right ?? new Float32Array(left.length));
      return true;
    }
  }
  registerProcessor("swaraga-tanpura", TanpuraProcessor);
}
