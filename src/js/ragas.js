// Data loading + matching logic for the swara keyboard finder. Pure, no DOM.
// See specs/02-swara-keyboard-finder.md for the matching semantics.

export async function loadRagas(url = "../data/ragas.json") {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return res.json();
}

// Distinct notes in one direction (arohana or avarohana). Degrees are used
// as-is (0-12) - low Sa and high Sa are independent, separately selectable
// notes, not folded together (see specs/02-swara-keyboard-finder.md).
export function directionNoteSet(notes) {
  const set = new Set();
  for (const note of notes) set.add(note.degree);
  return set;
}

// A raga's note set: distinct degrees across both scales combined - the
// combined-mode finder asks "does this raga use these notes at all," not
// "in this specific direction." See directionNoteSet for per-direction.
export function noteSet(raga) {
  const combined = directionNoteSet(raga.arohana);
  for (const d of directionNoteSet(raga.avarohana)) combined.add(d);
  return combined;
}

function isSuperset(set, subset) {
  for (const x of subset) {
    if (!set.has(x)) return false;
  }
  return true;
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) {
    if (!b.has(x)) return false;
  }
  return true;
}

// Given the full raga list and a Set of pressed degrees (0-12), return
// { exact, contains }, each sorted alphabetically by name. Empty `pressed`
// yields no results - see spec's "prompt state" UI rule.
export function match(ragas, pressed) {
  if (pressed.size === 0) return { exact: [], contains: [] };

  const exact = [];
  const contains = [];
  for (const raga of ragas) {
    const notes = noteSet(raga);
    if (setsEqual(notes, pressed)) {
      exact.push(raga);
    } else if (isSuperset(notes, pressed)) {
      contains.push(raga);
    }
  }

  const byName = (a, b) => a.name.localeCompare(b.name);
  exact.sort(byName);
  contains.sort(byName);
  return { exact, contains };
}

// Separate-mode matching: pressedArohana matches against each raga's own
// arohana notes, pressedAvarohana against its own avarohana - independently.
// A direction left empty is unconstrained (doesn't filter or count toward
// exactness). Both non-empty directions must match (AND), not either/or -
// see specs/02-swara-keyboard-finder.md.
export function matchSeparate(ragas, pressedArohana, pressedAvarohana) {
  if (pressedArohana.size === 0 && pressedAvarohana.size === 0) {
    return { exact: [], contains: [] };
  }

  const exact = [];
  const contains = [];
  for (const raga of ragas) {
    const aroSet = directionNoteSet(raga.arohana);
    const avaSet = directionNoteSet(raga.avarohana);

    const aroConstrained = pressedArohana.size > 0;
    const avaConstrained = pressedAvarohana.size > 0;

    const aroOk = !aroConstrained || isSuperset(aroSet, pressedArohana);
    const avaOk = !avaConstrained || isSuperset(avaSet, pressedAvarohana);
    if (!aroOk || !avaOk) continue;

    const aroExact = !aroConstrained || setsEqual(aroSet, pressedArohana);
    const avaExact = !avaConstrained || setsEqual(avaSet, pressedAvarohana);

    if (aroExact && avaExact) exact.push(raga);
    else contains.push(raga);
  }

  const byName = (a, b) => a.name.localeCompare(b.name);
  exact.sort(byName);
  contains.sort(byName);
  return { exact, contains };
}

// Raw degree sequence, in stored order - no folding, so e.g. Kanakangi's
// arohana is genuinely [0,1,2,5,7,8,9,12] (low Sa through high Sa), not a
// collapsed [0,1,2,5,7,8,9] with a dropped trailing repeat as it was when
// high Sa still folded to low Sa.
function directionSequence(notes) {
  return notes.map((n) => n.degree);
}

// True if `pattern` appears as a contiguous run anywhere in `seq` (same
// order, no gaps) - a plain substring check over degree arrays.
function sequenceContainsRun(seq, pattern) {
  if (pattern.length === 0 || pattern.length > seq.length) return false;
  outer: for (let start = 0; start <= seq.length - pattern.length; start++) {
    for (let i = 0; i < pattern.length; i++) {
      if (seq[start + i] !== pattern[i]) continue outer;
    }
    return true;
  }
  return false;
}

// Order-sensitive matching for hunting vakra ragas: compares a recorded
// degree sequence (as clicked, not sorted) against each raga's own
// arohana/avarohana sequence. **Exact**: the recorded sequence equals a
// direction's entire stored sequence. **Contains**: the recorded sequence
// appears as a contiguous run somewhere within it (a real subset of a
// longer scale, not the whole thing) - so a partial phrase you've recorded
// so far still surfaces candidate ragas instead of showing nothing until
// it's complete. `direction` is "arohana", "avarohana", or "either" (try
// both). Returns `{ exact, contains }`, each raga annotated with which
// direction(s) it was found in.
export function matchOrdered(ragas, sequence, direction = "either") {
  if (sequence.length === 0) return { exact: [], contains: [] };

  const exact = [];
  const contains = [];
  for (const raga of ragas) {
    const aroSeq = direction !== "avarohana" ? directionSequence(raga.arohana) : null;
    const avaSeq = direction !== "arohana" ? directionSequence(raga.avarohana) : null;
    const aroHit = aroSeq !== null && sequenceContainsRun(aroSeq, sequence);
    const avaHit = avaSeq !== null && sequenceContainsRun(avaSeq, sequence);
    if (!aroHit && !avaHit) continue;

    const aroExact = aroHit && aroSeq.length === sequence.length;
    const avaExact = avaHit && avaSeq.length === sequence.length;
    const annotated = { ...raga, matchedArohana: aroHit, matchedAvarohana: avaHit };
    (aroExact || avaExact ? exact : contains).push(annotated);
  }

  const byName = (a, b) => a.name.localeCompare(b.name);
  exact.sort(byName);
  contains.sort(byName);
  return { exact, contains };
}

// Separate-mode counterpart to matchOrdered: an empty direction sequence is
// unconstrained (same rule as matchSeparate), both non-empty directions
// must independently at least contain their pattern (AND); exact requires
// every non-empty direction to match its *entire* stored sequence, same
// tiering rule as combined mode. Annotates matchedArohana/matchedAvarohana
// too (here, simply "was this direction part of the search"), so app.js's
// badge text reads the same "(arohana)"/"(avarohana)"/"(both)" shape in
// both layout modes instead of only in combined mode's "either" search.
export function matchOrderedSeparate(ragas, aroSequence, avaSequence) {
  const aroConstrained = aroSequence.length > 0;
  const avaConstrained = avaSequence.length > 0;
  if (!aroConstrained && !avaConstrained) return { exact: [], contains: [] };

  const exact = [];
  const contains = [];
  for (const raga of ragas) {
    const aroSeq = directionSequence(raga.arohana);
    const avaSeq = directionSequence(raga.avarohana);

    const aroOk = !aroConstrained || sequenceContainsRun(aroSeq, aroSequence);
    const avaOk = !avaConstrained || sequenceContainsRun(avaSeq, avaSequence);
    if (!aroOk || !avaOk) continue;

    const aroExact = !aroConstrained || aroSeq.length === aroSequence.length;
    const avaExact = !avaConstrained || avaSeq.length === avaSequence.length;
    const annotated = { ...raga, matchedArohana: aroConstrained, matchedAvarohana: avaConstrained };
    (aroExact && avaExact ? exact : contains).push(annotated);
  }

  const byName = (a, b) => a.name.localeCompare(b.name);
  exact.sort(byName);
  contains.sort(byName);
  return { exact, contains };
}

export function melaContext(raga) {
  if (raga.mela == null) return "Mela unknown";
  return raga.is_melakarta ? `Melakarta #${raga.mela}` : `Janya of mela ${raga.mela}`;
}

// Free-text raga-name search, ranked by closeness: 0 = exact (case-
// insensitive) match, 1 = name starts with the query, 2 = query appears
// anywhere else in the name. Ties within a tier break alphabetically.
// Names that don't match at all are excluded entirely (not a "tier 3"),
// and a blank query returns no results - there's nothing to search for
// yet, same "empty prompt state" rule the note-based finder uses.
export function searchByName(ragas, query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const tiered = [];
  for (const raga of ragas) {
    const name = raga.name.toLowerCase();
    let tier;
    if (name === q) tier = 0;
    else if (name.startsWith(q)) tier = 1;
    else if (name.includes(q)) tier = 2;
    else continue;
    tiered.push({ raga, tier });
  }

  tiered.sort((a, b) => a.tier - b.tier || a.raga.name.localeCompare(b.raga.name));
  return tiered.map((t) => t.raga);
}

// Ragas sharing `raga`'s parent mela (the "same group of notes," per the
// human's framing) - the name search's "related ragas" tail, surfaced
// below its own name-match results. Excludes `raga` itself and anything
// in `exclude` (typically the name-match results already shown, so a
// raga never appears twice on the page). Compares by `id`, not `name` -
// several distinct ragas share a name across different melas (e.g. two
// "Ahiri" entries, mela 8 and mela 14 - see CLAUDE.md's data notes), so
// name-based exclusion would incorrectly drop one because of the other.
// Returns [] when the mela is unknown - nothing meaningful to relate.
export function relatedByMela(ragas, raga, exclude = []) {
  if (raga.mela == null) return [];
  const excludedIds = new Set(exclude.map((r) => r.id));
  excludedIds.add(raga.id);
  const related = ragas.filter((r) => r.mela === raga.mela && !excludedIds.has(r.id));
  related.sort((a, b) => a.name.localeCompare(b.name));
  return related;
}
