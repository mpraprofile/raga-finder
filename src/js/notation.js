// Shared swara/degree data for the note-input widgets, the note-name
// reference panel, and rendering each raga's stored labels. See
// specs/02-swara-keyboard-finder.md and CLAUDE.md "Notation format".
//
// Two independent things can vary in Carnatic notation, and this module
// keeps them separate:
// 1. R2=G1, R3=G2, D2=N1, D3=N2 are literally the same pitch (enharmonic
//    aliasing) - a physical fact, never a choice.
// 2. Which *number* (1/2/3) a school gives Shuddha/Sadharana/Antara
//    Gandhara (and Shuddha/Kaisiki/Kakali Nishada) is a convention. Some
//    number by pitch order (mainstream: Shuddha=1, Sadharana=2, Antara=3).
//    Others number by frequency of use instead - Shuddha being rare/vivadi,
//    it's pushed to "3", cycling the other two up: Sadharana=1, Antara=2.
//    Only this second thing is user-choosable, via `prefs` below, and it
//    applies everywhere a note is displayed - including a raga's own
//    stored label (see `renumberLabel`) - since it's just a relabeling of
//    the same physical scale, not a change to what the scale *is*.

// Degree -> role, for the three Gandhara and three Nishada variants.
const GANDHARA_ROLE_AT_DEGREE = { 2: "shuddha", 3: "sadharana", 4: "antara" };
const NISHADA_ROLE_AT_DEGREE = { 9: "shuddha", 10: "kaisiki", 11: "kakali" };

// role -> number, one table per convention. "alt" is a 3-way cycle, not a
// simple 2-way swap: Shuddha takes the slot Antara/Kakali vacates, and
// Sadharana/Kaisiki (usually thought of as the fixed "2") also move.
const GANDHARA_NUMBER = {
  mainstream: { shuddha: 1, sadharana: 2, antara: 3 },
  alt: { shuddha: 3, sadharana: 1, antara: 2 },
};
const NISHADA_NUMBER = {
  mainstream: { shuddha: 1, kaisiki: 2, kakali: 3 },
  alt: { shuddha: 3, kaisiki: 1, kakali: 2 },
};

function gandharaPref(prefs) {
  return prefs.gandhara === "alt" ? "alt" : "mainstream";
}
function nishadaPref(prefs) {
  return prefs.nishada === "alt" ? "alt" : "mainstream";
}
function gandharaCode(role, prefs) {
  return `G${GANDHARA_NUMBER[gandharaPref(prefs)][role]}`;
}
function nishadaCode(role, prefs) {
  return `N${NISHADA_NUMBER[nishadaPref(prefs)][role]}`;
}

// prefs: { gandhara: "mainstream" | "alt", nishada: "mainstream" | "alt" }.
// Degrees 0-12 - low Sa and high Sa (the octave repeat) are independent,
// separately selectable notes, not folded together.
export function labelForDegree(degree, prefs = {}) {
  switch (degree) {
    case 0:
      return "S";
    case 1:
      return "R1";
    case 2:
      return `R2/${gandharaCode("shuddha", prefs)}`;
    case 3:
      return `R3/${gandharaCode("sadharana", prefs)}`;
    case 4:
      return gandharaCode("antara", prefs);
    case 5:
      return "M1";
    case 6:
      return "M2";
    case 7:
      return "P";
    case 8:
      return "D1";
    case 9:
      return `D2/${nishadaCode("shuddha", prefs)}`;
    case 10:
      return `D3/${nishadaCode("kaisiki", prefs)}`;
    case 11:
      return nishadaCode("kakali", prefs);
    case 12:
      return "S'";
    default:
      return "";
  }
}

const GANDHARA_STD_TOKEN_TO_ROLE = { G1: "shuddha", G2: "sadharana", G3: "antara" };
const NISHADA_STD_TOKEN_TO_ROLE = { N1: "shuddha", N2: "kaisiki", N3: "kakali" };

// Takes a label as stored in data/ragas.json (always the mainstream/
// standard token, since that's what the scraper writes) and reflects the
// user's current numbering preference - used everywhere a raga's own
// arohana/avarohana label is displayed, so the choice applies consistently
// across the whole app, not just the input widgets.
export function renumberLabel(label, prefs = {}) {
  if (label in GANDHARA_STD_TOKEN_TO_ROLE) {
    return gandharaCode(GANDHARA_STD_TOKEN_TO_ROLE[label], prefs);
  }
  if (label in NISHADA_STD_TOKEN_TO_ROLE) {
    return nishadaCode(NISHADA_STD_TOKEN_TO_ROLE[label], prefs);
  }
  return label;
}

// 14 rows: the 16 traditional names minus the 2 pairs merged into one row
// each (Chatushruti Rishabha + Shuddha Gandhara share degree 2; Chatushruti
// Dhaivata + Shuddha Nishada share degree 9). Used to build the reference
// table, which shows both conventions side by side regardless of the
// current preference (that's its whole point - explaining the choice).
export const REFERENCE_ROWS = [
  { name: "Shadja", degree: 0 },
  { name: "Shuddha Rishabha", degree: 1 },
  { name: "Chatushruti Rishabha / Shuddha Gandhara", degree: 2, gandharaRole: "shuddha", prefix: "R2/" },
  { name: "Shatshruti Rishabha", degree: 3 },
  { name: "Sadharana Gandhara", degree: 3, gandharaRole: "sadharana" },
  { name: "Antara Gandhara", degree: 4, gandharaRole: "antara" },
  { name: "Shuddha Madhyama", degree: 5 },
  { name: "Prati Madhyama", degree: 6 },
  { name: "Panchama", degree: 7 },
  { name: "Shuddha Dhaivata", degree: 8 },
  { name: "Chatushruti Dhaivata / Shuddha Nishada", degree: 9, nishadaRole: "shuddha", prefix: "D2/" },
  { name: "Shatshruti Dhaivata", degree: 10 },
  { name: "Kaisiki Nishada", degree: 10, nishadaRole: "kaisiki" },
  { name: "Kakali Nishada", degree: 11, nishadaRole: "kakali" },
];

// Fixed codes for the rows above that have no numbering choice. Keyed by
// degree, but only used for rows without a gandharaRole/nishadaRole (a
// couple of degrees are reused by a role-bearing row too, e.g. degree 3 is
// both the fixed "Shatshruti Rishabha" row and the "Sadharana Gandhara"
// row - the role check below takes priority for the latter).
const FIXED_ROW_CODE = { 0: "S", 1: "R1", 3: "R3", 5: "M1", 6: "M2", 7: "P", 8: "D1", 10: "D3" };

// The Shuddha row of each family is where the choice is made (see
// app.js's buildReferenceTable, which embeds radio buttons there instead
// of text); Sadharana/Antara and Kaisiki/Kakali just reflect whatever
// `prefs` currently says, reactively.
export function referenceRowCode(row, prefs = {}) {
  if (row.gandharaRole) {
    const prefix = row.prefix ?? "";
    return `${prefix}${gandharaCode(row.gandharaRole, prefs)}`;
  }
  if (row.nishadaRole) {
    const prefix = row.prefix ?? "";
    return `${prefix}${nishadaCode(row.nishadaRole, prefs)}`;
  }
  return FIXED_ROW_CODE[row.degree] ?? "";
}

// The 13 distinct, independently selectable notes (low Sa through high Sa)
// - use this to build a widget's keys/tiles.
export const DEGREES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

// One octave, C-C, Sa=C. Low Sa and high Sa are now two independent
// degrees (0 and 12) - no shared/duplicate entry.
export const WHITE_KEY_DEGREES = [0, 2, 4, 5, 7, 9, 11, 12];

export const BLACK_KEYS = [
  { degree: 1, afterWhiteIndex: 0 },
  { degree: 3, afterWhiteIndex: 1 },
  { degree: 6, afterWhiteIndex: 3 },
  { degree: 8, afterWhiteIndex: 4 },
  { degree: 10, afterWhiteIndex: 5 },
];

// Shared across piano/buttons/assembler: builds a key/tile's order-badge
// stack from `positions` (an array of 1-based click positions - a note can
// appear more than once when order mode is on, since vakra ragas repeat
// notes). Stacked vertically in normal flow rather than each badge being
// independently positioned, which is what made repeats overlap each other
// before; most recent occurrence (highest number) on top. Returns a real
// DOM node (not an HTML string) so each badge can carry its own click
// listener - clicking a badge removes that exact recorded occurrence via
// `onRemoveAt(position)`, without needing string-based event delegation.
// Returns null when there's nothing to show.
export function buildOrderBadgeStack(positions, onRemoveAt) {
  if (!positions || positions.length === 0) return null;

  const stack = document.createElement("span");
  stack.className = "order-badge-stack";

  const nums = [...positions].sort((a, b) => b - a);
  for (const n of nums) {
    const badge = document.createElement("span");
    badge.className = "order-badge";
    badge.textContent = String(n);
    badge.title = `Remove this note (position ${n})`;
    badge.setAttribute("role", "button");
    badge.tabIndex = 0;
    // stopPropagation: the badge sits inside the key/tile's own button, so
    // without this its click would also trigger the key's onToggle/onAdd.
    badge.addEventListener("click", (e) => {
      e.stopPropagation();
      onRemoveAt(n);
    });
    badge.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        onRemoveAt(n);
      }
    });
    stack.appendChild(badge);
  }
  return stack;
}
