// Look-ahead note scheduling on the audio clock (specs/09 Phase 1).
//
// Sequences used to step on setTimeout: play a note, wait a gap, play the
// next. A timer is late by whatever the main thread was busy with, so note
// spacing wobbled, and a pitch curve (a gamaka, Phase 4) cannot be laid onto a
// clock that only knows "about now". The standard fix: a timer wakes often and
// schedules every note due within a short window at its exact AudioContext
// time. The timer can be late by up to the window without the music noticing.
//
// The shape of a sequence is unchanged from the old loops: notes `gap()` apart,
// `turnaround()` after the note at `pauseAfterIndex` and at the loop boundary,
// and both read on every note so a tempo change applies to the next one, as it
// always has.

import { playNoteAt, sequenceEnded, sequenceStarted, whenRunning } from "./audio.js";

const TICK_MS = 25;
const LOOK_AHEAD_S = 0.12;
// The first note waits this long so it is scheduled, not already past.
const START_DELAY_S = 0.02;

// Plays `sequence` (semitones from middle C). Returns { cancel }. `onEnd` fires
// when the pass is over - one note-slot after the last note, as the old loop
// did - unless `loop()` says to go round again. Cancelling stops the timer and
// silences any note queued but not yet sounding; notes already sounding ring out.
//
// `startIndex` / `startAt` resume a sequence part-way: from that note, at that
// audio time (if it is still ahead). `position()` reports where a pass is - the
// first note not yet sounding and when it was due - for a caller that rebuilds
// the sequence and carries on (a tonic shift mid-playback).
export function playSequence({ sequence, pauseAfterIndex, gap, turnaround, loop = () => false, onEnd, startIndex = 0, startAt = null }) {
  let cancelled = false;
  let i = startIndex;
  let next = null;
  let clock = null;
  let timer = null;
  const queued = [];
  // Reported once each way, for the drone's "under playback" (audio.js).
  let finished = false;
  const leadIn = sequenceStarted(); // seconds the drone needs to lay the ground first, or 0
  const finish = () => {
    if (finished) return;
    finished = true;
    sequenceEnded();
  };

  whenRunning()
    .then((audioCtx) => {
      if (cancelled) return;
      clock = audioCtx;
      const earliest = audioCtx.currentTime + START_DELAY_S;
      next = startAt !== null && startAt >= earliest ? startAt : earliest + leadIn;
      let endAt = null;

      const tick = () => {
        const now = audioCtx.currentTime;
        // Forget notes that have started; only those still ahead can be cancelled.
        while (queued.length && queued[0].when <= now) queued.shift();

        while (endAt === null && next < now + LOOK_AHEAD_S) {
          if (i >= sequence.length) {
            if (!loop()) {
              endAt = next;
              break;
            }
            i = 0;
            next += turnaround(); // pause at the loop boundary before the pass repeats
            continue;
          }
          queued.push({ when: next, index: i, voice: playNoteAt(sequence[i], next, { phrase: true }) });
          next += i === pauseAfterIndex ? turnaround() : gap();
          i++;
        }

        if (endAt !== null && now >= endAt) {
          clearInterval(timer);
          timer = null;
          finish();
          if (onEnd) onEnd();
        }
      };

      tick();
      if (endAt === null || audioCtx.currentTime < endAt) timer = setInterval(tick, TICK_MS);
    })
    .catch(finish);

  return {
    position() {
      // The first queued note that has not started yet is where to carry on;
      // with none queued, the note the loop would schedule next.
      const now = clock ? clock.currentTime : 0;
      const ahead = queued.find((q) => q.when > now);
      if (ahead) return { index: ahead.index, when: ahead.when };
      return { index: i, when: next };
    },
    cancel() {
      cancelled = true;
      if (timer !== null) clearInterval(timer);
      timer = null;
      queued.forEach((q) => q.voice.cancel());
      queued.length = 0;
      finish();
    },
  };
}
