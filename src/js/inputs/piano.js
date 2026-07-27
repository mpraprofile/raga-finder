// Piano input. See specs/02-swara-keyboard-finder.md.
//
// The keyboard runs half an octave either side of the S..S' octave rather
// than exactly C-C, for two reasons: Free play wants room to actually play
// on, and - more structurally - transposing slides the labels along the
// keys. Graha bhedam keeps the physical pitches and moves Sa to a different
// one of them, so on a keyboard the honest picture is the scale sitting in a
// new place with the swara names following it there. `labelOffset` is where
// Sa currently sits, in semitones from the original C; app.js normalises it
// to [-5, +6], and -5..18 is exactly the range that window can reach.
import { keyLabelHtml, buildOrderBadgeStack, isBlackKey } from "../notation.js";
import { playPianoTone } from "../audio.js";

// Piano-only cap on how many times one note can be recorded in "Record
// note order" mode (see buildOrderBadgeStack's `maxVisible`, which uses
// this same number for the *display* cap) - a busy vakra phrase that
// revisits one note many times would otherwise grow an arbitrarily tall
// badge stack even though the key itself is a fixed 200px. Exported so
// app.js can enforce the same number as a *functional* cap (stop
// recording further taps once a note hits it, rather than just hiding
// them) - see app.js's addOrToggle. Other styles leave it unlimited.
export const MAX_VISIBLE_BADGES = 5;

// Both ends land on a white key: a black key is drawn straddling the
// boundary *after* the white one below it, so ending on a black key would
// hang half of it off the edge of the keyboard. -5 is the white key five
// semitones below Sa; 19 is the first white key past the +6 offset window,
// which is what makes the last black key (18) have a white neighbour to sit
// against.
const MIN_SEMITONE = -5;
const MAX_SEMITONE = 19;

const SEMITONES = [];
for (let s = MIN_SEMITONE; s <= MAX_SEMITONE; s++) SEMITONES.push(s);

const WHITE_SEMITONES = SEMITONES.filter((s) => !isBlackKey(s));
const BLACK_SEMITONES = SEMITONES.filter(isBlackKey);
const WHITE_KEY_WIDTH_PCT = 100 / WHITE_SEMITONES.length;
// Same proportion of a white key the old fixed 7%-of-8-keys layout used, so
// the keyboard keeps its shape now that there are 14 whites instead of 8.
const BLACK_KEY_WIDTH_PCT = WHITE_KEY_WIDTH_PCT * 0.56;

function mod12(n) {
  return ((n % 12) + 12) % 12;
}

// render(container, { selected, onToggle, onRemoveOrder, labelPrefs, order,
// labelOffset, freePlay }): (re)builds the whole widget from the current
// `selected` Set<degree> each call. `order`, if given, is a Map<degree,
// number[]> (every 1-based click position for that degree, since a note can
// recur) used to show a small stacked order-badge per key when "record note
// order" is on - clicking a badge calls `onRemoveOrder(position)` to remove
// that exact recorded occurrence. Low Sa (degree 0) and high Sa (degree 12)
// are independent keys/degrees - no shared state between them.
//
// A key's *degree* is `semitone - labelOffset`: only 0..12 are real,
// selectable degrees, and that twelve-semitone window slides along the
// keyboard as the selection is transposed. Keys outside it still carry the
// right swara name for their pitch (an octave up or down), but are shown
// dimmed and can't be selected - the selection model has no room for them.
//
// `freePlay` drops the whole notion of a selection: every key is live,
// nothing is highlighted, and a tap just sounds the note (app.js's
// addOrToggle handles that, and playPianoTone is happy with any integer
// degree, negative or past 12).
export function render(container, { selected, onToggle, onRemoveOrder, labelPrefs, order, labelOffset = 0, freePlay = false }) {
  container.className = "piano" + (freePlay ? " free-play" : "");
  container.innerHTML = "";

  const buildKey = (semitone, className) => {
    const degree = semitone - labelOffset;
    const inWindow = degree >= 0 && degree <= 12;
    const isSelected = !freePlay && inWindow && selected.has(degree);

    const key = document.createElement("button");
    key.type = "button";
    key.className = className + (isSelected ? " selected" : "") + (!freePlay && !inWindow ? " out-of-range" : "");
    // Degree 12 is the octave bookend and prints as S'; anything outside the
    // window belongs to a neighbouring octave, so it takes the plain
    // pitch-class name.
    key.innerHTML = keyLabelHtml(inWindow ? degree : mod12(degree), labelPrefs);

    if (!freePlay && inWindow) {
      const badges = buildOrderBadgeStack(order && order.get(degree), onRemoveOrder, MAX_VISIBLE_BADGES);
      if (badges) key.appendChild(badges);
    }

    key.addEventListener("click", (e) => {
      e.stopPropagation(); // a black key sits on top of two white ones
      // Out-of-window keys are unavailable for *selection* only - there's no
      // degree 0-12 for them to be - but they're still notes, so they still
      // sound. The keyboard was widened to be played on, and a key that
      // stays silent when pressed reads as broken rather than as reserved.
      if (freePlay || inWindow) onToggle(degree);
      else playPianoTone(degree);
    });
    return key;
  };

  WHITE_SEMITONES.forEach((semitone, i) => {
    const key = buildKey(semitone, "key white-key");
    key.style.left = `${i * WHITE_KEY_WIDTH_PCT}%`;
    key.style.width = `${WHITE_KEY_WIDTH_PCT}%`;
    container.appendChild(key);
  });

  BLACK_SEMITONES.forEach((semitone) => {
    const key = buildKey(semitone, "key black-key");
    // A black key always has a white key one semitone below it, and the
    // range starts on a white key, so this lookup can't miss.
    const boundary = (WHITE_SEMITONES.indexOf(semitone - 1) + 1) * WHITE_KEY_WIDTH_PCT;
    key.style.left = `${boundary - BLACK_KEY_WIDTH_PCT / 2}%`;
    key.style.width = `${BLACK_KEY_WIDTH_PCT}%`;
    container.appendChild(key);
  });
}
