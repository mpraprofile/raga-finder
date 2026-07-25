import { loadRagas, match, matchSeparate, matchOrdered, matchOrderedSeparate, melaContext, searchByName, relatedByMela } from "./ragas.js";
import { playPianoTone, setMuted } from "./audio.js";
import { REFERENCE_ROWS, referenceRowCode, renumberLabel } from "./notation.js";
import * as piano from "./inputs/piano.js";
import * as buttons from "./inputs/buttons.js";
import * as assembler from "./inputs/assembler.js";

const INPUT_RENDERERS = { piano, buttons, assembler };
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

let inputStyle = "piano"; // piano | buttons | assembler
let layoutMode = "combined"; // combined | separate
let orderMode = false; // record click order, for vakra search
let muted = false;
let ragas = [];
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

// In Record note order mode, a note can recur (vakra ragas repeat notes
// within a scale), so re-tapping an already-selected note appends another
// occurrence instead of deselecting it - Reset is the only way to clear.
// Outside order mode, keep the plain select/deselect toggle.
function addOrToggle(list, degree) {
  if (orderMode) {
    list.push(degree);
    playPianoTone(degree);
  } else {
    toggleInList(list, degree);
  }
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

function renderInputs() {
  const renderer = INPUT_RENDERERS[inputStyle];

  if (layoutMode === "combined") {
    renderer.render(combinedContainer, {
      selected: new Set(combined),
      list: combined,
      labelPrefs,
      order: orderMapFor(combined),
      onToggle: (degree) => {
        addOrToggle(combined, degree);
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
      onToggle: (degree) => {
        addOrToggle(arohanaSel, degree);
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
      onToggle: (degree) => {
        addOrToggle(avarohanaSel, degree);
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

  const hasSelection = layoutMode === "combined" ? combined.length > 0 : arohanaSel.length > 0 || avarohanaSel.length > 0;
  if (!hasSelection) {
    promptEl.hidden = false;
    return;
  }
  promptEl.hidden = true;

  const { exact, contains } =
    layoutMode === "combined" ? match(ragas, new Set(combined)) : matchSeparate(ragas, new Set(arohanaSel), new Set(avarohanaSel));

  const matched = currentMatchedSets();
  for (const raga of exact) resultsEl.appendChild(renderRow(raga, "exact", matched));
  for (const raga of contains) resultsEl.appendChild(renderRow(raga, null, matched));

  if (exact.length === 0 && contains.length === 0) {
    resultsEl.appendChild(emptyRow("No ragas match this note set."));
  }
}

function renderOrderedResults() {
  const hasSelection = layoutMode === "combined" ? combined.length > 0 : arohanaSel.length > 0 || avarohanaSel.length > 0;
  if (!hasSelection) {
    promptEl.hidden = false;
    return;
  }
  promptEl.hidden = true;

  const { exact, contains } =
    layoutMode === "combined" ? matchOrdered(ragas, combined, "either") : matchOrderedSeparate(ragas, arohanaSel, avarohanaSel);

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
  if (badgeText) {
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = badgeText;
    name.appendChild(badge);
  }

  const mela = document.createElement("span");
  mela.className = "mela-context";
  mela.textContent = melaContext(raga);

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
    heading.textContent = `Related ragas - same parent scale as ${top.name} (${melaContext(top)})`;
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
  combinedPlayer.stop();
  stopAllSeparatePlayers();
  stopActiveRowPreview();
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
// entirely while joined (see updateControlVisibility()), so its Loop
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
  if (activeRowPlayer) {
    activeRowPlayer.stop();
    activeRowPlayer = null;
  }
}

resetBtn.addEventListener("click", () => {
  combinedPlayer.stop();
  combined.length = 0;
  renderInputs();
  renderResults();
});
arohanaResetBtn.addEventListener("click", () => {
  stopAllSeparatePlayers();
  arohanaSel.length = 0;
  renderInputs();
  renderResults();
});
avarohanaResetBtn.addEventListener("click", () => {
  stopAllSeparatePlayers();
  avarohanaSel.length = 0;
  renderInputs();
  renderResults();
});

// --- Mute ---------------------------------------------------------------
// A single block (title + reset + widget) per mode is shown/hidden as one
// unit by layoutMode (see updateLayoutVisibility) - mute only ever needs to
// touch the play/loop sub-controls within whichever block(s) are current,
// never the reset buttons or the block visibility itself.

function renderMuteButton() {
  muteBtn.innerHTML = muted ? `${ICON_MUTED}<span>Unmute</span>` : `${ICON_UNMUTED}<span>Mute</span>`;
  muteBtn.setAttribute("aria-pressed", String(muted));
  muteBtn.classList.toggle("active", muted);
}

// Two independent reasons Avarohana's playback-controls can be hidden, and
// they hide it two different ways on purpose:
// - muted: collapses all three groups (`hidden` -> display:none) - nothing
//   is playable regardless of layout, so there's no space worth reserving.
// - "Play both" checked: Avarohana's controls go invisible *in place*
//   (`.controls-invisible` -> visibility:hidden) rather than collapsing -
//   the element keeps occupying exactly the layout space it would if shown
//   (including whatever wrapped/unwrapped shape it'd have at the current
//   viewport width), so Arohana's header - the only one still visibly
//   showing Play/Loop - and Avarohana's stay the same height and the piano
//   below never shifts when this toggle flips. Collapsing it instead (the
//   original approach) shrank Avarohana's header and visibly moved its
//   piano up every time "Play both" was checked.
function updateControlVisibility() {
  combinedControls.hidden = muted;
  arohanaControls.hidden = muted;
  avarohanaControls.hidden = muted;
  avarohanaControls.classList.toggle("controls-invisible", !muted && playBothToggle.checked);
  // playBothLabel only *collapses* (hidden -> display:none, freeing its
  // space) when leaving separate mode, where it's genuinely irrelevant -
  // never when merely muting. Muting instead goes invisible-in-place
  // (.controls-invisible -> visibility:hidden, same trick as Avarohana's
  // controls above), so #note-order-group's width - and therefore whether
  // it still fits next to Mute on one line - never changes just because
  // mute was toggled. A real bug this fixes: collapsing on mute shrank the
  // group, which changed the row's total width enough to flip its wrap
  // state - Record note order visibly jumped up onto Mute's own line when
  // muted and back down when unmuted, in separate mode.
  const inSeparateMode = layoutMode === "separate";
  playBothLabel.hidden = !inSeparateMode;
  playBothLabel.classList.toggle("controls-invisible", inSeparateMode && muted);
}

function applyMuted() {
  setMuted(muted);
  updateControlVisibility();
  renderMuteButton();
  if (muted) {
    combinedPlayer.stop();
    stopAllSeparatePlayers();
    stopActiveRowPreview();
  }
}

muteBtn.addEventListener("click", () => {
  muted = !muted;
  applyMuted();
});

// --- Mode controls -----------------------------------------------------

document.querySelectorAll('input[name="input-style"]').forEach((radio) => {
  radio.addEventListener("change", (e) => {
    if (e.target.checked) {
      inputStyle = e.target.value;
      renderInputs();
    }
  });
});

function updateLayoutVisibility() {
  combinedBlock.hidden = layoutMode !== "combined";
  separateContainer.hidden = layoutMode !== "separate";
  updateControlVisibility(); // playBothLabel's own visibility also depends on layoutMode
}

document.querySelectorAll('input[name="layout-mode"]').forEach((radio) => {
  radio.addEventListener("change", (e) => {
    if (e.target.checked) {
      layoutMode = e.target.value;
      updateLayoutVisibility();
      renderInputs();
      renderResults();
    }
  });
});

orderModeToggle.addEventListener("change", () => {
  orderMode = orderModeToggle.checked;
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
  updateLayoutVisibility(); // also runs updateControlVisibility() - Play both defaults checked
  renderInputs();
  try {
    ragas = await loadRagas();
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
