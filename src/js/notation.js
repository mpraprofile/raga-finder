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

// Which swara family (or families) each degree belongs to, and where it
// sits within that family by *pitch* - `step` is -1 (lowest variant), 0
// (middle) or +1 (highest), never the label's number. Under the "alt"
// numbering convention above those numbers run out of pitch order, so a
// colour scale keyed off them would jump about; keyed off `step` it always
// tracks the pitch. Lives here, not in the wheel, because "degree 2 is
// Rishabha-or-Gandhara" is notation knowledge, same as labelForDegree's.
//
// Two entries = an aliased degree (R2=G1, R3=G2, D2=N1, D3=N2 are literally
// the same pitch), listed [top, bottom] in the same order keyLabelHtml
// stacks the two names - G/N on top, R/D below - so a two-tone node and its
// two-line label read as one thing. See specs/03-swara-wheel.md.
export const DEGREE_FAMILIES = {
  0: [{ family: "S", step: 0 }],
  1: [{ family: "R", step: -1 }],
  2: [{ family: "G", step: -1 }, { family: "R", step: 0 }],
  3: [{ family: "G", step: 0 }, { family: "R", step: 1 }],
  4: [{ family: "G", step: 1 }],
  5: [{ family: "M", step: -1 }],
  6: [{ family: "M", step: 1 }],
  7: [{ family: "P", step: 0 }],
  8: [{ family: "D", step: -1 }],
  9: [{ family: "N", step: -1 }, { family: "D", step: 0 }],
  10: [{ family: "N", step: 0 }, { family: "D", step: 1 }],
  11: [{ family: "N", step: 1 }],
  12: [{ family: "S", step: 0 }],
};

// Which palette every swara-coloured control uses. Started as a wheel-only
// constant (see specs/03-swara-wheel.md); it lives here now that the Buttons
// keys and the selection-box tiles wear the same colours, so one note is one
// colour everywhere in the app rather than three styles each having an
// opinion. The colour *values* are CSS custom properties in style.css -
// theme-aware, off one shared lightness variable - and this only names them.
export const SWARA_PALETTE = "families"; // "families" | "ramp"

const STEP_NAME = { "-1": "lo", 0: "mid", 1: "hi" };

// [top, bottom] CSS colours for a degree. Under the families palette the four
// aliased degrees (2, 3, 9, 10) genuinely differ top-to-bottom - the top half
// takes the G/N family colour, the bottom the R/D one, lining up with how
// keyLabelHtml stacks the two names. Everything else is one flat colour
// expressed as both halves, so a single gradient rule paints every chip.
export function swaraColors(degree) {
  if (SWARA_PALETTE === "ramp") {
    const c = `var(--ramp-${degree})`;
    return [c, c];
  }
  const parts = DEGREE_FAMILIES[degree].map(({ family, step }) => `var(--f-${family}-${STEP_NAME[step]})`);
  return parts.length === 2 ? parts : [parts[0], parts[0]];
}

// The single colour a degree contributes where only one is possible (a
// polygon vertex, a path segment): a split note gives its lower (R/D) half.
export function swaraColor(degree) {
  return swaraColors(degree)[1];
}

// Paints one chip - a wheel node, a Buttons key, a selection-box tile.
// Pair with the `.swara-chip` class in style.css, which turns these two
// properties into the actual fill and handles the selected/hover states.
export function applySwaraColors(el, degree) {
  const [top, bottom] = swaraColors(degree);
  el.style.setProperty("--top", top);
  el.style.setProperty("--bottom", bottom);
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

// Shared by every input style's key/tile: compound labels (e.g. "R2/G1")
// stack with the G/N name on top, the R/D name on bottom, rather than
// running both names together on one line.
export function keyLabelHtml(degree, labelPrefs) {
  const label = labelForDegree(degree, labelPrefs);
  if (!label.includes("/")) return `<span class="key-label">${label}</span>`;
  const [bottom, top] = label.split("/");
  return `<span class="key-label stacked">${top}<br>${bottom}</span>`;
}

// Which semitones are the black keys of a C-C keyboard, for any semitone -
// including negative ones, since the piano now extends below Sa. Replaced
// the old fixed WHITE_KEY_DEGREES/BLACK_KEYS tables, which only described
// the single 0-12 octave and couldn't answer for a key outside it.
const NATURAL_PITCH_CLASSES = new Set([0, 2, 4, 5, 7, 9, 11]);

export function isBlackKey(semitone) {
  return !NATURAL_PITCH_CLASSES.has(((semitone % 12) + 12) % 12);
}

// Shared across piano/buttons: builds a key/tile's order-badge stack from
// `positions` (an array of 1-based click positions - a note can appear more
// than once when order mode is on, since vakra ragas repeat notes). Stacked
// vertically in normal flow rather than each badge being independently
// positioned, which is what made repeats overlap each other before; most
// recent occurrence (highest number) on top. Returns a real DOM node (not an
// HTML string) so each badge can carry its own click listener - clicking a
// badge removes that exact recorded occurrence via `onRemoveAt(position)`,
// without needing string-based event delegation. Returns null when there's
// nothing to show.
//
// `maxVisible` (default unlimited): caps how many badges actually render:
// the most recent `maxVisible` occurrences get real (clickable/removable)
// badges, and anything older than that collapses into one plain "+N"
// indicator badge instead - not clickable, since it represents more than
// one occurrence and there's no single position to remove. Piano passes 5
// here (its keys are tall enough for a badge stack but not an unbounded
// one); other styles leave it unlimited.
export function buildOrderBadgeStack(positions, onRemoveAt, maxVisible = Infinity) {
  if (!positions || positions.length === 0) return null;

  const stack = document.createElement("span");
  stack.className = "order-badge-stack";

  const nums = [...positions].sort((a, b) => b - a);
  const visible = nums.slice(0, maxVisible);
  const hiddenCount = nums.length - visible.length;

  for (const n of visible) {
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

  if (hiddenCount > 0) {
    const more = document.createElement("span");
    more.className = "order-badge order-badge-more";
    more.textContent = `+${hiddenCount}`;
    more.title = `${hiddenCount} more recorded occurrence${hiddenCount > 1 ? "s" : ""} (not shown)`;
    stack.appendChild(more);
  }

  return stack;
}

// The "swara selection box" - a tray of tiles showing the current
// selection, each tile tappable to remove exactly that occurrence. Started
// as the old Assembler style's tray; now shared by the merged Buttons style
// (see specs) and reusable by any future style that needs the same "here's
// what you've assembled so far" box, e.g. the Swara wheel's order-mode
// roller assembly.
//
// `list`: the raw insertion-ordered array (may contain a degree more than
// once). `order`: truthy while "Record note order" is on - the tray then
// shows the recorded click order as-is (unsorted), one position badge per
// tile; otherwise sorted by degree (`descending` for an avarohana-direction
// tray, ascending everywhere else).
// `showPositions` (default true) draws the yellow numbered badge on each
// tile. Buttons turns it off: its tray already reads left-to-right in the
// recorded order, so the numbers only restated what the layout said, at the
// cost of a second tap target per tile. The tile itself still removes that
// exact occurrence, which is what the badge was for.
export function renderSelectionBox(container, { list, order, onRemove, onRemoveOrder, labelPrefs, descending, showPositions = true }) {
  container.className = "selection-box";
  container.innerHTML = "";

  const label = document.createElement("p");
  label.className = "selection-box-label";
  label.textContent = order ? "Your scale, in the order added - tap to remove" : "Your scale - tap to remove";
  container.appendChild(label);

  const tray = document.createElement("div");
  tray.className = "tile-row tray";
  const entries = order
    ? list.map((degree, i) => ({ degree, position: i + 1 }))
    : [...list].sort((a, b) => (descending ? b - a : a - b)).map((degree) => ({ degree, position: null }));

  entries.forEach(({ degree, position }) => {
    const tile = document.createElement("button");
    tile.type = "button";
    // Same coloured circle as the wheel's nodes and the Buttons keys - the
    // tray reads as "these exact notes", not as a separate vocabulary of
    // generic blue chips. Always `.selected`: everything in the tray is,
    // by definition, part of the selection.
    tile.className = "key tile swara-chip selected";
    applySwaraColors(tile, degree);
    tile.innerHTML = keyLabelHtml(degree, labelPrefs);
    if (position) {
      // Order mode: this tile IS one specific recorded occurrence, so its
      // own click (same as clicking its badge) removes exactly that
      // position - not just "one occurrence of this degree" (onRemove),
      // which could target a different tile when a degree repeats.
      if (showPositions) {
        const badges = buildOrderBadgeStack([position], onRemoveOrder);
        if (badges) tile.appendChild(badges);
      }
      tile.addEventListener("click", () => onRemoveOrder(position));
    } else {
      tile.addEventListener("click", () => onRemove(degree));
    }
    tray.appendChild(tile);
  });
  container.appendChild(tray);
}
