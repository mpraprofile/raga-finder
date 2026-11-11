// The veena voice (specs/09 Phase 3): rebuilt from measurements of a real veena.
//
// The first version of this file was a plucked-string model (Karplus-Strong),
// and it was a guitar: such a string loses its upper overtones first, where a
// veena's bridge keeps feeding them (listening rounds 1 and 2, 2026-11-10; the
// string rated 1-2, this method 4). So nothing here models a string. A note is
// a sum of sine waves, one per harmonic, and each follows the level that
// harmonic had in a real note at that moment after the pluck - the table in
// veena-table.js, measured from a public-domain recording by
// scripts/veena_partials.html. Flattening those measured swells and dips into
// steady fades rated 1, so they are kept exactly as measured.
//
// A pitch that was not measured reads the measured notes' spectra by
// *frequency*, not by harmonic number: the instrument's resonances (around
// 1.24 kHz and 470-620 Hz) stay where they are while the string's pitch moves,
// which is what a body does. The two measured notes nearest in pitch speak for
// it, weighted by how near.
//
// A note may carry `bend`, [[seconds, cents], ...] - a gamaka (Phase 4). The
// sines follow it, and the spectrum is re-read at the bent frequencies.
//
// One file, two lives, like tanpura.js: loaded with audioWorklet.addModule() it
// registers the processor at the bottom; imported as an ordinary module it only
// exports the class, which is how it is measured offline. Without AudioWorklet
// the app plays the piano tone instead (audio.js).

const MAX_VOICES = 8;
const MAX_PARTIALS = 60;
const TOP_HZ = 9000; // the measurements stop here
const BLOCK = 64; // samples per control step: levels and pitch are updated this often
const ATTACK_S = 0.004;
const CHOKE_S = 0.06; // the previous note of a phrase, damped as the next is plucked
const STEAL_S = 0.03;
const SILENT = 5e-4; // a voice whose loudest harmonic is 60 dB down is let go

// The table as measured -> what the voice reads. Each note's rows are brought
// to one loudness (the player did not pluck them equally hard), and a tail
// slope is fitted to each harmonic's last measurements, so a note can ring
// past where it was measured; a tail always falls.
function prepare(table) {
  return table.notes
    .map((note) => {
      const at = note.times.indexOf(0.25);
      let power = 0;
      for (const row of note.levelDb) power += Math.pow(10, row[at] / 10);
      const gainDb = -10 * Math.log10(power);
      const rows = note.levelDb.map((row) => row.map((db) => db + gainDb));
      const from = note.times.length - 4;
      const tail = rows.map((row) => {
        const t = note.times.slice(from);
        const y = row.slice(from);
        const mt = t.reduce((a, b) => a + b) / t.length;
        const my = y.reduce((a, b) => a + b) / y.length;
        let num = 0;
        let den = 0;
        for (let i = 0; i < t.length; i++) {
          num += (t[i] - mt) * (y[i] - my);
          den += (t[i] - mt) ** 2;
        }
        return Math.min(-4, num / den); // dB per second
      });
      return { f0: note.f0, times: note.times, rows, tail };
    })
    .sort((a, b) => a.f0 - b.f0);
}

// One measured harmonic's level (dB) at `seconds` after the pluck.
function rowLevel(ref, k, seconds) {
  const t = ref.times;
  const row = ref.rows[k];
  const last = t.length - 1;
  if (seconds <= t[0]) return row[0];
  if (seconds >= t[last]) return row[last] + ref.tail[k] * (seconds - t[last]);
  let i = 0;
  while (t[i + 1] < seconds) i++;
  return row[i] + ((row[i + 1] - row[i]) * (seconds - t[i])) / (t[i + 1] - t[i]);
}

// A measured note's spectrum read at a frequency: between two of its harmonics,
// the level in between; above its last, falling 6 dB per harmonic.
function levelAt(ref, hz, seconds) {
  const p = hz / ref.f0 - 1;
  const top = ref.rows.length - 1;
  if (p <= 0) return rowLevel(ref, 0, seconds);
  if (p >= top) return rowLevel(ref, top, seconds) - 6 * (p - top);
  const i = Math.floor(p);
  const a = rowLevel(ref, i, seconds);
  return a + (rowLevel(ref, i + 1, seconds) - a) * (p - i);
}

// Which measured notes speak for a pitch: [[ref, weight], ...].
function mixFor(refs, hz) {
  if (hz <= refs[0].f0) return [[refs[0], 1]];
  for (let i = 0; i < refs.length - 1; i++) {
    if (hz > refs[i + 1].f0) continue;
    const w = Math.log(hz / refs[i].f0) / Math.log(refs[i + 1].f0 / refs[i].f0);
    if (w < 0.001) return [[refs[i], 1]];
    if (w > 0.999) return [[refs[i + 1], 1]];
    return [[refs[i], 1 - w], [refs[i + 1], w]];
  }
  return [[refs[refs.length - 1], 1]];
}

class Voice {
  constructor() {
    this.phase = new Float64Array(MAX_PARTIALS);
    this.gain = new Float64Array(MAX_PARTIALS);
    this.active = false;
  }

  start(note, mix, order) {
    this.active = true;
    this.order = order;
    this.group = note.group ?? null;
    this.hz = note.hz;
    this.velocity = note.velocity ?? 1;
    this.bend = Array.isArray(note.bend) && note.bend.length ? note.bend : null;
    this.segment = 0;
    this.mix = mix;
    this.t = 0; // samples since the pluck
    this.fade = 1;
    this.fall = 0;
    this.phase.fill(0);
    this.gain.fill(0);
  }

  // The pitch curve: [[seconds, cents], ...] in time order, straight lines
  // between the points, held flat before and after.
  bendFactor(seconds) {
    const points = this.bend;
    if (!points) return 1;
    while (this.segment < points.length - 1 && points[this.segment + 1][0] <= seconds) this.segment++;
    const [t0, c0] = points[this.segment];
    const next = points[this.segment + 1];
    let cents = c0;
    if (seconds > t0 && next && next[0] > t0) cents = c0 + ((next[1] - c0) * (seconds - t0)) / (next[0] - t0);
    return Math.pow(2, cents / 1200);
  }

  release(seconds, fs) {
    const fall = 1 / (seconds * fs);
    if (fall > this.fall) this.fall = fall;
  }

  // Adds `n` samples (n <= BLOCK) into out[offset...].
  render(out, offset, n, fs) {
    const start = this.t / fs;
    const end = (this.t + n) / fs;
    const hz = this.hz * this.bendFactor(end);
    const count = Math.min(MAX_PARTIALS, Math.floor(Math.min(TOP_HZ, fs * 0.45) / hz));
    const attack = Math.min(1, end / ATTACK_S) * this.velocity;
    const fadeFrom = this.fade;
    const fadeStep = this.fall;
    let loudest = 0;
    for (let k = 0; k < count; k++) {
      const partialHz = (k + 1) * hz;
      let db = 0;
      for (let m = 0; m < this.mix.length; m++) db += this.mix[m][1] * levelAt(this.mix[m][0], partialHz, end);
      const target = Math.pow(10, db / 20) * attack;
      if (target > loudest) loudest = target;
      // A sine by recurrence, restarted from its phase each step so the pitch can move.
      const w = (2 * Math.PI * partialHz) / fs;
      const c = 2 * Math.cos(w);
      const phase = this.phase[k];
      let y1 = Math.sin(phase - w);
      let y2 = Math.sin(phase - 2 * w);
      let g = this.gain[k];
      const step = (target - g) / n;
      let fade = fadeFrom;
      for (let i = 0; i < n; i++) {
        const y = c * y1 - y2;
        y2 = y1;
        y1 = y;
        g += step;
        if (fadeStep) fade = fade > fadeStep ? fade - fadeStep : 0;
        out[offset + i] += g * y * fade;
      }
      this.gain[k] = target;
      this.phase[k] = (phase + n * w) % (2 * Math.PI);
    }
    for (let k = count; k < MAX_PARTIALS; k++) this.gain[k] = 0;
    if (fadeStep) this.fade = Math.max(0, fadeFrom - fadeStep * n);
    this.t += n;
    if (this.fade <= 0 || (start > 0.3 && loudest < SILENT)) this.active = false;
  }
}

export class Veena {
  constructor(sampleRate) {
    this.fs = sampleRate;
    this.clock = 0; // samples rendered so far; note times are on this clock
    this.refs = null; // until the table arrives there is nothing to play
    this.voices = Array.from({ length: MAX_VOICES }, () => new Voice());
    this.pending = []; // notes not yet begun, in time order
    this.order = 0;
  }

  set(message) {
    if (message.table) this.refs = prepare(message.table);
  }

  // note: { id, hz, at (samples on this.clock), group?, bend?, velocity? }.
  // Notes sharing a `group` are one string: each damps the one before it.
  noteOn(note) {
    let i = this.pending.length;
    while (i > 0 && this.pending[i - 1].at > note.at) i--;
    this.pending.splice(i, 0, note);
  }

  // Only a note that has not begun can be cancelled; one already sounding rings out.
  cancel(id) {
    const at = this.pending.findIndex((note) => note.id === id);
    if (at !== -1) this.pending.splice(at, 1);
  }

  begin(note) {
    if (!this.refs) return;
    let free = null;
    let oldest = null;
    let sounding = 0;
    for (const voice of this.voices) {
      if (!voice.active) {
        free = free ?? voice;
        continue;
      }
      sounding++;
      if (note.group && voice.group === note.group) voice.release(CHOKE_S, this.fs);
      if (!voice.fall && (!oldest || voice.order < oldest.order)) oldest = voice;
    }
    // Keep one voice spare: past that the oldest fades, buried under the newer.
    if (sounding >= MAX_VOICES - 1 && oldest) oldest.release(STEAL_S, this.fs);
    if (!free) free = this.voices.reduce((a, b) => (a.order < b.order ? a : b));
    free.start(note, mixFor(this.refs, note.hz), ++this.order);
  }

  get silent() {
    return !this.pending.length && this.voices.every((voice) => !voice.active);
  }

  // Fills `out` (a Float32Array), mono. Notes begin on a control step: at most
  // 1.3 ms late, the same for every note of a phrase.
  process(out) {
    out.fill(0);
    for (let offset = 0; offset < out.length; offset += BLOCK) {
      const n = Math.min(BLOCK, out.length - offset);
      while (this.pending.length && this.pending[0].at <= this.clock) this.begin(this.pending.shift());
      for (const voice of this.voices) if (voice.active) voice.render(out, offset, n, this.fs);
      this.clock += n;
    }
  }
}

// The audio-thread life. A note's `when` is an AudioContext time; messages
// arrive between blocks, where `currentTime` is the next block's first sample.
if (typeof registerProcessor === "function") {
  class VeenaProcessor extends AudioWorkletProcessor {
    constructor() {
      super();
      this.veena = new Veena(sampleRate);
      this.port.onmessage = (event) => {
        const message = event.data;
        if (message.type === "note") {
          const ahead = Math.max(0, Math.round((message.when - currentTime) * sampleRate));
          this.veena.noteOn({ ...message, at: this.veena.clock + ahead });
        } else if (message.type === "cancel") {
          this.veena.cancel(message.id);
        } else {
          this.veena.set(message);
        }
      };
    }

    process(_inputs, outputs) {
      const out = outputs[0][0];
      if (this.veena.silent) {
        this.veena.clock += out.length;
        out.fill(0);
      } else {
        this.veena.process(out);
      }
      for (let ch = 1; ch < outputs[0].length; ch++) outputs[0][ch].set(out);
      return true;
    }
  }
  registerProcessor("swaraga-veena", VeenaProcessor);
}
