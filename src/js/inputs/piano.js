// Piano input. See specs/02-swara-keyboard-finder.md.
//
// A real keyboard, drawn once and never redrawn: the keys are fixed physical
// notes from G3 to G5 about middle C, and it is the *scale* that moves along
// them. Two things move it - the Key/Shruti setting, which says which note Sa
// sits on, and graha bhēdam, which hands the tonic to a different note of the
// selection. Both arrive here already added together as `saOffset`, semitones
// from middle C.
//
// That the keyboard is real is the point, not an implementation detail: a
// keyboard whose C moved about with the setting would be a swara diagram
// wearing piano clothes, and could not be played along with an actual
// instrument. So every key names the note it is, and Sa lands wherever the
// chosen key puts it.
import {
  keyLabelHtml,
  isBlackKey,
  labelForDegree,
  applySthayi,
  renderSelectionBox,
  stackReferenceLabel,
  noteNameAt,
  noteNameWithOctaveAt,
} from "../notation.js";
import { playPianoTone } from "../audio.js";

// Both ends land on a white key: a black key is drawn straddling the
// boundary *after* the white one below it, so ending on a black key would
// hang half of it off the edge of the keyboard. -5 is G3, five semitones below
// middle C; 19 is G5.
//
// This range is also what caps the Key setting at G4. A full arohana needs
// twelve semitones above Sa, and Sa at +7 (G4) puts the upper Sa on semitone
// 19 - the topmost key, exactly. One key higher and the octave would run off
// the end of the board, which is why the keys above G are offered an octave
// down (G♯3..B3) instead. See the Key/Shruti fieldset in index.html.
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
const BLACK_KEY_HALF_PCT = BLACK_KEY_WIDTH_PCT / 2;

// Which white-key boundaries carry a black key. Boundary `i` is the line
// between white key i-1 and white key i, and a black key is centred on it - so
// this is what says whether a given white key has a black neighbour biting into
// its left edge, its right, or neither. Boundaries 0 and length are the two
// ends of the keyboard and never carry one.
const BLACK_BOUNDARIES = new Set(BLACK_SEMITONES.map((s) => WHITE_SEMITONES.indexOf(s - 1) + 1));

function mod12(n) {
  return ((n % 12) + 12) % 12;
}

// Where a white key's reference label goes: the middle of the *visible* strip
// along its top, not the middle of the key.
//
// A black key overlaps each of its white neighbours by half its own width, so
// the top of a white key is not symmetrically exposed - C and F have a black
// key biting only their right side, E and B only their left. Centring on the
// key put those labels partly behind a black key and, worse, made the row of
// labels bunch and gap in a way that read as an error. Centring on what's
// actually visible fixes both, and as a side effect evens the row out: it
// pulls the pair either side of an E-F or B-C gap toward each other, which is
// exactly where the row's two double-width gaps were.
function whiteLabelCentre(index) {
  const leftBite = BLACK_BOUNDARIES.has(index) ? BLACK_KEY_HALF_PCT : 0;
  const rightBite = BLACK_BOUNDARIES.has(index + 1) ? BLACK_KEY_HALF_PCT : 0;
  return index * WHITE_KEY_WIDTH_PCT + (WHITE_KEY_WIDTH_PCT + leftBite - rightBite) / 2;
}

// The same answer, re-expressed as a percentage of the key's own width, for the
// note tag that sits *on* the key rather than in the strip above it. Sharing
// whiteLabelCentre rather than restating the geometry means the tag and the
// reference label above stand in the same column, and there is one place where
// "which part of a white key's head is actually visible" is worked out.
function whiteNoteCentreWithinKey(index) {
  return ((whiteLabelCentre(index) - index * WHITE_KEY_WIDTH_PCT) / WHITE_KEY_WIDTH_PCT) * 100;
}

// The pre-graha-bhēdam name for a key, in the app's one reference-annotation
// format - see stackReferenceLabel. A key outside the selectable octave is
// named the traditional way, with the sthayi dot that says which octave.
//
// Takes a degree measured from where the *Key setting* alone puts Sa, not from
// middle C: this strip answers "what was this key before the tonic shift", and
// the Key setting is not a tonic shift - it is where home was to begin with.
function originalLabel(degreeFromKey, labelPrefs) {
  const label =
    degreeFromKey >= 0 && degreeFromKey <= 12
      ? labelForDegree(degreeFromKey, labelPrefs)
      : applySthayi(labelForDegree(mod12(degreeFromKey), labelPrefs), degreeFromKey < 0 ? -1 : 1);
  return stackReferenceLabel(label, mod12(degreeFromKey));
}

// render(container, props): (re)builds the whole widget from the current
// `selected` Set<degree> each call. `order`, if given, means "Record swara
// order" is on; the recorded sequence is shown and edited in the selection
// tray below the keyboard, which is the one place in the app that does it.
// Low Sa (degree 0) and high Sa (degree 12) are independent keys/degrees -
// no shared state between them.
//
// A key's *degree* is `semitone - saOffset`: only 0..12 are real, selectable
// degrees, and that twelve-semitone window sits wherever Sa currently is. Keys
// outside it still carry the right swara name for their pitch (an octave up or
// down), but are shown dimmed and can't be selected - the selection model has
// no room for them. At Key G4 that leaves most of the lower keyboard dimmed,
// which is honest: those notes really are below the scale being built.
//
// `keyOffset` is the Key setting on its own, and is only needed to tell the
// two kinds of movement apart - the reference strip reports what graha bhēdam
// did, so it measures from the key rather than from middle C.
//
// `freePlay` drops the whole notion of a selection: every key is live,
// nothing is highlighted, and a tap just sounds the note (app.js's
// addOrToggle handles that, and playPianoTone is happy with any integer
// semitone, negative or past 12).
export function render(container, props) {
  const { selected, onToggle, labelPrefs, order, saOffset = 0, keyOffset = 0, freePlay = false } = props;
  container.className = "piano-style";
  container.innerHTML = "";

  // The keyboard gets its own element rather than being the container itself,
  // so the reference strip above and the selection tray below can be its
  // siblings - .piano is positioned and has a fixed height, which neither
  // could have survived from inside it.
  const board = document.createElement("div");
  board.className = "piano" + (freePlay ? " free-play" : "");

  // The reference strip: the swara each key held *before* the transpose, on
  // its own line above the keyboard rather than on the keys.
  //
  // Above rather than on: a black key straddles the boundary between two white
  // ones and overlaps each by half its width, so an annotation drawn on a black
  // key sat over its neighbours' even with every one of them inside its own key
  // - which forced two staggered strips inside the keys and, with the badges
  // still there at the time, a taller keyboard. One line above the keyboard has
  // none of that: every label is free of the keys' geometry and of each other.
  //
  // Always built, empty when not transposed, so the keyboard never moves down
  // the page the moment Transpose is pressed. The strip is the same height
  // either way; only its contents come and go.
  const refStrip = document.createElement("div");
  refStrip.className = "piano-ref";
  refStrip.setAttribute("aria-hidden", "true"); // the keys themselves are the accessible labels

  // Anchored at its key's centre, bottom-aligned, so a plain name sits on the
  // lower line and only a compound one reaches up to the second - exactly how
  // the keys' own labels stack, read the same way from the same column.
  // Only while graha bhēdam is holding the scale away from its key. Changing
  // the Key setting is not something to annotate: it moves the whole scale
  // bodily, so every key's "before" would be the swara one key along, which
  // says nothing.
  const shifted = saOffset !== keyOffset;
  const addRefLabel = (semitone, centrePct) => {
    if (!shifted) return;
    const label = document.createElement("span");
    label.className = "piano-ref-label";
    label.style.left = `${centrePct}%`;
    label.textContent = originalLabel(semitone - keyOffset, labelPrefs);
    refStrip.appendChild(label);
  };

  // `noteCentrePct` is where a note tag sits across the key it's on. Black keys
  // take the default: nothing overlaps them, so their own middle is visible.
  const buildKey = (semitone, className, noteCentrePct = 50) => {
    const degree = semitone - saOffset;
    const inWindow = degree >= 0 && degree <= 12;
    const isSelected = !freePlay && inWindow && selected.has(degree);

    const key = document.createElement("button");
    key.type = "button";
    key.className =
      className +
      (isSelected ? " selected" : "") +
      (!freePlay && !inWindow ? " out-of-range" : "") +
      (degree === 0 ? " is-tonic" : "");
    key.title = noteNameWithOctaveAt(semitone);
    // Degree 12 already carries its own tara dot (it *is* the octave above).
    // Keys outside the window belong to a neighbouring octave and say so the
    // traditional way - a dot below for mandra, above for tara - which is the
    // only thing distinguishing, say, the P five semitones under Sa from the
    // P seven above it.
    key.innerHTML = inWindow
      ? keyLabelHtml(degree, labelPrefs)
      : keyLabelHtml(mod12(degree), labelPrefs, degree < 0 ? -1 : 1);

    // Sa's key alone says which note it is, at the head of the key. Every white
    // key carried one at first, and fifteen of them read as a second row of
    // labels competing with the swaras for the same keys - the note names are
    // the one thing on this keyboard that isn't what the app is about. One
    // label answers the only question they were there for ("which key am I
    // in"), and the rest of the keyboard can be counted off from it the way it
    // would be on a real one. The full name with octave stays on every key, in
    // `title` and the accessible name.
    //
    // Lifted out of the key's flex column by .piano .key-note and pinned to the
    // key's head: it is deliberately nowhere near the swara label at the foot of
    // the key, and deliberately doesn't look like one.
    if (degree === 0) {
      const note = document.createElement("span");
      note.className = "key-note";
      note.style.left = `${noteCentrePct}%`;
      note.textContent = noteNameAt(semitone);
      key.appendChild(note);
    }

    // Stated rather than left to the button's own text: with a note name inside
    // the key, that text now runs the two labels together - a key came out as
    // "SC", read aloud as one word. The two are separate facts about the key and
    // have to be announced as two.
    const swaraName = inWindow
      ? labelForDegree(degree, labelPrefs)
      : applySthayi(labelForDegree(mod12(degree), labelPrefs), degree < 0 ? -1 : 1);
    key.setAttribute("aria-label", `${swaraName}, ${noteNameWithOctaveAt(semitone)}`);

    key.addEventListener("click", (e) => {
      e.stopPropagation(); // a black key sits on top of two white ones
      // Out-of-window keys are unavailable for *selection* only - there's no
      // degree 0-12 for them to be - but they're still notes, so they still
      // sound. The keyboard was widened to be played on, and a key that
      // stays silent when pressed reads as broken rather than as reserved.
      //
      // `semitone`, not `degree`: a key sounds its own pitch, which is what
      // makes the keyboard honest - the scale has slid to a new place on a
      // keyboard that never moved. Selectable keys reach the same answer
      // through app.js's soundingDegree, which adds this same offset back on.
      // Both are semitones from middle C, which is what audio.js wants.
      if (freePlay || inWindow) onToggle(degree);
      else playPianoTone(semitone);
    });
    return key;
  };

  WHITE_SEMITONES.forEach((semitone, i) => {
    const key = buildKey(semitone, "key white-key", whiteNoteCentreWithinKey(i));
    key.style.left = `${i * WHITE_KEY_WIDTH_PCT}%`;
    // Half a pixel wider than its slot, so neighbours overlap rather than
    // meeting exactly. They are positioned by percentage and abut perfectly in
    // layout - measured at 538px, all 14 are 35.888px wide with at most 0.013px
    // between them - but a fractional edge can still land either side of a
    // device pixel while the window is being dragged, and a hairline of page
    // background flashes through. Overlapping costs nothing visible: the seam
    // is a 1px border either way, and the last key's half pixel of overhang
    // falls inside the board's own rounding.
    key.style.width = `calc(${WHITE_KEY_WIDTH_PCT}% + 0.5px)`;
    board.appendChild(key);
    addRefLabel(semitone, whiteLabelCentre(i));
  });

  BLACK_SEMITONES.forEach((semitone) => {
    const key = buildKey(semitone, "key black-key");
    // A black key always has a white key one semitone below it, and the
    // range starts on a white key, so this lookup can't miss.
    const boundary = (WHITE_SEMITONES.indexOf(semitone - 1) + 1) * WHITE_KEY_WIDTH_PCT;
    key.style.left = `${boundary - BLACK_KEY_WIDTH_PCT / 2}%`;
    key.style.width = `${BLACK_KEY_WIDTH_PCT}%`;
    board.appendChild(key);
    addRefLabel(semitone, boundary); // a black key is centred on the boundary
  });

  container.appendChild(refStrip);
  container.appendChild(board);

  // Same rule the other two styles follow: the tray appears only while
  // "Record swara order" is on, where it's the one place the *sequence* can
  // be read and edited - and, since the keys stopped carrying order badges,
  // the only thing that shows a swara was recorded more than once.
  // Free play has no selection to lay out at all.
  if (order && !freePlay) {
    const box = document.createElement("div");
    renderSelectionBox(box, props);
    container.appendChild(box);
  }
}
