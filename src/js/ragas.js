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

// --- Transpose / graha bhēdam -------------------------------------------
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
// not what graha bhēdam means.
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

// --- Free-text raga-name search ------------------------------------------
// A name search is nearly always reaching for a half-remembered spelling,
// so exact substring matching was the wrong bar: "Moga" has to find Mohanam
// and "Hansid" has to find the Hamsa- family. Two independent mechanisms,
// applied in that order:
//
// 1. **Normalisation** (searchKey) folds away the transliteration choices
//    that make two spellings of the same name look unrelated to a computer -
//    Thodi/Todi, Hamsadhwani/Hamsadvani, Poornachandrika/Purnachandrika.
//    Both sides get folded, so even the "literal" tiers below are judged on
//    the folded forms, never the raw ones.
// 2. **Approximate prefix matching** (approxPrefix) over what's left, for
//    the errors no amount of folding can normalise away - a wrong letter, a
//    dropped one, a transposed pair.
//
// Everything stays ranked in tiers rather than merged into one score: an
// exact hit must never be pushed below a guess, however good the guess is.

const COMBINING_MARKS = /[\u0300-\u036f]/g;
// Editorial furniture that rides along in a few source names and is no part
// of the name itself: "Bibhas {Hindustani}", "Mukthipradayini [4]",
// "Mahati cf. Mela 28&43".
const ANNOTATIONS = /\{[^}]*\}|\[[^\]]*\]|\([^)]*\)|\bcf\..*$/g;

// The comparison form of a name (or of a query). Folded, in order:
// annotations dropped; diacritics and stroked letters flattened (the dataset
// has one "Poornashađjam"); w -> v; aspirated consonants de-aspirated, which
// also collapses sh -> s (Thodi/Todi, Bhairavi/Bairavi, Shankara/Sankara);
// doubled vowels to the short vowel they stand in for (Sree/Sri,
// Poorna/Purna, Deepika/Dipika); every run of non-letters to a single space,
// so a slash-separated alternate name ("Malkosh / Malkauns") simply becomes a
// second word and is found by the word-start tier below with no special
// casing; word-final y to i (Abhery/Abheri); finally any doubled letter to a
// single one (Kalyaani -> Kalyani).
//
// Aggressive on purpose. The cost of over-folding is a few extra rows in a
// low tier; the cost of under-folding is a name the user can spell aloud but
// cannot find.
export function searchKey(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .replace(/&amp;/g, "&")
    .replace(ANNOTATIONS, " ")
    .replace(/[đð]/g, "d")
    .replace(/w/g, "v")
    .replace(/([bcdgjkpstz])h/g, "$1")
    .replace(/ee/g, "i")
    .replace(/oo/g, "u")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/y(?= |$)/g, "i")
    .replace(/([a-z0-9])\1+/g, "$1");
}

// Offsets in `key` where a word begins - 0 plus every position after a
// space. What lets "kalyani" find "Mohana Kalyani" and "malkauns" find
// "Malkosh / Malkauns".
function wordStarts(key) {
  const starts = [0];
  for (let i = 0; i < key.length; i++) {
    if (key[i] === " ") starts.push(i + 1);
  }
  return starts;
}

// Normalising 973 names on every keystroke would be wasteful, so it happens
// once after load and the result is what searchByName() searches. Built in
// dataset order, and each entry keeps its raga, so ranking can still fall
// back on the usual melakarta-first ordering.
export function buildNameIndex(ragas) {
  return ragas.map((raga) => {
    const key = searchKey(raga.name);
    return { raga, key, starts: wordStarts(key) };
  });
}

const TIER_EXACT = 0;
const TIER_PREFIX = 1;
const TIER_WORD_PREFIX = 2;
const TIER_SUBSTRING = 3;
const TIER_FUZZY_START = 4;
const TIER_FUZZY_WORD = 5;

// The only permitted starting offset for a fuzzy match against the name as a
// whole - see approxPrefix.
const NAME_START = [0];

// How many single-character edits a query prefix of `len` characters is
// allowed to be wrong by. Stingy at the short end deliberately: one edit in
// three characters matches almost anything, so under four characters nothing
// fuzzy is entertained at all and the literal tiers do all the work.
function fuzzyBudget(len) {
  if (len < 4) return 0;
  if (len < 6) return 1;
  if (len < 9) return 2;
  return 3;
}

// Levenshtein with the *trailing* text free - so a query is matched against
// every prefix of the name at once - and starting only at one of `starts`
// (offsets in `text`; `[0]` means the name's own beginning, the full
// wordStarts() list means any word in it).
//
// Never truly unanchored. Allowing a match to begin mid-word was tried and
// was the single largest source of nonsense: with a four-character window
// free to land anywhere, "nata" reached 205 rows (Kanakadri, Sajjananandhi)
// and "kharahara" 251 (Swayambhooshwara Raga). Every one of those was
// junk, and no real query lost anything by requiring a word boundary -
// a genuine mid-word hit is nearly always a literal substring anyway, which
// an earlier tier has already caught.
//
// The row minimum after query character `i` is the best distance for the
// query's own first `i` characters, so one pass answers for every query
// prefix - which is the whole trick behind partial tolerance: "Hansid"
// stops being matchable around its 5th character for most of the Hamsa
// family, but its first four still are, and that's reported rather than
// discarded. Those per-prefix distances are also summed into `area`, which
// is what separates two guesses that end up equally wrong overall: "Hansid"
// is two edits from both "Hamsadhwani" and "Haridarpa", but it stays right
// for four characters against the first and only two against the second, and
// the smaller area says so.
//
// Returns the longest prefix that stayed inside budget as
// `{ consumed, distance, area }`, or null if even the first few characters
// didn't.
function approxPrefix(text, query, starts) {
  const n = text.length;
  let prev = new Array(n + 1);
  let cur = new Array(n + 1);
  // Row 0: the cost of reaching column j having consumed no query characters
  // yet - zero at a permitted starting offset, and otherwise the number of
  // characters deleted since the nearest one before it.
  const startSet = new Set(starts);
  let base = 0;
  for (let j = 0; j <= n; j++) {
    if (startSet.has(j)) base = j;
    prev[j] = j - base;
  }

  let best = null;
  let area = 0;
  for (let i = 1; i <= query.length; i++) {
    const qc = query[i - 1];
    cur[0] = i;
    let rowMin = i;
    for (let j = 1; j <= n; j++) {
      let v = prev[j - 1] + (qc === text[j - 1] ? 0 : 1);
      if (prev[j] + 1 < v) v = prev[j] + 1;
      if (cur[j - 1] + 1 < v) v = cur[j - 1] + 1;
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    area += rowMin;
    if (rowMin <= fuzzyBudget(i)) best = { consumed: i, distance: rowMin, area };
    const spare = prev;
    prev = cur;
    cur = spare;
  }
  return best;
}

// A fuzzy hit also has to account for enough of what was actually typed:
// four characters minimum, and 70% of the query once it's longer than six.
// Without this, one recognisable syllable would drag in half the dataset on
// a long query - the whole of "kharahara" is a much stronger statement of
// intent than the whole of "nata", and the floor has to rise with it.
function minConsumed(len) {
  return Math.max(4, Math.ceil(len * 0.7));
}

// How many leading characters the two agree on outright. Two guesses can be
// one edit away from the query and still not be equally good guesses:
// "Moga" is a single substitution from both Mohanam and Bhogavasantha (once
// folded, "boga"), and the one that starts the way you started typing is
// obviously the one you meant.
function sharedPrefix(key, q) {
  let i = 0;
  while (i < key.length && i < q.length && key[i] === q[i]) i++;
  return i;
}

// null when this name isn't a match at all - not a lowest tier. Tiers 0-3
// are literal (on the folded forms); 4 and 5 are guesses, and are the only
// ones where the numbers below carry information - a literal tier leaves
// them all zero so its rows keep falling through to the app's usual
// melakarta-first alphabetical order, unchanged.
function scoreName(entry, q) {
  const { key, starts } = entry;
  const literal = { consumed: 0, distance: 0, area: 0, shared: 0, gap: 0 };
  if (key === q) return { tier: TIER_EXACT, ...literal };
  if (key.startsWith(q)) return { tier: TIER_PREFIX, ...literal };
  for (let i = 1; i < starts.length; i++) {
    if (key.startsWith(q, starts[i])) return { tier: TIER_WORD_PREFIX, ...literal };
  }
  if (key.includes(q)) return { tier: TIER_SUBSTRING, ...literal };

  const floor = minConsumed(q.length);
  const guess = { shared: sharedPrefix(key, q), gap: Math.abs(key.length - q.length) };
  const fromStart = approxPrefix(key, q, NAME_START);
  if (fromStart && fromStart.consumed >= floor) return { tier: TIER_FUZZY_START, ...fromStart, ...guess };
  // Single-word names have no other word to try - the pass above already was
  // that pass.
  if (starts.length === 1) return null;
  const fromWord = approxPrefix(key, q, starts);
  if (fromWord && fromWord.consumed >= floor) return { tier: TIER_FUZZY_WORD, ...fromWord, ...guess };
  return null;
}

// Ranked name search over an index from buildNameIndex(). A blank query
// returns no results - there's nothing to search for yet, the same "empty
// prompt state" rule the note-based finder uses.
export function searchByName(index, query) {
  const q = searchKey(query);
  if (!q) return [];

  const scored = [];
  for (const entry of index) {
    const score = scoreName(entry, q);
    if (score) scored.push({ ...score, raga: entry.raga });
  }

  // Tier wins outright: what you literally typed stays above anything
  // merely close to it, melakarta or not. Then, for guesses only (a literal
  // tier zeroes every one of these, so it goes straight to the last clause):
  // how much of the query the match accounts for, how cleanly, how late the
  // errors start, how much of it agrees outright, and how near the whole name
  // is in length to what was typed - that last one is what puts Mohanam above
  // Mohanadhwani for "Mohanm". Finally the same melakarta-first rule every
  // other list in the app uses.
  scored.sort(
    (a, b) =>
      a.tier - b.tier ||
      b.consumed - a.consumed ||
      a.distance - b.distance ||
      a.area - b.area ||
      b.shared - a.shared ||
      a.gap - b.gap ||
      byMelakartaThenName(a.raga, b.raga),
  );
  return scored.map((s) => s.raga);
}

// Whether `query` names `raga` outright, once both are folded - the search
// view's "exact name" badge. Not `name === query`: the folding is the point,
// so typing "Thodi" counts as naming Todi exactly.
export function isExactNameMatch(raga, query) {
  const q = searchKey(query);
  return q.length > 0 && searchKey(raga.name) === q;
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
