import {
  loadRagas,
  match,
  matchSeparate,
  matchOrdered,
  matchOrderedSeparate,
  melaContext,
  melakartaNames,
  grahaTonic,
  rotateToTonic,
  searchByName,
  buildNameIndex,
  isExactNameMatch,
  relatedByMela,
} from "./ragas.js";
import { playPianoTone, setMuted } from "./audio.js";
import { REFERENCE_ROWS, referenceRowCode, noteLabel } from "./notation.js";
import { checkAgainstStored } from "./melakarta.js";
import { mountMelaChart, renderKatapayadiReference } from "./mela-chart.js";
import * as piano from "./inputs/piano.js";
import * as buttons from "./inputs/buttons.js";
import * as wheel from "./inputs/wheel.js";

const INPUT_RENDERERS = { piano, buttons, wheel };
const NOTE_GAP_MS = 450;
// Extra pause at the loop boundary (on top of the usual NOTE_GAP_MS after
// the last note), so a looped phrase doesn't run straight into its own
// repeat - gives the ear a moment to register "that was the end" before
// it starts again.
const LOOP_END_DELAY_MS = 900;

const ICON_UNMUTED =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M3 10v4h4l5 5V5L7 10H3z"/><path d="M14.5 6.09v1.86c1.6.87 2.5 2.28 2.5 4.05s-.9 3.18-2.5 4.05v1.86c2.89-.86 5-3.54 5-6.91s-2.11-6.05-5-6.91z"/></svg>';
const ICON_MUTED =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M3 10v4h4l5 5V5L7 10H3z"/><path d="M19.5 12l2.1-2.1-1.1-1.1L18.4 10.9l-2.1-2.1-1.1 1.1 2.1 2.1-2.1 2.1 1.1 1.1 2.1-2.1 2.1 2.1 1.1-1.1z"/></svg>';
const ICON_PLAY = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5-13-7.5z"/></svg>';
const ICON_STOP = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>';

let inputStyle = "piano"; // piano | buttons | wheel
let layoutMode = "combined"; // combined | separate
let orderMode = false; // record click order, for vakra search
// Piano only: taps just sound the note and leave the scale alone, so the
// keyboard can be noodled on without wrecking a search in progress.
let freePlay = false;
// Separate mode only: a transpose press moves both directions by the one
// tonic, instead of each picking its own (which would pull the two apart).
// Mirrors #transpose-both-toggle, which is the control of record.
let transposeBoth = true;

// How far each selection has been transposed from its baseline. `steps` is
// the net number of button presses, shown next to the Transpose title so a
// rotated scale doesn't lose track of where it came from. `offset` is the
// same journey in semitones - where Sa now physically sits - which is what
// slides the Piano's labels along its keys. "Reset base" zeroes both:
// wherever you've got to becomes the new home.
const transposeState = {
  combined: { steps: 0, offset: 0 },
  arohana: { steps: 0, offset: 0 },
  avarohana: { steps: 0, offset: 0 },
};

const EMPTY_PROMPT = "Select some swaras to find matching ragas.";

// "Record note order" only: where the next swara pressed should land. null
// means append, which is the ordinary case. Set by tapping a gap in the
// selection tray, and advanced by one on each insert so a run of swaras goes
// in as a run rather than in reverse. Cleared whenever the sequence it
// pointed into stops existing.
let insertAt = null;
// Key / Shruti: which physical note Sa sits on, in semitones from middle C.
// The dropdown offers -5..+7 (G3 up to G4) - see the fieldset in index.html
// for why that particular stretch and not C..B.
let keySemitone = 0;
let muted = false;
let ragas = [];
let melaNames = new Map(); // mela number -> that melakarta's name, filled after load
// Folded name forms for the search view, built once after load - see
// buildNameIndex() in ragas.js.
let nameIndex = [];
// Which numbering convention each family is displayed in - see notation.js.
// Changed from the reference table in the settings view, and persisted from
// there like Key and Theme (see initLabelPrefs); these values are the fallback
// for a first run or an unreadable stored one, not a fixed setting.
//
// "alt" for both is a deliberate default, not an oversight against CLAUDE.md's
// mainstream table: that table describes what the scraper writes to
// data/ragas.json, and this is the display layer. Alt is the convention the
// family this app is built for expects to read.
const labelPrefs = { gandhara: "alt", nishada: "alt" };

// Insertion-ordered arrays, not Sets - order is always tracked (cheap), and
// only *used* (for badges/matching/playback) when orderMode is on. See
// specs/02-swara-keyboard-finder.md "Note order".
const combined = [];
const arohanaSel = [];
const avarohanaSel = [];

const muteBtn = document.getElementById("mute-btn");
const combinedBlock = document.getElementById("combined-block");
const combinedContainer = document.getElementById("combined-input");
const separateContainer = document.getElementById("separate-inputs");
const playBothLabel = document.getElementById("play-both-label");
const arohanaContainer = document.getElementById("arohana-input");
const avarohanaContainer = document.getElementById("avarohana-input");
const resultsEl = document.getElementById("results");
const promptEl = document.getElementById("prompt");
const orderModeToggle = document.getElementById("order-mode-toggle");
const orderModeLabel = document.getElementById("order-mode-label");
const freePlayLabel = document.getElementById("free-play-label");
const freePlayToggle = document.getElementById("free-play-toggle");
const transposeBothLabel = document.getElementById("transpose-both-label");
const transposeBothToggle = document.getElementById("transpose-both-toggle");
const layoutGroup = document.getElementById("layout-group");
const combinedTitle = document.getElementById("combined-title");

const combinedControls = document.getElementById("combined-controls");
const playBtn = document.getElementById("play-btn");
const loopToggle = document.getElementById("loop-toggle");
const resetBtn = document.getElementById("reset-btn");

const arohanaControls = document.getElementById("arohana-controls");
const arohanaPlayBtn = document.getElementById("arohana-play-btn");
const arohanaLoopToggle = document.getElementById("arohana-loop-toggle");
const arohanaResetBtn = document.getElementById("arohana-reset-btn");
const playBothToggle = document.getElementById("play-both-toggle");

const avarohanaControls = document.getElementById("avarohana-controls");
const avarohanaPlayBtn = document.getElementById("avarohana-play-btn");
const avarohanaLoopToggle = document.getElementById("avarohana-loop-toggle");
const avarohanaResetBtn = document.getElementById("avarohana-reset-btn");

const mainView = document.getElementById("main-view");
const settingsView = document.getElementById("settings-view");
const settingsOpenBtn = document.getElementById("settings-open-btn");
const settingsBackBtn = document.getElementById("settings-back-btn");
const searchView = document.getElementById("search-view");
const searchOpenBtn = document.getElementById("search-open-btn");
const searchBackBtn = document.getElementById("search-back-btn");
const ragaSearchInput = document.getElementById("raga-search-input");
const suggestToggleBtn = document.getElementById("raga-suggest-toggle");
const suggestListEl = document.getElementById("raga-suggestions");
const searchPromptEl = document.getElementById("search-prompt");
const searchResultsEl = document.getElementById("search-results");

function toggleInList(list, degree) {
  const idx = list.indexOf(degree);
  if (idx !== -1) {
    list.splice(idx, 1); // deselecting is silent, per spec
  } else {
    list.push(degree);
    playPianoTone(soundingDegree(list, degree));
  }
}

// In Record note order mode, a note can recur (vakra ragas repeat notes
// within a scale), so re-tapping an already-selected note appends another
// occurrence instead of deselecting it - Reset is the only way to clear.
// Outside order mode, keep the plain select/deselect toggle.
//
// No per-note repeat cap. Piano used to stop at five occurrences of one swara
// and refuse further taps with a "blocked" sound, but that limit only ever
// existed because a key's badge stack had to fit inside the key. With the
// badges gone and the tray carrying the order for every style, the limit had
// nothing left to protect and made Piano behave differently from the wheel and
// Buttons for no reason a user could see.
//
// Returns whether the selection actually changed, so a deliberately inert tap
// (free play) doesn't drag a re-render - and, more to the point, doesn't
// restart a sequence that's currently playing.
function addOrToggle(list, degree) {
  // Free play (Piano only): sound the note and change nothing. Every key
  // speaks, including one that's already selected - there's no "deselect"
  // to keep silent here, so the silent-deselect rule doesn't apply.
  if (freePlay && inputStyle === "piano") {
    playPianoTone(soundingDegree(list, degree));
    return false;
  }
  if (orderMode) {
    insertDegree(list, degree);
    playPianoTone(soundingDegree(list, degree));
  } else {
    toggleInList(list, degree);
  }
  return true;
}

// Appends, unless the caret says otherwise. Advancing the caret past what it
// just placed is what makes a run of swaras go in as a run: press M1 then G2
// with the caret at 3 and you get ... M1 G2 ..., not ... G2 M1 ....
function insertDegree(list, degree) {
  if (insertAt === null || insertAt > list.length) {
    list.push(degree);
    return;
  }
  list.splice(insertAt, 0, degree);
  insertAt += 1;
}

// The caret indexes into one specific recorded sequence, so it can't outlive
// that sequence: switching direction, clearing, leaving order mode, or the
// list shrinking past it all make it meaningless.
function clearInsertPoint() {
  insertAt = null;
}

// Removing an element before the caret shifts everything after it down by one.
function insertPointAfterRemoval(position) {
  if (insertAt === null) return;
  if (position - 1 < insertAt) insertAt -= 1;
}

function moveInList(list, from, to) {
  const [item] = list.splice(from, 1);
  list.splice(to > from ? to - 1 : to, 0, item);
}

// Assembler-only: its palette stays permanently populated (see
// renderInputs), so a tap there is always "add" and a tap in the tray is
// always "remove one" - never a toggle - regardless of orderMode. Lets the
// assembler build a scale with repeated notes (e.g. for vakra ragas)
// without needing the "Record note order" checkbox, though that option is
// still available for it too (see renderInputs/assembler.js) since order
// mode changes something orthogonal - whether the tray is sorted or shows
// the recorded click order, and whether tiles carry position badges.
function appendNote(list, degree) {
  list.push(degree);
  playPianoTone(soundingDegree(list, degree));
}
function removeOneOccurrence(list, degree) {
  const idx = list.lastIndexOf(degree);
  if (idx !== -1) list.splice(idx, 1); // deselecting is silent, per spec
}

// Order mode only: removes the exact recorded occurrence at `position`
// (1-based, as shown on its badge) - clicking a yellow order badge calls
// this, regardless of input style. Silent, same as any other deselect.
function removeAtPosition(list, position) {
  list.splice(position - 1, 1);
  insertPointAfterRemoval(position);
}

// Map<degree, number[]> of every 1-based click position for that degree -
// an array, not a single number, since a note can recur (see addOrToggle).
function orderMapFor(list) {
  if (!orderMode) return null;
  const map = new Map();
  list.forEach((degree, i) => {
    const positions = map.get(degree);
    if (positions) positions.push(i + 1);
    else map.set(degree, [i + 1]);
  });
  return map;
}

// Replaces the entire selection in one go - gṛha bhēdam rotation and
// sweep-select (see specs/03-swara-wheel.md) both change every note at
// once, which none of the existing per-note callbacks can express. Follows
// the same pattern as the rest: mutate the list in place (it's the live
// array every other path shares), then restart playback, re-render, re-match.
// Piano and Buttons ignore this prop, as they already ignore props they
// don't use.
function replaceList(list, newList) {
  list.splice(0, list.length, ...newList);
}

// The wheel builds its own new list (it owns tap and sweep alike), so the
// caret is advanced here from how much longer the list got rather than by the
// insert helper. Only order mode has a caret at all.
function advanceInsertPoint(added) {
  if (orderMode && insertAt !== null && added > 0) insertAt += added;
}

// --- Transpose (gṛha bhēdam) -------------------------------------------
// One row per block, under that block's Play/Loop controls (see index.html),
// so it belongs to the *selection* rather than to any one input style - which
// is what lets Piano have it too.

function listFor(which) {
  return which === "arohana" ? arohanaSel : which === "avarohana" ? avarohanaSel : combined;
}

// The inverse of listFor. The per-note tone helpers are handed the selection
// array they're editing rather than the block's name, and they need that
// block's transpose state to sound a note - see soundingDegree.
function transposeStateForList(list) {
  if (list === arohanaSel) return transposeState.arohana;
  if (list === avarohanaSel) return transposeState.avarohana;
  return transposeState.combined;
}

// Where Sa physically is, in semitones from middle C: the Key setting, plus
// however far gṛha bhēdam has since moved the tonic. This is the number the
// Piano places its scale at and the number every tone is measured from, so the
// two cannot disagree.
//
// Normalised into the same window the Key setting itself offers, because that
// window is what the keyboard can draw. Without it, Key G4 plus a shift of a
// few semitones would put Sa at +13 and run the scale clean off the end of the
// board. Both ends of the choice are pitch classes, so this only ever moves an
// octave, never a note.
//
// The Piano draws 25 keys, -5..+19 about middle C, and a scale needs twelve of
// them above Sa: so Sa can sit anywhere from -5 (G3, with nothing below it) to
// +7 (G4, whose upper Sa is the topmost key). Thirteen positions, which is one
// more than there are pitch classes - so G, and only G, has two homes in the
// window, and a G can be meant as either.
const MIN_SA_OFFSET = -5;
const MAX_SA_OFFSET = 7;

// Where the wrap lands a G is therefore a real choice, and it's settled by
// staying near the key the user actually chose: pick G3 for a low key and G4
// for a high one, rather than always the same end, so a tonic shift moves the
// scale as little as it can. At Key G3 or G4 with no shift this returns the key
// itself, which is the case that would be most obviously wrong.
function normaliseSaOffset(semitones) {
  const wrapped = ((((semitones - MIN_SA_OFFSET) % 12) + 12) % 12) + MIN_SA_OFFSET; // [-5, +6]
  const alt = wrapped + 12; // the same pitch class an octave up - only ever +7, from -5
  if (alt > MAX_SA_OFFSET) return wrapped;
  return Math.abs(alt - keySemitone) < Math.abs(wrapped - keySemitone) ? alt : wrapped;
}

function saOffsetFor(which) {
  return normaliseSaOffset(keySemitone + transposeState[which].offset);
}

function saOffsetForList(list) {
  return normaliseSaOffset(keySemitone + transposeStateForList(list).offset);
}

// What a selected degree actually *sounds* as, in semitones from middle C -
// which is the only thing audio.js accepts.
//
// Two things sit between a degree and a pitch. The Key setting says which note
// Sa is, and applies everywhere in the app, always. Gṛha bhēdam rebases the
// selection so the new tonic becomes degree 0 - but the notes themselves never
// moved: the wheel rotates rather than re-drawing, the Piano's scale slides
// along fixed keys, and the grey reference marks still name the pitch each
// position started on. Adding that offset back on is what makes the ear agree
// with all of it - you hear the same pitches you were already hearing, begun
// from a different one of them, which is what gṛha bhēdam *is*. Without it the
// picture said "same notes, new Sa" while the sound said "new notes, same Sa".
//
// At Key C4 with no shift this is the identity, so nothing changes until one of
// the two is actually used - and the shift half goes back to nothing after "Set
// as 0", which is the control that says "this position is home now" and thereby
// hands playback back to Sa. That button is the user-facing switch between the
// two readings of a shifted scale; there is deliberately no separate preference
// for it.
//
// The graha half is not applied to the results list's own preview players (see
// ragaSequenceInKey): a raga found by name is played from its own Sa, so found
// ragas can be compared with each other rather than with the scale that led to
// them. The Key half applies there too, as it does everywhere. The wheel's
// centre summary is the deliberate exception among "found raga" players - it
// names the selection sitting under it, so it follows the shift like the
// selection does. See ragaSequenceAtTonic.
function soundingDegree(list, degree) {
  return degree + saOffsetForList(list);
}

// The same, for a whole sequence - what every block's Play button feeds to
// makePlayer.
function soundingSequence(list, degrees) {
  return degrees.map((degree) => soundingDegree(list, degree));
}

// Which selections a press in `which`'s row moves. In separate mode with
// "Transpose both" on, one press moves the pair; combined mode only ever has
// the one.
function transposeTargets(which) {
  if (which === "combined") return ["combined"];
  return transposeBoth ? ["arohana", "avarohana"] : [which];
}

// Where Sa now sits relative to the baseline, normalised to [-5, +6] rather
// than 0..11: this is what slides the Piano's key labels, and the nearer of
// the two equivalent directions is both the shorter visual jump and exactly
// the range the extended keyboard covers (see piano.js).
function normaliseOffset(semitones) {
  return ((((semitones + 5) % 12) + 12) % 12) - 5;
}

// The tonic is always taken from the selection whose control was pressed, and
// then applied to every target. Letting each direction pick its own
// next-selected-note would shift them by different intervals and quietly turn
// one raga into two unrelated ones - see grahaTonic in ragas.js.
function transposeSelection(which, direction) {
  const tonic = grahaTonic(listFor(which), direction);
  if (tonic === null) return;
  const options = { ordered: orderMode };

  for (const target of transposeTargets(which)) {
    const list = listFor(target);
    replaceList(list, rotateToTonic(list, tonic, options));
    const state = transposeState[target];
    state.steps += direction >= 0 ? 1 : -1;
    state.offset = normaliseOffset(state.offset + tonic);
  }

  if (which === "combined") restartIfPlaying(combinedPlayer);
  else restartSeparatePlayers();
  renderInputs();
  renderResults();
}

// "Reset base": keep the notes exactly where they are and forget how they got
// there, so the current scale becomes the new zero. On Piano that also drops
// the label offset, sliding the scale back to the home octave.
function resetTransposeBase(which) {
  for (const target of transposeTargets(which)) {
    transposeState[target].steps = 0;
    transposeState[target].offset = 0;
  }
  renderInputs();
}

function wireTransposeRow(which) {
  document.getElementById(`${which}-transpose-down`).addEventListener("click", () => transposeSelection(which, -1));
  document.getElementById(`${which}-transpose-up`).addEventListener("click", () => transposeSelection(which, 1));
  document.getElementById(`${which}-transpose-reset`).addEventListener("click", () => resetTransposeBase(which));
}
["combined", "arohana", "avarohana"].forEach(wireTransposeRow);

// Arrows are live only when there are at least two distinct pitch classes to
// hand the tonic between - transposing snaps to selected notes, not to
// semitones. The step count sits in one of two fixed-width slots either side
// of the title: down-transposes read to the left of the word, up-transposes
// to the right, so the sign is reinforced by which side it lands on and the
// arrows never shift as the number appears. Zero shows nothing at all - no
// number is the clearest way to say "not transposed".
function renderTransposeRow(which) {
  const { steps } = transposeState[which];
  const available = !inFreePlayMode() && !(which === "avarohana" && layoutMode === "separate" && transposeBoth);
  const canTranspose = available && new Set(listFor(which).map((d) => d % 12)).size >= 2;

  setControlEnabled(document.getElementById(`${which}-transpose-down`), canTranspose);
  setControlEnabled(document.getElementById(`${which}-transpose-up`), canTranspose);
  setControlEnabled(document.getElementById(`${which}-transpose-reset`), available && steps !== 0);

  document.getElementById(`${which}-transpose-count-down`).textContent = steps < 0 ? String(steps) : "";
  document.getElementById(`${which}-transpose-count-up`).textContent = steps > 0 ? `+${steps}` : "";
  document.getElementById(`${which}-transpose`).classList.toggle("control-disabled", !available);
}

function renderTransposeRows() {
  ["combined", "arohana", "avarohana"].forEach(renderTransposeRow);
}

// Free play turns the page into just a keyboard: it's Piano-only, and while
// it's on there is no selection to search with, so the layout choice, the
// scale controls all grey out in place (see updateControlAvailability).
function inFreePlayMode() {
  return freePlay && inputStyle === "piano";
}

// The tray-editing props (see renderSelectionBox): a caret position, a way to
// move it, and a way to reorder. Handed to whichever direction owns the tray.
function trayEditingProps(list, restart) {
  return {
    insertAt,
    onInsertAtChange: (index) => {
      insertAt = index;
      renderInputs();
    },
    onReorder: (from, to) => {
      moveInList(list, from, to);
      clearInsertPoint();
      restart();
      renderInputs();
      renderResults();
    },
  };
}

function renderInputs() {
  const renderer = INPUT_RENDERERS[inputStyle];
  renderTransposeRows();

  if (layoutMode === "combined" || inFreePlayMode()) {
    renderer.render(combinedContainer, {
      selected: new Set(combined),
      list: combined,
      labelPrefs,
      order: orderMapFor(combined),
      // Only combined mode gets the wheel's centre summary: in separate
      // mode both wheels would show the same text (matchSeparate returns
      // one joint result list for both directions), which reads as a bug
      // rather than as information.
      summary: exactMatchSummary(currentMatches().exact, combined),
      labelOffset: transposeState.combined.offset,
      saOffset: saOffsetFor("combined"),
      keyOffset: keySemitone,
      ...trayEditingProps(combined, () => restartIfPlaying(combinedPlayer)),
      freePlay: inFreePlayMode(),
      onReplace: (newList) => {
        advanceInsertPoint(newList.length - combined.length);
        replaceList(combined, newList);
        restartIfPlaying(combinedPlayer);
        renderInputs();
        renderResults();
      },
      onToggle: (degree) => {
        if (!addOrToggle(combined, degree)) return;
        restartIfPlaying(combinedPlayer);
        renderInputs();
        renderResults();
      },
      onAdd: (degree) => {
        appendNote(combined, degree);
        restartIfPlaying(combinedPlayer);
        renderInputs();
        renderResults();
      },
      onRemove: (degree) => {
        removeOneOccurrence(combined, degree);
        restartIfPlaying(combinedPlayer);
        renderInputs();
        renderResults();
      },
      onRemoveOrder: (position) => {
        removeAtPosition(combined, position);
        restartIfPlaying(combinedPlayer);
        renderInputs();
        renderResults();
      },
    });
  } else {
    renderer.render(arohanaContainer, {
      selected: new Set(arohanaSel),
      list: arohanaSel,
      labelPrefs,
      order: orderMapFor(arohanaSel),
      labelOffset: transposeState.arohana.offset,
      saOffset: saOffsetFor("arohana"),
      keyOffset: keySemitone,
      summary: exactMatchSummary(directionMatches(arohanaSel, "arohana"), arohanaSel),
      ...trayEditingProps(arohanaSel, restartSeparatePlayers),
      onReplace: (newList) => {
        advanceInsertPoint(newList.length - arohanaSel.length);
        replaceList(arohanaSel, newList);
        restartSeparatePlayers();
        renderInputs();
        renderResults();
      },
      onToggle: (degree) => {
        if (!addOrToggle(arohanaSel, degree)) return;
        restartSeparatePlayers();
        renderInputs();
        renderResults();
      },
      onAdd: (degree) => {
        appendNote(arohanaSel, degree);
        restartSeparatePlayers();
        renderInputs();
        renderResults();
      },
      onRemove: (degree) => {
        removeOneOccurrence(arohanaSel, degree);
        restartSeparatePlayers();
        renderInputs();
        renderResults();
      },
      onRemoveOrder: (position) => {
        removeAtPosition(arohanaSel, position);
        restartSeparatePlayers();
        renderInputs();
        renderResults();
      },
    });
    renderer.render(avarohanaContainer, {
      selected: new Set(avarohanaSel),
      list: avarohanaSel,
      labelPrefs,
      order: orderMapFor(avarohanaSel),
      descending: true,
      labelOffset: transposeState.avarohana.offset,
      saOffset: saOffsetFor("avarohana"),
      keyOffset: keySemitone,
      summary: exactMatchSummary(directionMatches(avarohanaSel, "avarohana"), avarohanaSel),
      ...trayEditingProps(avarohanaSel, restartSeparatePlayers),
      onReplace: (newList) => {
        advanceInsertPoint(newList.length - avarohanaSel.length);
        replaceList(avarohanaSel, newList);
        restartSeparatePlayers();
        renderInputs();
        renderResults();
      },
      onToggle: (degree) => {
        if (!addOrToggle(avarohanaSel, degree)) return;
        restartSeparatePlayers();
        renderInputs();
        renderResults();
      },
      onAdd: (degree) => {
        appendNote(avarohanaSel, degree);
        restartSeparatePlayers();
        renderInputs();
        renderResults();
      },
      onRemove: (degree) => {
        removeOneOccurrence(avarohanaSel, degree);
        restartSeparatePlayers();
        renderInputs();
        renderResults();
      },
      onRemoveOrder: (position) => {
        removeAtPosition(avarohanaSel, position);
        restartSeparatePlayers();
        renderInputs();
        renderResults();
      },
    });
  }
}

function hasSelection() {
  return layoutMode === "combined" ? combined.length > 0 : arohanaSel.length > 0 || avarohanaSel.length > 0;
}

// The one place the current selection is turned into results, whichever of
// the four (order mode x layout mode) shapes it currently has. Shared by
// the results list and by the wheel's centre summary, so the two can't
// drift into disagreeing about what's matching right now.
function currentMatches() {
  if (orderMode) {
    return layoutMode === "combined" ? matchOrdered(ragas, combined, "either") : matchOrderedSeparate(ragas, arohanaSel, avarohanaSel);
  }
  return layoutMode === "combined" ? match(ragas, new Set(combined)) : matchSeparate(ragas, new Set(arohanaSel), new Set(avarohanaSel));
}

// What sits in the hole in the middle of the swara wheel: the name of the
// raga you've landed on, and nothing else. Only an *exact* match earns the
// space - a count of near-misses is list-shaped information that belongs in
// the list (see countsRow), and a running tally in the middle of the wheel
// churned on every tap while saying nothing about the shape being drawn
// around it. No exact match means an empty centre, which is itself the
// answer. Other input styles ignore this prop.
//
// `list` is the selection this wheel is drawing, and it is what lets the
// centre play at the shifted tonic rather than at the raga's own Sa - see
// ragaSequenceAtTonic.
function exactMatchSummary(exact, list) {
  const top = exact[0] ?? null;
  if (!top) return null;
  return { text: top.name, onPlay: () => playScaleOnce(top, list) };
}

// Separate mode gives each wheel its own centre, answering for its own
// direction rather than both showing the same joint result. Constraining one
// direction and leaving the other unconstrained is exactly what matchSeparate
// already does with an empty set, so "exact" here means "this raga's arohana
// is precisely these swaras" - which is the question that wheel is asking.
function directionMatches(list, direction) {
  if (list.length === 0 || ragas.length === 0) return [];
  const pressed = new Set(list);
  const empty = new Set();
  const { exact } = direction === "arohana" ? matchSeparate(ragas, pressed, empty) : matchSeparate(ragas, empty, pressed);
  return exact;
}

function renderResults() {
  // Every result row's preview player is torn down and rebuilt fresh below,
  // so a still-running one from before this render would otherwise become
  // an orphaned timer chain attached to a button no longer in the DOM.
  stopActiveRowPreview();
  resultsEl.innerHTML = "";

  if (orderMode) {
    renderOrderedResults();
    return;
  }

  if (!hasSelection()) {
    promptEl.textContent = EMPTY_PROMPT;
    promptEl.hidden = false;
    return;
  }
  promptEl.hidden = true;

  const { exact, contains } = currentMatches();

  if (exact.length === 0 && contains.length === 0) {
    resultsEl.appendChild(emptyRow("No ragas match this swara set."));
    return;
  }

  const matched = currentMatchedSets();
  resultsEl.appendChild(countsRow(exact.length, contains.length));
  for (const raga of exact) resultsEl.appendChild(renderRow(raga, { text: "exact", tier: "exact" }, matched));
  for (const raga of contains) resultsEl.appendChild(renderRow(raga, null, matched));
}

// The tallies that used to sit in the middle of the wheel. They belong here:
// they describe the list, they change on every keystroke, and the hole in the
// wheel is far too small a place to read a running count in. What stays in
// the wheel is the one thing worth glancing at mid-selection - the name of
// the raga you've actually landed on.
function countsRow(exactCount, containsCount) {
  const li = document.createElement("li");
  li.className = "results-counts";
  const exactText = `${exactCount} exact ${exactCount === 1 ? "match" : "matches"}`;
  li.textContent = containsCount > 0 ? `${exactText} · ${containsCount} also contain these swaras` : exactText;
  return li;
}

function renderOrderedResults() {
  if (!hasSelection()) {
    promptEl.textContent = EMPTY_PROMPT;
    promptEl.hidden = false;
    return;
  }
  promptEl.hidden = true;

  const { exact, contains } = currentMatches();

  if (exact.length === 0 && contains.length === 0) {
    resultsEl.appendChild(emptyRow("No ragas match this swara order, even partially."));
    return;
  }

  const matched = currentMatchedSets();
  resultsEl.appendChild(countsRow(exact.length, contains.length));
  for (const raga of exact) resultsEl.appendChild(renderRow(raga, orderBadge(raga, "exact"), matched, true));
  for (const raga of contains) resultsEl.appendChild(renderRow(raga, orderBadge(raga, "partial"), matched, false));
}

// Both matchOrdered() and matchOrderedSeparate() annotate matchedArohana/
// matchedAvarohana on every returned raga, so this same suffix logic
// produces a consistent badge shape ("exact (arohana)", "partial (both)",
// ...) regardless of combined vs. separate layout mode.
//
// `tier` is also the badge's *colour*, which is the whole point: green means
// exact and nothing else. Order mode used to hand "partial order (arohana)"
// the identical green that "exact" wears everywhere else, so the one visual
// cue that's supposed to mean "this is precisely what you asked for" was
// being spent on rows that only partly matched.
function orderBadge(raga, tier) {
  const suffix =
    raga.matchedArohana && raga.matchedAvarohana
      ? " (both)"
      : raga.matchedArohana
        ? " (arohana)"
        : raga.matchedAvarohana
          ? " (avarohana)"
          : "";
  return { text: tier + suffix, tier };
}

// The notes the user has actually pressed, for highlighting them within
// each result's displayed scale. In combined mode one set applies to both
// directions; in separate mode each direction highlights against its own
// (possibly empty/unconstrained) selection only.
function currentMatchedSets() {
  if (layoutMode === "combined") {
    const s = new Set(combined);
    return { arohana: s, avarohana: s };
  }
  return { arohana: new Set(arohanaSel), avarohana: new Set(avarohanaSel) };
}

function emptyRow(text) {
  const li = document.createElement("li");
  li.className = "empty";
  li.textContent = text;
  return li;
}

// Renders one direction's scale as space-separated labels, wrapping notes
// present in `matchedDegrees` (the user's own pressed notes) in a mild
// highlight - lets you see at a glance which notes you asked for versus
// which ones the raga adds beyond that.
function scaleHtml(notes, matchedDegrees) {
  return notes
    .map((n) => {
      // Every label is wrapped, matched or not: `swara-code` is what carries
      // the swara face, and the "Arohana:" prose around these must not get it.
      const cls = matchedDegrees.has(n.degree) ? "swara-code note-match" : "swara-code";
      return `<span class="${cls}">${noteLabel(n, labelPrefs)}</span>`;
    })
    .join(" ");
}

// `badge` is `{ text, tier }` or null. `tier` picks the colour and is the
// only thing that may turn a badge green: "exact" is green, anything else is
// muted. `tint` controls the row's own background highlight independently -
// a partial order-mode match carries a badge but shouldn't be tinted like a
// true exact match. `loadable` adds the "Load swaras" button; only the name
// search passes it (see loadRagaIntoKeyboard) - in the note-based results the
// selection is the thing you just built by hand, and a button that silently
// replaced it with a neighbouring raga's scale would be a trap.
function renderRow(raga, badge, matched, tint = Boolean(badge && badge.tier === "exact"), { loadable = false } = {}) {
  const li = document.createElement("li");
  li.className = "result-row" + (tint ? " exact" : "");

  const playBtn = document.createElement("button");
  playBtn.type = "button";
  playBtn.className = "result-play-btn";
  const rowPlayer = makePlayer({
    // This raga's own scale, not the user's current selection - arohana
    // then avarohana, with the same turnaround pause used everywhere else
    // (see buildCombinedSequence), so the timing feels identical to the
    // main Play controls above. One-shot: getLoop always false, so it
    // stops itself after the single arohana+avarohana pass.
    buildSequence: () => ragaSequenceInKey(raga),
    buttonEls: playBtn,
    getLoop: () => false,
    onStart: () => {
      stopScalePreview();
      if (activeRowPlayer && activeRowPlayer !== rowPlayer) activeRowPlayer.stop();
      activeRowPlayer = rowPlayer;
      combinedPlayer.stop();
      stopAllSeparatePlayers();
    },
    renderState: setResultPlayButtonState,
  });

  const name = document.createElement("span");
  name.className = "raga-name";
  name.textContent = raga.name;
  // Every result list puts melakartas first (see byMelakartaThenName in
  // ragas.js). The order alone doesn't say why, so each one says so.
  if (raga.is_melakarta) {
    const melaBadge = document.createElement("span");
    melaBadge.className = "badge badge-mela";
    melaBadge.textContent = "melakarta";
    name.appendChild(melaBadge);
  }
  if (badge) {
    const el = document.createElement("span");
    el.className = `badge badge-${badge.tier}`;
    el.textContent = badge.text;
    name.appendChild(el);
  }
  // A raga can be listed with more than one scale, and the matchers search all
  // of them (see ragaForms in ragas.js). When an alternative is what matched,
  // the row shows and plays *that* scale - so it has to say so. This is the
  // one case where staying quiet would actively mislead: the row would look
  // like the raga's usual scale while showing something else.
  if (raga.matchedVariant) {
    const el = document.createElement("span");
    el.className = "badge badge-variant";
    el.textContent = "variant scale";
    el.title = "This raga is listed with more than one scale; the swaras you "
      + "played match this alternative rather than the one usually given.";
    name.appendChild(el);
  }

  const mela = document.createElement("span");
  mela.className = "mela-context";
  mela.textContent = melaContext(raga, melaNames);

  const scales = document.createElement("div");
  scales.className = "scales";
  scales.innerHTML = `Arohana: ${scaleHtml(raga.arohana, matched.arohana)}  |  Avarohana: ${scaleHtml(raga.avarohana, matched.avarohana)}`;

  li.appendChild(playBtn);
  li.appendChild(name);
  li.appendChild(mela);
  if (loadable) li.appendChild(loadButton(raga));
  li.appendChild(scales);
  return li;
}

// --- Raga name search ----------------------------------------------------
// A second top-level view (#search-view, swapped in for #main-view - see
// openSearchView()/closeSearchView()), not part of the note-based finder
// above. Free-text search over raga names, reusing renderRow() as-is for
// the results - same look (name, mela context, per-row Play/Stop preview,
// Arohana/Avarohana) as the note-based finder's own list, and the same
// activeRowPlayer mutual exclusion, since it's literally the same function
// and the same module-level player registry.

// No note-based highlighting applies to a name search's results (there's
// no pressed-note selection to compare against here) - renderRow() still
// needs a `matched` argument, so this is just permanently empty sets.
function noMatchedSets() {
  return { arohana: new Set(), avarohana: new Set() };
}

// Ranking is pure and depends on nothing but the query, so the one search a
// keystroke needs is shared by the results list and the suggestion dropdown
// rather than run twice.
let lastSearchQuery = null;
let lastSearchMatches = [];

function matchesFor(query) {
  if (query !== lastSearchQuery) {
    lastSearchQuery = query;
    lastSearchMatches = searchByName(nameIndex, query);
  }
  return lastSearchMatches;
}

function performRagaSearch() {
  stopActiveRowPreview(); // results are rebuilt from scratch below - see renderResults()'s own use of this
  searchResultsEl.innerHTML = "";

  const query = ragaSearchInput.value;
  if (!query.trim()) {
    searchPromptEl.hidden = false;
    return;
  }
  searchPromptEl.hidden = true;

  const matches = matchesFor(query);
  if (matches.length === 0) {
    searchResultsEl.appendChild(emptyRow(`No ragas match "${query.trim()}", even approximately.`));
    return;
  }

  const empty = noMatchedSets();
  const top = matches[0];
  // "Clear match" per the human's spec: an exact name match tops the list -
  // already true from searchByName()'s own tier-0 sort, so this only decides
  // whether to badge it as such. Exactness is judged on the folded forms
  // (see isExactNameMatch), so "Thodi" counts as naming Todi outright.
  const isClearMatch = isExactNameMatch(top, query);
  matches.forEach((raga, i) => {
    const badge = i === 0 && isClearMatch ? { text: "exact name", tier: "exact" } : null;
    searchResultsEl.appendChild(renderRow(raga, badge, empty, Boolean(badge), { loadable: true }));
  });

  // Related ragas: everything else sharing the top match's parent mela
  // ("the same group of notes," per the human's framing) - a plain-text
  // section heading, not a result row, dividing it from the name matches
  // above.
  const related = relatedByMela(ragas, top, matches);
  if (related.length > 0) {
    const heading = document.createElement("li");
    heading.className = "search-related-heading";
    heading.textContent = `Related ragas - same parent scale as ${top.name} (${melaContext(top, melaNames)})`;
    searchResultsEl.appendChild(heading);
    for (const raga of related) {
      searchResultsEl.appendChild(renderRow(raga, null, empty, false, { loadable: true }));
    }
  }
}

// --- Loading a found raga onto the keyboard -------------------------------
// The way back from "I know its name" to the note-based finder: take the
// raga's own scale, put it in the input widget, and go there.

// Whether a raga's avarohana is just its arohana read backwards - which is
// exactly the question of which layout mode can hold it without losing
// anything. If it is, one combined selection says everything there is to
// say. If it isn't (a vakra turn, or a note used in only one direction),
// the two directions have to be kept apart, and that is what separate mode
// is for.
function isSymmetricScale(raga) {
  const aro = raga.arohana.map((n) => n.degree);
  const ava = raga.avarohana.map((n) => n.degree);
  if (aro.length !== ava.length) return false;
  return aro.every((degree, i) => degree === ava[ava.length - 1 - i]);
}

// Order mode records a sequence, so repeats and order are the point and the
// stored scale goes in untouched. Outside it a selection is a set, so a vakra
// scale's repeated note would otherwise arrive as two selections of one note.
function selectionFrom(degrees) {
  return orderMode ? degrees : [...new Set(degrees)];
}

function loadRagaIntoKeyboard(raga) {
  stopAllPlayback();
  clearInsertPoint();
  // Free play freezes the selection and hides the results entirely, so a
  // scale loaded into it would land somewhere invisible. Asking for a
  // specific raga's swaras is the stronger intent, so it wins.
  if (freePlay) {
    freePlay = false;
    freePlayToggle.checked = false;
  }

  layoutMode = isSymmetricScale(raga) ? "combined" : "separate";
  const aro = raga.arohana.map((n) => n.degree);
  if (layoutMode === "combined") {
    replaceList(combined, selectionFrom(aro));
    transposeState.combined = { steps: 0, offset: 0 };
  } else {
    replaceList(arohanaSel, selectionFrom(aro));
    replaceList(avarohanaSel, selectionFrom(raga.avarohana.map((n) => n.degree)));
    transposeState.arohana = { steps: 0, offset: 0 };
    transposeState.avarohana = { steps: 0, offset: 0 };
  }
  // The Layout radio is the control of record for layoutMode everywhere else
  // in the app, so it has to be brought along or the page would contradict
  // itself about which mode it is in.
  document.querySelector(`input[name="layout-mode"][value="${layoutMode}"]`).checked = true;

  updateLayoutVisibility();
  renderInputs();
  renderResults();
  // Whichever view the button was in - the name search's results or the
  // chakra chart's detail panel - the answer now lives on the main page, and
  // showView() scrolls to the top of it (both of those lists are long, and
  // the loaded scale is at the top of the page it just swapped to).
  showView("main");
}

function loadButton(raga) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "result-load-btn";
  btn.textContent = "Load swaras";
  btn.title = isSymmetricScale(raga)
    ? `Put ${raga.name}'s swaras on the keyboard (combined - its avarohana is its arohana reversed)`
    : `Put ${raga.name}'s swaras on the keyboard (separate arohana/avarohana - they differ)`;
  btn.addEventListener("click", () => loadRagaIntoKeyboard(raga));
  return btn;
}

// --- Name suggestions: the combobox dropdown -----------------------------
// Our own listbox, not a native <datalist> - see index.html for why. Two
// things fill it: the ranked matches for whatever has been typed, and (from
// the drop-arrow) the full list of every name in the dataset, which is the
// one thing the ranked view can't offer, since it needs a query first.

const SUGGESTION_LIMIT = 12;

// Names repeat across the dataset (several distinct ragas share a name under
// different melas - see relatedByMela's note), and a suggestion offers a
// *name* to search for rather than picking one specific raga, so the list is
// de-duplicated by name. The search below is what disambiguates: it still
// lists every raga owning that name.
let allNameItems = [];
let suggestionItems = []; // what's listed right now, in listed order
let activeSuggestion = -1; // keyboard cursor into it; -1 = nothing highlighted

function buildNameList() {
  const byName = new Map();
  for (const raga of ragas) {
    const seen = byName.get(raga.name);
    if (seen) seen.isMelakarta = seen.isMelakarta || Boolean(raga.is_melakarta);
    else byName.set(raga.name, { name: raga.name, isMelakarta: Boolean(raga.is_melakarta) });
  }
  allNameItems = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function suggestionsForQuery() {
  const query = ragaSearchInput.value;
  if (!query.trim()) return [];
  const items = [];
  const seen = new Set();
  for (const raga of matchesFor(query)) {
    if (seen.has(raga.name)) continue;
    seen.add(raga.name);
    items.push({ name: raga.name, isMelakarta: Boolean(raga.is_melakarta) });
    if (items.length === SUGGESTION_LIMIT) break;
  }
  return items;
}

function suggestionsOpen() {
  return !suggestListEl.hidden;
}

function renderSuggestions(items) {
  suggestionItems = items;
  activeSuggestion = -1;
  suggestListEl.innerHTML = "";
  ragaSearchInput.removeAttribute("aria-activedescendant");

  if (items.length === 0) {
    const li = document.createElement("li");
    li.className = "suggestion-empty";
    li.textContent = "No raga names close to that.";
    suggestListEl.appendChild(li);
    return;
  }

  // Built as nodes rather than an innerHTML string: names carry braces,
  // brackets and one "&amp;" straight from the source data, and textContent
  // is the only way to put them on the page that can't be misread as markup.
  const frag = document.createDocumentFragment();
  items.forEach((item, i) => {
    const li = document.createElement("li");
    li.className = "suggestion";
    li.id = `raga-suggestion-${i}`;
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", "false");
    const name = document.createElement("span");
    name.textContent = item.name;
    li.appendChild(name);
    if (item.isMelakarta) {
      const tag = document.createElement("span");
      tag.className = "suggestion-tag";
      tag.textContent = "melakarta";
      li.appendChild(tag);
    }
    frag.appendChild(li);
  });
  suggestListEl.appendChild(frag);
}

function setSuggestionsExpanded(open) {
  suggestListEl.hidden = !open;
  ragaSearchInput.setAttribute("aria-expanded", String(open));
  suggestToggleBtn.setAttribute("aria-expanded", String(open));
  suggestToggleBtn.classList.toggle("is-open", open);
}

function openSuggestions(items) {
  renderSuggestions(items);
  setSuggestionsExpanded(true);
}

function closeSuggestions() {
  setSuggestionsExpanded(false);
  suggestListEl.innerHTML = "";
  suggestionItems = [];
  activeSuggestion = -1;
  ragaSearchInput.removeAttribute("aria-activedescendant");
}

function setActiveSuggestion(index) {
  const options = suggestListEl.querySelectorAll(".suggestion");
  if (options.length === 0) return;
  const clamped = ((index % options.length) + options.length) % options.length;
  options.forEach((el, i) => {
    const on = i === clamped;
    el.classList.toggle("is-active", on);
    el.setAttribute("aria-selected", String(on));
  });
  activeSuggestion = clamped;
  const active = options[clamped];
  ragaSearchInput.setAttribute("aria-activedescendant", active.id);
  active.scrollIntoView({ block: "nearest" });
}

function chooseSuggestion(index) {
  const item = suggestionItems[index];
  if (!item) return;
  ragaSearchInput.value = item.name;
  closeSuggestions();
  // Setting .value in script fires no `input` event, so the search that
  // normally rides on one has to be run by hand.
  performRagaSearch();
  ragaSearchInput.focus();
}

ragaSearchInput.addEventListener("input", () => {
  performRagaSearch();
  const items = suggestionsForQuery();
  if (items.length > 0) openSuggestions(items);
  else closeSuggestions();
});

ragaSearchInput.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault(); // or the caret jumps to either end of the input
    if (!suggestionsOpen()) {
      openSuggestions(ragaSearchInput.value.trim() ? suggestionsForQuery() : allNameItems);
      setActiveSuggestion(e.key === "ArrowDown" ? 0 : -1);
      return;
    }
    setActiveSuggestion(activeSuggestion + (e.key === "ArrowDown" ? 1 : -1));
  } else if (e.key === "Enter") {
    if (suggestionsOpen() && activeSuggestion >= 0) {
      e.preventDefault();
      chooseSuggestion(activeSuggestion);
    } else {
      closeSuggestions(); // Enter with nothing highlighted just means "done typing"
    }
  } else if (e.key === "Escape") {
    if (suggestionsOpen()) {
      e.stopPropagation();
      closeSuggestions();
    }
  } else if (e.key === "Tab") {
    closeSuggestions();
  }
});

// mousedown, not click: the input would otherwise lose focus (and on iOS the
// keyboard would drop) between press and release, and a suggestion list that
// closes itself out from under the tap never registers the click at all.
suggestListEl.addEventListener("mousedown", (e) => e.preventDefault());

suggestListEl.addEventListener("click", (e) => {
  const option = e.target.closest(".suggestion");
  if (!option) return;
  chooseSuggestion([...suggestListEl.querySelectorAll(".suggestion")].indexOf(option));
});

// The whole list, which is what the arrow is for: a query can only ever
// suggest against itself, and "show me what there is" has no query. If
// something *is* typed, the nearest match is highlighted and scrolled to, so
// the arrow stays useful mid-word rather than dumping you at "Abheri".
suggestToggleBtn.addEventListener("click", () => {
  if (suggestionsOpen()) {
    closeSuggestions();
    return;
  }
  openSuggestions(allNameItems);
  const best = suggestionsForQuery()[0];
  if (best) setActiveSuggestion(allNameItems.findIndex((item) => item.name === best.name));
  ragaSearchInput.focus();
});

document.addEventListener("pointerdown", (e) => {
  if (!suggestionsOpen()) return;
  if (e.target instanceof Element && e.target.closest(".search-combobox")) return;
  closeSuggestions();
});

// --- View switching ------------------------------------------------------
// Three top-level views, exactly one visible at a time. The reference view
// used to be a fixed-position overlay floating over a still-live main view,
// which is why it could get away with open/close pairs that each knew only
// about themselves; now that it is a full page (the chakra chart needs the
// width - see specs/04-melakarta-chakra-wheel.md), "open search" and "close
// reference" would both have an opinion about whether #main-view is visible,
// and they would race. One function owns that instead.
//
// Switching always stops playback, same as switching layout mode or muting
// does: two views' worth of Play buttons left running into each other would
// be confusing, not useful. That applies to the reference view too now - it
// stopped being the case that "you have not gone anywhere".
const VIEWS = { main: () => mainView, search: () => searchView, settings: () => settingsView };

function showView(name) {
  stopAllPlayback();
  closeSuggestions(); // positioned against the search input, which may be on its way out
  for (const [key, el] of Object.entries(VIEWS)) el().hidden = key !== name;
  // Belt and braces with the `aspect-ratio` in style.css, against the same
  // iOS failure: the chart is built during init(), while this view is still
  // hidden, so its one and only layout happened inside a display:none subtree.
  // Redrawing here means the SVG is always built with the view on screen and
  // a real containing block to measure against. Cheap - about a hundred
  // nodes - and it keeps the current selection.
  if (name === "settings") melaChart?.refresh();
  if (name === "search") ragaSearchInput.focus();
  else window.scrollTo({ top: 0 });
}

function openSearchView() {
  showView("search");
}

function closeSearchView() {
  showView("main");
}

searchOpenBtn.addEventListener("click", openSearchView);
searchBackBtn.addEventListener("click", () => showView("main"));

settingsOpenBtn.addEventListener("click", () => showView("settings"));
settingsBackBtn.addEventListener("click", () => showView("main"));

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !settingsView.hidden) showView("main");
});

// --- Play / loop -----------------------------------------------------

// In order mode, play exactly the recorded click sequence (that's the
// whole point - confirming the zigzag by ear). Otherwise sort ascending or
// descending, our best guess at "arohana-style" / "avarohana-style". Only
// ever the notes actually selected - no auto-added bookend note (an
// earlier version always appended/prepended top S here even when it
// wasn't selected, on the reasoning that "every scale runs Sa to Sa" -
// wrong: it played a note the user never asked for).
function orderedOrSorted(list, ascending) {
  if (orderMode) return [...list];
  return [...list].sort((a, b) => (ascending ? a - b : b - a));
}

// `pauseAfterIndex`: the sequence index after which makePlayer should
// insert the longer LOOP_END_DELAY_MS pause instead of the usual
// NOTE_GAP_MS - -1 means no special pause (a single-direction sequence,
// used by the separate-mode Arohana/Avarohana players).
function buildCombinedSequence() {
  if (combined.length === 0) return { sequence: [], pauseAfterIndex: -1 };
  const asc = orderedOrSorted(combined, true);
  // Order mode has no real "sort descending" to fall back on -
  // orderedOrSorted() always returns the raw click order regardless of
  // the `ascending` flag, so building "desc" the same way as `asc` would
  // just replay the forward pass again instead of reversing it. The
  // return trip in order mode is the *reverse of what was recorded*,
  // matching how the forward pass is "exactly as recorded" too.
  const desc = orderMode ? [...combined].reverse() : orderedOrSorted(combined, false);
  // Both passes play in full, including their own first note - the
  // return explicitly (re-)strikes the turnaround note (the selection's
  // highest note, in the non-order case) to open its own phrase, rather
  // than silently continuing from the note the ascending pass already
  // ended on. asc's last note and desc's first note are always identical
  // (the same value/note, from opposite ends of the same list, in both
  // modes) - so this is a deliberate repeat now that there's a pause
  // separating the two passes, not a bug.
  const sequence = soundingSequence(combined, [...asc, ...desc]);
  return { sequence, pauseAfterIndex: asc.length - 1 };
}

// Icon + color both flip with state (green "Play" <-> red "Stop"), same
// convention as the Mute button's icon+label swap.
function setPlayButtonState(buttonEl, playing) {
  buttonEl.innerHTML = playing ? `${ICON_STOP}<span>Stop</span>` : `${ICON_PLAY}<span>Play</span>`;
  buttonEl.classList.toggle("is-playing", playing);
}

// Icon-only variant for the small per-result preview button in the results
// list - there's no room for a text label at that size, so aria-label
// carries what the visible "Play"/"Stop" span does on the full-size button.
function setResultPlayButtonState(buttonEl, playing) {
  buttonEl.innerHTML = playing ? ICON_STOP : ICON_PLAY;
  buttonEl.classList.toggle("is-playing", playing);
  buttonEl.setAttribute("aria-label", playing ? "Stop" : "Play");
}

// `buttonEls` accepts either one button or several - the Arohana/Avarohana
// "Play both" joint player (see below) mirrors its state across both
// direction buttons at once, rather than owning just one. `isActive` lets
// more than one player instance share the same button(s): each listener
// checks it before acting, so exactly one player responds to a given click
// (used to switch a button between driving its own solo player and the
// joint player depending on the "Play both" toggle, without either
// listener needing to know about the other).
function makePlayer({ buildSequence, buttonEls, getLoop, onStart, onStop, renderState = setPlayButtonState, isActive = () => true }) {
  const els = Array.isArray(buttonEls) ? buttonEls : [buttonEls];
  let playing = false;
  let token = 0;

  function stop() {
    token++;
    playing = false;
    if (onStop) onStop();
    els.forEach((el) => renderState(el, false));
  }

  function start() {
    const { sequence, pauseAfterIndex } = buildSequence();
    if (sequence.length === 0) return;
    if (onStart) onStart();

    playing = true;
    els.forEach((el) => renderState(el, true));
    const myToken = ++token;
    let i = 0;

    function step() {
      if (myToken !== token) return;
      if (i >= sequence.length) {
        if (!getLoop()) {
          stop();
          return;
        }
        i = 0;
        setTimeout(step, LOOP_END_DELAY_MS); // pause at the loop boundary before the pass repeats
        return;
      }
      playPianoTone(sequence[i]);
      const atTurnaround = i === pauseAfterIndex;
      i++;
      setTimeout(step, atTurnaround ? LOOP_END_DELAY_MS : NOTE_GAP_MS);
    }
    step();
  }

  els.forEach((el) =>
    el.addEventListener("click", () => {
      if (!isActive()) return; // some other player currently owns this button - see isActive above
      playing ? stop() : start();
    }),
  );
  els.forEach((el) => renderState(el, false)); // icon+color from the start, not just after first click
  return { start, stop, isPlaying: () => playing };
}

// Keeps a running Play in sync with live edits - adding/removing a note,
// or removing a specific recorded entry via its order badge - instead of
// finishing out a now-stale snapshot of what used to be selected.
// Restarting from the top of the freshly rebuilt sequence is the simplest
// predictable behavior here: once the underlying list has changed there's
// no well-defined "current position" to preserve mid-sequence anyway.
function restartIfPlaying(player) {
  if (player.isPlaying()) {
    player.stop();
    player.start();
  }
}

const combinedPlayer = makePlayer({
  buildSequence: buildCombinedSequence,
  buttonEls: playBtn,
  getLoop: () => loopToggle.checked,
  onStart: () => {
    stopActiveRowPreview();
    stopAllSeparatePlayers();
  },
});

// Separate mode has three players sharing the Arohana/Avarohana Play
// buttons: two solo players (each drives just its own button, active
// whenever "Play both" is unchecked) and one joint player (drives both
// buttons together, active whenever "Play both" is checked). Each button's
// two candidate players both attach a listener (via makePlayer's `isActive`
// gate) but only the currently-active one acts on a given click, so a click
// always reaches exactly one player - never both, never neither.
let arohanaSoloPlayer, avarohanaSoloPlayer, jointPlayer;

arohanaSoloPlayer = makePlayer({
  buildSequence: () => ({ sequence: soundingSequence(arohanaSel, orderedOrSorted(arohanaSel, true)), pauseAfterIndex: -1 }),
  buttonEls: arohanaPlayBtn,
  getLoop: () => arohanaLoopToggle.checked,
  isActive: () => !playBothToggle.checked,
  onStart: () => {
    avarohanaSoloPlayer.stop();
    combinedPlayer.stop();
    stopActiveRowPreview();
  },
});
avarohanaSoloPlayer = makePlayer({
  buildSequence: () => ({ sequence: soundingSequence(avarohanaSel, orderedOrSorted(avarohanaSel, false)), pauseAfterIndex: -1 }),
  buttonEls: avarohanaPlayBtn,
  getLoop: () => avarohanaLoopToggle.checked,
  isActive: () => !playBothToggle.checked,
  onStart: () => {
    arohanaSoloPlayer.stop();
    combinedPlayer.stop();
    stopActiveRowPreview();
  },
});
// Plays Arohana's ascending pass then Avarohana's descending pass, joined
// by the same LOOP_END_DELAY_MS turnaround pause combined mode uses at its
// own ascending/descending seam - not a separately-tuned value. Mirrors
// both direction buttons together (same Play/Stop state, since either one
// starts/stops this same single sequence rather than its own). Loops on
// Arohana's own Loop toggle only - Avarohana's Play/Loop group is hidden
// disabled while joined (see updateControlAvailability()), so its Loop
// checkbox isn't a visible control at that point and reading it would risk
// a stale/hidden checked state silently overriding the one Loop toggle the
// user can actually see and use.
jointPlayer = makePlayer({
  buildSequence: () => {
    // Each direction by its own offset: with "Transpose both" off the two can
    // have been rotated by different amounts, and each has to sound where its
    // own wheel says it sits.
    const arohanaDegrees = soundingSequence(arohanaSel, orderedOrSorted(arohanaSel, true));
    const avarohanaDegrees = soundingSequence(avarohanaSel, orderedOrSorted(avarohanaSel, false));
    if (arohanaDegrees.length === 0 && avarohanaDegrees.length === 0) return { sequence: [], pauseAfterIndex: -1 };
    return { sequence: [...arohanaDegrees, ...avarohanaDegrees], pauseAfterIndex: arohanaDegrees.length - 1 };
  },
  buttonEls: [arohanaPlayBtn, avarohanaPlayBtn],
  getLoop: () => arohanaLoopToggle.checked,
  isActive: () => playBothToggle.checked,
  onStart: () => {
    combinedPlayer.stop();
    stopActiveRowPreview();
  },
});

function stopAllSeparatePlayers() {
  arohanaSoloPlayer.stop();
  avarohanaSoloPlayer.stop();
  jointPlayer.stop();
}

// Everything that can be making sound, at once. Used wherever a control
// changes *which* Play/Loop controls are in charge, rather than merely
// editing what they'd play: switching layout mode hands over from the
// combined block's Play to Arohana/Avarohana's (or back), switching input
// style swaps out the widget a sequence was started from, and toggling
// "Record note order" or "Free play" changes what Play even means. In every
// one of those cases a still-running player is driving a button the user can
// no longer see - a looped Arohana that kept going after a switch to
// Combined had no visible Stop at all, and the Combined Play button showed
// "Play" while sound was coming out.
function stopAllPlayback() {
  combinedPlayer.stop();
  stopAllSeparatePlayers();
  stopActiveRowPreview(); // also covers the wheel's centre-summary preview
}

function restartSeparatePlayers() {
  restartIfPlaying(arohanaSoloPlayer);
  restartIfPlaying(avarohanaSoloPlayer);
  restartIfPlaying(jointPlayer);
}

// Switching "Play both" mid-playback has no well-defined carry-over state -
// a solo pass and the joint pass aren't the same sequence - so stop
// everything cleanly rather than trying to preserve a running sequence
// across the mode change.
playBothToggle.addEventListener("change", () => {
  stopAllSeparatePlayers();
  updateControlVisibility();
});

// --- Per-result raga preview -------------------------------------------
// Only one result row's preview plays at a time (and it stops if any of the
// main Play buttons above start), same "one stream at a time" rule the
// three players above already follow amongst themselves.
let activeRowPlayer = null;

function stopActiveRowPreview() {
  stopScalePreview();
  if (activeRowPlayer) {
    activeRowPlayer.stop();
    activeRowPlayer = null;
  }
}

// The swara wheel's centre summary doubles as a play button for the top
// match. It can't use makePlayer: that binds Play/Stop state to a button
// element, and this one is destroyed and rebuilt on every renderInputs() -
// so instead it's a plain one-shot pass over the raga's own scale, arohana
// then avarohana with the usual turnaround pause, cancelled by token the
// same way makePlayer cancels its own timer chain. Folded into
// stopActiveRowPreview above so every existing "stop whatever's playing"
// call site already covers it.
let scalePreviewToken = 0;

function stopScalePreview() {
  scalePreviewToken++;
}

// A found raga's own scale, as pitches: arohana then avarohana, with the
// turnaround index the pause is taken from (see buildCombinedSequence).
// `saOffset` is where the raga's own degree 0 is put, in semitones from
// middle C - the one thing the two callers below disagree about.
function ragaSequenceAt(raga, saOffset) {
  const arohanaDegrees = raga.arohana.map((n) => n.degree + saOffset);
  const avarohanaDegrees = raga.avarohana.map((n) => n.degree + saOffset);
  return { sequence: [...arohanaDegrees, ...avarohanaDegrees], pauseAfterIndex: arohanaDegrees.length - 1 };
}

// For a raga found in a *list* - the results rows, the name search, the chakra
// chart's detail panel. Heard from its own Sa with only the Key applied, never
// a gṛha bhēdam offset, so that two results can be compared with each other
// rather than with whatever selection led to them.
function ragaSequenceInKey(raga) {
  return ragaSequenceAt(raga, keySemitone);
}

// For the swara wheel's centre summary, which is a different question with a
// different right answer, even though it names the same kind of thing.
//
// That name is what the *selection under it* currently reads as, and after a
// gṛha bhēdam the selection has been rebased so the new tonic is degree 0 -
// which is the very degree 0 the matched raga's scale is written against. So
// its notes are the notes on screen, and it has to sound from where the tonic
// was moved to, exactly as that block's own Play button does. Playing it from
// the unshifted Sa instead would name the rotation and then refuse to let you
// hear it, which is the same eye-and-ear disagreement the shift itself was
// fixed for.
//
// With no shift `saOffsetForList` is the identity on the Key, so outside gṛha
// bhēdam this and ragaSequenceInKey are the same sequence.
function ragaSequenceAtTonic(raga, list) {
  return ragaSequenceAt(raga, saOffsetForList(list));
}

// `list` picks which of the two above is used: the selection whose wheel the
// summary sits in, or null for a result row.
function playScaleOnce(raga, list = null) {
  stopActiveRowPreview();
  combinedPlayer.stop();
  stopAllSeparatePlayers();

  const { sequence, pauseAfterIndex } = list ? ragaSequenceAtTonic(raga, list) : ragaSequenceInKey(raga);
  const myToken = ++scalePreviewToken;
  let i = 0;

  (function step() {
    if (myToken !== scalePreviewToken || i >= sequence.length) return;
    playPianoTone(sequence[i]);
    const atTurnaround = i === pauseAfterIndex;
    i++;
    setTimeout(step, atTurnaround ? LOOP_END_DELAY_MS : NOTE_GAP_MS);
  })();
}

resetBtn.addEventListener("click", () => {
  combinedPlayer.stop();
  combined.length = 0;
  clearInsertPoint();
  // The baseline went with the notes - there's nothing left to be
  // transposed *from*.
  transposeState.combined = { steps: 0, offset: 0 };
  renderInputs();
  renderResults();
});
arohanaResetBtn.addEventListener("click", () => {
  stopAllSeparatePlayers();
  arohanaSel.length = 0;
  clearInsertPoint();
  transposeState.arohana = { steps: 0, offset: 0 };
  renderInputs();
  renderResults();
});
avarohanaResetBtn.addEventListener("click", () => {
  stopAllSeparatePlayers();
  avarohanaSel.length = 0;
  clearInsertPoint();
  transposeState.avarohana = { steps: 0, offset: 0 };
  renderInputs();
  renderResults();
});

// --- Mute ---------------------------------------------------------------
// Mute only ever touches the play/loop sub-controls, never Clear and never
// a block's visibility - silencing the app doesn't take the scale away.

function renderMuteButton() {
  muteBtn.innerHTML = muted ? `${ICON_MUTED}<span>Unmute</span>` : `${ICON_UNMUTED}<span>Mute</span>`;
  muteBtn.setAttribute("aria-pressed", String(muted));
  muteBtn.classList.toggle("active", muted);
}

// Greys a control and takes it out of play without moving it. Everything in
// the Controls panel and every per-block control goes through this: an
// option that appears, disappears and reflows its neighbours as other
// options change is far harder to learn than one that simply sits there
// looking unavailable.
function setControlEnabled(el, enabled) {
  el.classList.toggle("control-disabled", !enabled);
  for (const control of el.querySelectorAll("input, button")) control.disabled = !enabled;
  if (el.matches("input, button")) el.disabled = !enabled;
}

function updateControlAvailability() {
  const free = inFreePlayMode();
  const separate = layoutMode === "separate" && !free;

  // Free play is Piano-only: Buttons and the Wheel have no "just sound the
  // note" reading - a Buttons tap is a selection and nothing else, and the
  // Wheel's sweep is inherently about building a scale.
  setControlEnabled(freePlayLabel, inputStyle === "piano");
  // While free play is on there is no scale being built, so everything that
  // shapes one steps back rather than stepping out.
  setControlEnabled(layoutGroup, !free);
  setControlEnabled(orderModeLabel, !free);
  setControlEnabled(playBothLabel, separate && !muted);
  setControlEnabled(transposeBothLabel, separate);

  setControlEnabled(combinedControls, !muted && !free);
  setControlEnabled(arohanaControls, !muted && !free);
  // Avarohana's Play/Loop is driven by Arohana's while "Play both" is on -
  // its own buttons would be a second handle on the same single sequence.
  setControlEnabled(avarohanaControls, !muted && !free && !playBothToggle.checked);
  setControlEnabled(resetBtn, !free);
  setControlEnabled(arohanaResetBtn, !free);
  setControlEnabled(avarohanaResetBtn, !free);

  renderTransposeRows();
}

// Kept as the single entry point every caller already uses: the free-play
// dressing (a title, and a hook for the stylesheet) plus the availability
// pass that does the real work.
function updateControlVisibility() {
  document.body.classList.toggle("free-play-mode", inFreePlayMode());
  combinedTitle.textContent = inFreePlayMode() ? "Piano" : "Scale";
  updateControlAvailability();
}

function applyMuted() {
  setMuted(muted);
  updateControlVisibility();
  renderMuteButton();
  if (muted) stopAllPlayback();
}

muteBtn.addEventListener("click", () => {
  muted = !muted;
  applyMuted();
});

// --- Mode controls -----------------------------------------------------

document.querySelectorAll('input[name="input-style"]').forEach((radio) => {
  radio.addEventListener("change", (e) => {
    if (e.target.checked) {
      stopAllPlayback();
      inputStyle = e.target.value;
      updateLayoutVisibility(); // free play is Piano-only, and it owns the layout while on
      renderInputs();
      renderResults(); // the empty-state prompt names the current style
    }
  });
});

// The one thing that genuinely swaps rather than greys: you can't show the
// combined widget and the two direction widgets at once. Free play pins it to
// the combined block - it's one keyboard, not a scale being assembled in two
// directions - while leaving the Layout radio's own value alone, so leaving
// free play returns to whichever layout was in use.
function updateLayoutVisibility() {
  const free = inFreePlayMode();
  combinedBlock.hidden = !free && layoutMode !== "combined";
  separateContainer.hidden = free || layoutMode !== "separate";
  updateControlVisibility();
}

// Switching layout carries the work across instead of stranding it in the
// widget you just left.
//
// Combined -> Separate: what you'd assembled becomes the Arohana, and
// Avarohana starts empty. It can't sensibly be both directions at once - a
// combined selection says "this raga uses these notes", with no claim about
// which way - and seeding Avarohana with the same set would silently assert
// a symmetry the user never stated. Empty is unconstrained, which is the
// honest starting point (see matchSeparate).
//
// Separate -> Combined: both directions merge, which is exactly what the
// combined view means. Deduplicated normally; in order mode the two
// recorded sequences are concatenated as-is, ascending phrase then
// descending, since deduplicating there would destroy the very thing being
// recorded.
//
// The transpose memory travels with the notes. Combined -> Separate is a
// single source, so Arohana inherits it exactly and its Piano shows the
// identical picture Combined just did; the merge takes Arohana's, the
// direction whose notes lead the merged list.
function inheritSelection(from, to) {
  if (from === "combined" && to === "separate") {
    replaceList(arohanaSel, [...combined]);
    avarohanaSel.length = 0;
    transposeState.arohana = { ...transposeState.combined };
    transposeState.avarohana = { steps: 0, offset: 0 };
  } else if (from === "separate" && to === "combined") {
    const merged = [...arohanaSel, ...avarohanaSel];
    replaceList(combined, orderMode ? merged : [...new Set(merged)]);
    transposeState.combined = { ...transposeState.arohana };
  }
}

document.querySelectorAll('input[name="layout-mode"]').forEach((radio) => {
  radio.addEventListener("change", (e) => {
    if (e.target.checked) {
      stopAllPlayback();
      clearInsertPoint();
      if (e.target.value !== layoutMode) inheritSelection(layoutMode, e.target.value);
      layoutMode = e.target.value;
      updateLayoutVisibility();
      renderInputs();
      renderResults();
    }
  });
});

transposeBothToggle.addEventListener("change", () => {
  transposeBoth = transposeBothToggle.checked;
  updateControlAvailability();
});

orderModeToggle.addEventListener("change", () => {
  // Order mode changes what Play plays - the recorded click order rather
  // than the selection sorted - so a sequence already running would be
  // finishing out something the controls no longer describe.
  stopAllPlayback();
  clearInsertPoint();
  orderMode = orderModeToggle.checked;
  renderInputs();
  renderResults();
});

freePlayToggle.addEventListener("change", () => {
  stopAllPlayback();
  freePlay = freePlayToggle.checked;
  updateLayoutVisibility();
  renderInputs();
  renderResults();
});

// --- Note-name reference + label preferences -----------------------------

// Builds the small inline radio pair next to a Shuddha row's name (e.g.
// "G1"/"G3" or "N1"/"N3"). Picking one sets labelPrefs[key], which drives
// every other row in the same family (Sadharana/Antara or Kaisiki/Kakali)
// plus every other place a note is shown across the app. The Code column
// stays plain reference text everywhere, including this row - it's "what
// code is currently in effect," not itself a control.
function choiceControl(key, options) {
  const span = document.createElement("span");
  span.className = "table-choice";
  for (const opt of options) {
    const label = document.createElement("label");
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = `label-pref-${key}`;
    radio.value = opt.value;
    radio.checked = labelPrefs[key] === opt.value;
    radio.addEventListener("change", () => {
      labelPrefs[key] = opt.value;
      localStorage.setItem(labelPrefStorageKey(key), opt.value);
      buildReferenceTable();
      renderInputs();
      renderResults();
      // The name search is a whole other view, and its list is only rebuilt on
      // a keystroke - so without this, going Search -> Settings -> change ->
      // Search showed the results you left behind, still in the old numbering,
      // until you touched the query. Cheap and a no-op on an empty query.
      performRagaSearch();
      // The chakra chart's two axes and its detail panel both show notes, so
      // both follow the numbering choice like everything else - it just happens
      // to be the one page the control that changed it is also on.
      melaChart?.refresh();
    });
    label.appendChild(radio);
    label.append(` ${opt.text}`);
    span.appendChild(label);
  }
  return span;
}

// --- Melakarta chakra chart ---------------------------------------------
// The chart itself lives in mela-chart.js; this is only the wiring. Both
// scraped files are optional at runtime - a failed fetch leaves the chakras
// unnamed and the katapayadi decode hidden, and nothing else changes, because
// everything else on that page is arithmetic over data/ragas.json.
let melaChart = null;
let chakras = null;
let katapayadi = null;

async function loadOptionalJson(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function buildMelaChart() {
  const melaRagas = new Map();
  for (const raga of ragas) {
    if (raga.is_melakarta && raga.mela != null && !melaRagas.has(raga.mela)) melaRagas.set(raga.mela, raga);
  }

  // specs/04's verification check 2, run against the data actually shipped
  // rather than only in the scraper: if the arithmetic and the stored scales
  // ever disagree, one of them is wrong and the chart is the last place that
  // should be quiet about it.
  const failures = checkAgainstStored(melaRagas);
  if (failures.length) console.warn("Melakarta derivation disagrees with data/ragas.json:", failures);

  melaChart = mountMelaChart(document.getElementById("mela-block"), {
    melaRagas,
    getChakras: () => chakras,
    getKatapayadi: () => katapayadi,
    getLabelPrefs: () => labelPrefs,
    // The chart's detail panel is a results list of exactly one row, so it
    // gets the row rendering, the per-row play button and the activeRowPlayer
    // mutual exclusion for nothing. `loadable` is right here in a way it
    // isn't in the note finder: you picked this raga by name, you didn't
    // build the selection it would overwrite.
    renderRow: (raga) => renderRow(raga, null, noMatchedSets(), false, { loadable: true }),
  });
}

function buildReferenceTable() {
  const tbody = document.getElementById("note-reference-body");
  tbody.innerHTML = "";
  for (const row of REFERENCE_ROWS) {
    const tr = document.createElement("tr");
    const nameCell = document.createElement("td");
    nameCell.append(row.name);

    if (row.gandharaRole === "shuddha") {
      nameCell.appendChild(
        choiceControl("gandhara", [
          { value: "mainstream", text: "G1" },
          { value: "alt", text: "G3" },
        ]),
      );
    } else if (row.nishadaRole === "shuddha") {
      nameCell.appendChild(
        choiceControl("nishada", [
          { value: "mainstream", text: "N1" },
          { value: "alt", text: "N3" },
        ]),
      );
    }

    const codeCell = document.createElement("td");
    codeCell.className = "swara-code"; // a swara name, so it takes the swara face
    codeCell.textContent = referenceRowCode(row, labelPrefs);

    tr.appendChild(nameCell);
    tr.appendChild(codeCell);
    tbody.appendChild(tr);
  }
}

// --- Theme (Light / Dark / System) --------------------------------------
// "System" is the default and matches the app's original behavior (the
// page just follows the OS via `color-scheme: light dark` in style.css) -
// Light/Dark force an explicit override via `data-theme` on <html>, which
// style.css pins `color-scheme` to for that branch. Persisted so a choice
// survives a reload.
const THEME_STORAGE_KEY = "themePreference";

function applyTheme(theme) {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

// Key / Shruti, persisted the same way and for the same reason: a family
// member sings at one pitch, and having to re-set it every time the app opens
// would make the setting worse than useless.
const KEY_STORAGE_KEY = "keySemitone";

function applyKey(semitone) {
  keySemitone = semitone;
  // Everything that makes a sound reads keySemitone at the moment it plays, so
  // a running sequence would change key underneath itself mid-phrase. Stopping
  // is the honest response - the phrase you asked for is not the one that would
  // come out.
  stopAllPlayback();
  renderInputs(); // the Piano's scale moves to the new key
}

function initKey() {
  const select = document.getElementById("key-select");
  const saved = Number(localStorage.getItem(KEY_STORAGE_KEY));
  // Number("") is 0, and 0 is a real value here (C4), so the stored string has
  // to be checked before it's trusted - and range-checked, since a keyboard
  // that can't draw the scale is worse than a forgotten preference.
  const stored = localStorage.getItem(KEY_STORAGE_KEY);
  if (stored !== null && Number.isInteger(saved) && saved >= MIN_SA_OFFSET && saved <= MAX_SA_OFFSET) {
    keySemitone = saved;
    select.value = String(saved);
  }

  select.addEventListener("change", (e) => {
    applyKey(Number(e.target.value));
    localStorage.setItem(KEY_STORAGE_KEY, String(keySemitone));
  });
}

// One key per family rather than one JSON blob for the pair: they are two
// independent choices, they are stored as the same plain strings labelPrefs
// already holds, and it keeps the shape of the other two settings above.
const LABEL_PREF_CONVENTIONS = ["mainstream", "alt"];

function labelPrefStorageKey(family) {
  return `labelPref.${family}`;
}

// Runs before buildReferenceTable(), which reads labelPrefs to decide which
// radio in each pair comes up checked - so restoring the value is all that is
// needed, and nothing has to reach into the DOM here.
function initLabelPrefs() {
  for (const family of Object.keys(labelPrefs)) {
    const saved = localStorage.getItem(labelPrefStorageKey(family));
    // Range-checked for the same reason Key is: a junk value would otherwise
    // reach gandharaPref()/nishadaPref(), which treat anything that isn't
    // "alt" as mainstream, and the app would silently show a convention the
    // user never picked instead of falling back to the default.
    if (LABEL_PREF_CONVENTIONS.includes(saved)) labelPrefs[family] = saved;
  }
}

function initTheme() {
  const saved = localStorage.getItem(THEME_STORAGE_KEY) || "system";
  const radio = document.querySelector(`input[name="theme-pref"][value="${saved}"]`);
  if (radio) radio.checked = true;
  applyTheme(saved);

  document.querySelectorAll('input[name="theme-pref"]').forEach((input) => {
    input.addEventListener("change", (e) => {
      if (!e.target.checked) return;
      applyTheme(e.target.value);
      localStorage.setItem(THEME_STORAGE_KEY, e.target.value);
    });
  });
}

async function init() {
  initTheme();
  initKey(); // before the first renderInputs() below - it decides where the Piano's scale sits
  initLabelPrefs(); // before buildReferenceTable() and renderInputs() - both read labelPrefs
  buildReferenceTable();
  renderMuteButton();
  updateLayoutVisibility(); // also runs updateControlAvailability() - Play both defaults checked
  renderInputs();
  try {
    ragas = await loadRagas();
    melaNames = melakartaNames(ragas);
  } catch (err) {
    promptEl.textContent = `Failed to load raga data: ${err.message}`;
    promptEl.hidden = false;
    return;
  }
  renderResults();
  nameIndex = buildNameIndex(ragas);
  buildNameList();
  buildMelaChart();

  // Last, and not awaited alongside ragas.json: the chart is fully usable
  // without either of these, so a slow or missing scrape must not hold up the
  // page or take the rest of it down with it.
  [chakras, katapayadi] = await Promise.all([loadOptionalJson("../data/melakarta_chakras.json"), loadOptionalJson("../data/katapayadi.json")]);
  renderKatapayadiReference(document.getElementById("kata-reference"), katapayadi);
  melaChart.refresh();
}

init();

// PWA installability (Android's "Add to Home Screen" prompt requires a
// registered service worker with a fetch handler) + offline support - see
// sw.js for the actual caching strategy. Registered after `load`, not
// inline, so it never competes with the page's own first paint/interactivity.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => {
      console.error("Service worker registration failed:", err);
    });
  });
}
