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

// Result ordering, used by every list in the app. Melakartas come first,
// then alphabetical within each group: a parent scale is the answer most
// searches are really reaching for, and burying it among its own janyas
// (which are far more numerous, and often alphabetically earlier) made it
// the hardest row to find. Rows carry a "melakarta" badge too - the order
// alone doesn't say why something is on top. See renderRow in app.js.
function byMelakartaThenName(a, b) {
  return Number(Boolean(b.is_melakarta)) - Number(Boolean(a.is_melakarta)) || a.name.localeCompare(b.name);
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
// { exact, contains }, each ordered by byMelakartaThenName. Empty `pressed`
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

  exact.sort(byMelakartaThenName);
  contains.sort(byMelakartaThenName);
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

  exact.sort(byMelakartaThenName);
  contains.sort(byMelakartaThenName);
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

  exact.sort(byMelakartaThenName);
  contains.sort(byMelakartaThenName);
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

  exact.sort(byMelakartaThenName);
  contains.sort(byMelakartaThenName);
  return { exact, contains };
}

// --- Transpose / graha bhedam -------------------------------------------
// Keep the same physical pitches, treat a *different* selected note as Sa.
// Surfaced in the UI as each block's Transpose row.
//
// Two functions rather than the single rotateGraha(list, direction) that
// specs/03 sketched: "Transpose both Arohana & Avarohana" has to move a
// *second* list by the tonic taken from the first, so choosing the tonic and
// applying it are separate steps. Choosing one per list independently would
// shift the two directions by different intervals and silently pull one raga
// into two.
//
// Which selected note `direction` would hand the tonic to, as a pitch class,
// or null when there isn't one. `direction` >= 0 takes the next selected note
// upward, < 0 the previous one - it snaps to notes that are actually selected
// rather than stepping by an arbitrary semitone, since a free +/-1 rotation
// produces sets that often don't contain Sa at all, which is not a scale and
// not what graha bhedam means.
export function grahaTonic(list, direction = 1) {
  // Pitch classes: degrees 0 and 12 are the same swara an octave apart, so
  // they're one candidate tonic, not two. 0 is where the tonic already is,
  // so it's never a rotation *target*.
  const candidates = [...new Set(list.map((d) => d % 12))].sort((a, b) => a - b).filter((pc) => pc !== 0);
  if (candidates.length === 0) return null; // nothing but Sa - no other note to hand the tonic to
  return direction >= 0 ? candidates[0] : candidates[candidates.length - 1];
}

// The shift itself, at an explicit tonic. A list that doesn't contain that
// pitch class still moves by the same interval - that's the point when both
// directions are being transposed together, and it means the result won't
// start on Sa unless the tonic was in it.
//
// Worked examples (verified against data/ragas.json): Mohanam 0 2 4 7 9 12
// with 2 as the new Sa gives Madhyamavathi; with 4, Hindolam.
//
// `ordered` distinguishes the two things a selection can be. Off (the
// default): a *set* of notes, so the result is deduplicated, sorted, and
// gets its octave bookend re-attached - if the input reached up to degree
// 12, so does the output. On: a recorded *sequence*, so every element is
// mapped where it stands and order and repeats survive untouched.
export function rotateToTonic(list, tonic, { ordered = false } = {}) {
  if (list.length === 0) return [];
  const shift = (degree) => (((degree % 12) - tonic + 12) % 12);

  if (ordered) {
    // An upper Sa stays the upper Sa only while it's still Sa; once the
    // rotation moves it off the tonic, the octave it was marking is gone
    // and it lands in the base octave with everything else.
    return list.map((degree) => {
      const rotated = shift(degree);
      return degree === 12 && rotated === 0 ? 12 : rotated;
    });
  }

  const rotated = [...new Set(list.map(shift))].sort((a, b) => a - b);
  if (list.includes(12)) rotated.push(12);
  return rotated;
}

// Mela number -> that melakarta's own name, built once from the dataset
// rather than stored anywhere: the 72 parent scales are already in
// ragas.json as ordinary ragas with is_melakarta set, so there is nothing
// to hand-author or keep in sync.
export function melakartaNames(ragas) {
  const names = new Map();
  for (const raga of ragas) {
    if (raga.is_melakarta && raga.mela != null && !names.has(raga.mela)) names.set(raga.mela, raga.name);
  }
  return names;
}

// `melaNames` (from melakartaNames above) is optional - without it this
// degrades to the bare number. A janya gets its parent's name spelled out,
// since "Janya of mela 28" only means something if you already know the 72
// by number; a melakarta doesn't, because there the name would just repeat
// the row's own title.
export function melaContext(raga, melaNames) {
  if (raga.mela == null) return "Mela unknown";
  if (raga.is_melakarta) return `Melakarta #${raga.mela}`;
  const parent = melaNames?.get(raga.mela);
  return parent ? `Janya of mela ${raga.mela} (${parent})` : `Janya of mela ${raga.mela}`;
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

  // Tier still wins: what you literally typed stays on top, whether or not
  // it's a melakarta. Within a tier, the same melakarta-first rule the
  // note-based results use.
  tiered.sort((a, b) => a.tier - b.tier || byMelakartaThenName(a.raga, b.raga));
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
  // Puts the parent melakarta itself at the head of its own family, which
  // is exactly the row someone browsing "related ragas" wants first.
  related.sort(byMelakartaThenName);
  return related;
}
