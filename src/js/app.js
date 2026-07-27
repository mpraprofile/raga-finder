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
  relatedByMela,
} from "./ragas.js";
import { playPianoTone, playBlockerSound, setMuted } from "./audio.js";
import { REFERENCE_ROWS, referenceRowCode, renumberLabel } from "./notation.js";
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
let muted = false;
let ragas = [];
let melaNames = new Map(); // mela number -> that melakarta's name, filled after load
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
const searchView = document.getElementById("search-view");
const searchOpenBtn = document.getElementById("search-open-btn");
const searchBackBtn = document.getElementById("search-back-btn");
const ragaSearchInput = document.getElementById("raga-search-input");
const ragaNamesDatalist = document.getElementById("raga-names-datalist");
const searchPromptEl = document.getElementById("search-prompt");
const searchResultsEl = document.getElementById("search-results");

function toggleInList(list, degree) {
  const idx = list.indexOf(degree);
  if (idx !== -1) {
    list.splice(idx, 1); // deselecting is silent, per spec
  } else {
    list.push(degree);
    playPianoTone(degree);
  }
}

function countOccurrences(list, degree) {
  return list.reduce((n, d) => (d === degree ? n + 1 : n), 0);
}

// In Record note order mode, a note can recur (vakra ragas repeat notes
// within a scale), so re-tapping an already-selected note appends another
// occurrence instead of deselecting it - Reset is the only way to clear.
// Outside order mode, keep the plain select/deselect toggle.
//
// Piano-only functional cap: piano.MAX_VISIBLE_BADGES (5) is also the most
// occurrences one note can be recorded - not just how many badges show
// (see piano.js). Past the cap, a tap neither records a new occurrence nor
// plays the note's own tone; it plays a distinct "blocked" sound instead,
// so it's audibly obvious the tap did nothing rather than a silent no-op.
// Buttons has no such cap - only Piano's badge stack has the space problem
// this is guarding against.
//
// Returns whether the selection actually changed, so a refused tap (the cap)
// or a deliberately inert one (free play) doesn't drag a re-render - and,
// more to the point, doesn't restart a sequence that's currently playing.
function addOrToggle(list, degree) {
  // Free play (Piano only): sound the note and change nothing. Every key
  // speaks, including one that's already selected - there's no "deselect"
  // to keep silent here, so the silent-deselect rule doesn't apply.
  if (freePlay && inputStyle === "piano") {
    playPianoTone(degree);
    return false;
  }
  if (orderMode) {
    if (inputStyle === "piano" && countOccurrences(list, degree) >= piano.MAX_VISIBLE_BADGES) {
      playBlockerSound();
      return false;
    }
    list.push(degree);
    playPianoTone(degree);
  } else {
    toggleInList(list, degree);
  }
  return true;
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
  playPianoTone(degree);
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

// Replaces the entire selection in one go - graha bhedam rotation and
// sweep-select (see specs/03-swara-wheel.md) both change every note at
// once, which none of the existing per-note callbacks can express. Follows
// the same pattern as the rest: mutate the list in place (it's the live
// array every other path shares), then restart playback, re-render, re-match.
// Piano and Buttons ignore this prop, as they already ignore props they
// don't use.
function replaceList(list, newList) {
  list.splice(0, list.length, ...newList);
}

// --- Transpose (graha bhedam) -------------------------------------------
// One row per block, under that block's Play/Loop controls (see index.html),
// so it belongs to the *selection* rather than to any one input style - which
// is what lets Piano have it too.

function listFor(which) {
  return which === "arohana" ? arohanaSel : which === "avarohana" ? avarohanaSel : combined;
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

function renderInputs() {
  const renderer = INPUT_RENDERERS[inputStyle];
  renderTransposeRows();
  // Piano's two directions stack; a keyboard is far too wide to halve.
  separateContainer.classList.toggle("stacked", inputStyle === "piano");

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
      summary: selectionSummary(),
      labelOffset: transposeState.combined.offset,
      freePlay: inFreePlayMode(),
      onReplace: (newList) => {
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
      onReplace: (newList) => {
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
      onReplace: (newList) => {
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

// One line of live result summary for the hole in the middle of the swara
// wheel (see specs/03-swara-wheel.md): the top exact match's name and the
// two counts, with a way to hear that raga. Other input styles ignore it.
function selectionSummary() {
  if (!hasSelection()) return { text: "Pick some swaras", onPlay: null };
  const { exact, contains } = currentMatches();
  const counts = `${exact.length} exact · ${contains.length} contain`;
  const top = exact[0] ?? null;
  return {
    text: top ? `${top.name} · ${counts}` : `No exact match · ${counts}`,
    onPlay: top ? () => playScaleOnce(top) : null,
  };
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

  const matched = currentMatchedSets();
  for (const raga of exact) resultsEl.appendChild(renderRow(raga, "exact", matched));
  for (const raga of contains) resultsEl.appendChild(renderRow(raga, null, matched));

  if (exact.length === 0 && contains.length === 0) {
    resultsEl.appendChild(emptyRow("No ragas match this note set."));
  }
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
    resultsEl.appendChild(emptyRow("No ragas match this note order, even partially."));
    return;
  }

  const matched = currentMatchedSets();
  for (const raga of exact) resultsEl.appendChild(renderRow(raga, orderBadgeText(raga, "exact order"), matched, true));
  for (const raga of contains) resultsEl.appendChild(renderRow(raga, orderBadgeText(raga, "partial order"), matched, false));
}

// Both matchOrdered() and matchOrderedSeparate() annotate matchedArohana/
// matchedAvarohana on every returned raga, so this same suffix logic
// produces a consistent badge shape ("exact order (arohana)", "partial
// order (both)", ...) regardless of combined vs. separate layout mode.
function orderBadgeText(raga, tier) {
  if (raga.matchedArohana && raga.matchedAvarohana) return `${tier} (both)`;
  if (raga.matchedArohana) return `${tier} (arohana)`;
  if (raga.matchedAvarohana) return `${tier} (avarohana)`;
  return tier;
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
      const label = renumberLabel(n.label, labelPrefs);
      return matchedDegrees.has(n.degree) ? `<span class="note-match">${label}</span>` : label;
    })
    .join(" ");
}

// `tint` controls the visual "exact match" highlight independently of
// whether there's a badge - a partial/contains order-mode match still
// shows a badge ("partial order...") but shouldn't be tinted the same as
// a true exact match, so it stays visually distinct from the top tier.
function renderRow(raga, badgeText, matched, tint = Boolean(badgeText)) {
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
    buildSequence: () => {
      const arohanaDegrees = raga.arohana.map((n) => n.degree);
      const avarohanaDegrees = raga.avarohana.map((n) => n.degree);
      return { sequence: [...arohanaDegrees, ...avarohanaDegrees], pauseAfterIndex: arohanaDegrees.length - 1 };
    },
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
  if (badgeText) {
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = badgeText;
    name.appendChild(badge);
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

// Raga names repeat across the dataset (see relatedByMela's own note on
// this) - de-duplicated here since the datalist is suggesting *names* to
// type, not picking a specific raga; the search box's own tiered ranking
// is what actually disambiguates once you've typed enough to match.
function populateRagaNamesDatalist() {
  const names = [...new Set(ragas.map((r) => r.name))].sort((a, b) => a.localeCompare(b));
  ragaNamesDatalist.innerHTML = names.map((name) => `<option value="${name}"></option>`).join("");
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

  const matches = searchByName(ragas, query);
  if (matches.length === 0) {
    searchResultsEl.appendChild(emptyRow(`No ragas match "${query.trim()}".`));
    return;
  }

  const empty = noMatchedSets();
  const top = matches[0];
  // "Clear match" per the human's spec: an exact (case-insensitive) name
  // match tops the list - already true from searchByName()'s own tier-0
  // sort, so this only decides whether to badge it as such.
  const isClearMatch = top.name.toLowerCase() === query.trim().toLowerCase();
  matches.forEach((raga, i) => {
    const badge = i === 0 && isClearMatch ? "exact match" : null;
    searchResultsEl.appendChild(renderRow(raga, badge, empty, Boolean(badge)));
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
      searchResultsEl.appendChild(renderRow(raga, null, empty, false));
    }
  }
}

ragaSearchInput.addEventListener("input", performRagaSearch);

// Stops whatever's currently playing before switching views, same as
// switching layout mode or muting does - two views' worth of Play buttons
// left running into each other would be confusing, not useful.
function openSearchView() {
  stopAllPlayback();
  mainView.hidden = true;
  searchView.hidden = false;
  ragaSearchInput.focus();
}

function closeSearchView() {
  stopActiveRowPreview();
  searchView.hidden = true;
  mainView.hidden = false;
}

searchOpenBtn.addEventListener("click", openSearchView);
searchBackBtn.addEventListener("click", closeSearchView);

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
  const sequence = [...asc, ...desc];
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
  buildSequence: () => ({ sequence: orderedOrSorted(arohanaSel, true), pauseAfterIndex: -1 }),
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
  buildSequence: () => ({ sequence: orderedOrSorted(avarohanaSel, false), pauseAfterIndex: -1 }),
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
    const arohanaDegrees = orderedOrSorted(arohanaSel, true);
    const avarohanaDegrees = orderedOrSorted(avarohanaSel, false);
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

function playScaleOnce(raga) {
  stopActiveRowPreview();
  combinedPlayer.stop();
  stopAllSeparatePlayers();

  const arohanaDegrees = raga.arohana.map((n) => n.degree);
  const sequence = [...arohanaDegrees, ...raga.avarohana.map((n) => n.degree)];
  const pauseAfterIndex = arohanaDegrees.length - 1;
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
  // The baseline went with the notes - there's nothing left to be
  // transposed *from*.
  transposeState.combined = { steps: 0, offset: 0 };
  renderInputs();
  renderResults();
});
arohanaResetBtn.addEventListener("click", () => {
  stopAllSeparatePlayers();
  arohanaSel.length = 0;
  transposeState.arohana = { steps: 0, offset: 0 };
  renderInputs();
  renderResults();
});
avarohanaResetBtn.addEventListener("click", () => {
  stopAllSeparatePlayers();
  avarohanaSel.length = 0;
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
      buildReferenceTable();
      renderInputs();
      renderResults();
    });
    label.appendChild(radio);
    label.append(` ${opt.text}`);
    span.appendChild(label);
  }
  return span;
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
  populateRagaNamesDatalist();
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
