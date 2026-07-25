// Note assembler: tap-to-add/tap-to-remove between a palette and a "your
// scale" tray. Not real HTML5 drag-and-drop, which doesn't work well on
// mobile touch - renamed from the earlier "drag-drop" label to describe
// what it actually does.
//
// The palette stays permanently populated with all 13 notes, tapped or
// not, so a note can be added more than once - vakra ragas repeat notes
// within a scale, and there's no reason to make that harder to build here
// than it needs to be. That means a palette tap is always "add" (`onAdd`)
// and a tray tap is always "remove one occurrence" (`onRemove`) - never a
// toggle of a single selected/unselected state, since a degree can appear
// zero, one, or many times in the underlying sequence at once. This holds
// regardless of "Record note order" (app.js's `orderMode`), which this
// style *does* offer alongside piano/buttons (an earlier version hid it
// for Assembler entirely - reverted, that was a mistake). What order mode
// changes here is narrower: the tray stops sorting and shows the recorded
// click order instead, with each tile carrying its own position badge.
import { DEGREES, labelForDegree, buildOrderBadgeStack } from "../notation.js";

// Compound labels (e.g. "R2/G1") stack with G/N on top, R/D on bottom -
// matches the piano/buttons treatment.
function keyLabelHtml(degree, labelPrefs) {
  const label = labelForDegree(degree, labelPrefs);
  if (!label.includes("/")) return `<span class="key-label">${label}</span>`;
  const [bottom, top] = label.split("/");
  return `<span class="key-label stacked">${top}<br>${bottom}</span>`;
}

// `list`: the raw insertion-ordered array (may contain a degree more than
// once). `descending`: true for the avarohana tray (high to low); every
// other tray (combined, arohana) sorts ascending - but only outside order
// mode. `order`: the same Map<degree, number[]> piano/buttons get, though
// here only its truthiness matters (is order mode on) - each tray tile is
// already its own occurrence, so its position badge comes directly from
// that tile's own index in the unsorted `list`, not from the map.
export function render(container, { list, onAdd, onRemove, onRemoveOrder, labelPrefs, order, descending }) {
  container.className = "assembler";
  container.innerHTML = "";

  const paletteLabel = document.createElement("p");
  paletteLabel.className = "assembler-label";
  paletteLabel.textContent = "Palette - tap to add (repeats allowed)";
  container.appendChild(paletteLabel);

  const palette = document.createElement("div");
  palette.className = "tile-row palette";
  DEGREES.forEach((degree) => {
    const tile = document.createElement("button");
    tile.className = "key tile";
    tile.innerHTML = keyLabelHtml(degree, labelPrefs);
    tile.addEventListener("click", () => onAdd(degree));
    palette.appendChild(tile);
  });
  container.appendChild(palette);

  const trayLabel = document.createElement("p");
  trayLabel.className = "assembler-label";
  trayLabel.textContent = order ? "Your scale, in the order added - tap to remove" : "Your scale - tap to remove";
  container.appendChild(trayLabel);

  const tray = document.createElement("div");
  tray.className = "tile-row tray";
  // Order mode: show the recorded click order as-is, one badge per tile
  // (its own 1-based position). Otherwise sort by degree, no badges.
  const entries = order
    ? list.map((degree, i) => ({ degree, position: i + 1 }))
    : [...list].sort((a, b) => (descending ? b - a : a - b)).map((degree) => ({ degree, position: null }));
  entries.forEach(({ degree, position }) => {
    const tile = document.createElement("button");
    tile.className = "key tile selected";
    tile.innerHTML = keyLabelHtml(degree, labelPrefs);
    if (position) {
      // Order mode: this tile IS one specific recorded occurrence, so its
      // own click (same as clicking its badge) removes exactly that
      // position - not just "one occurrence of this degree" (onRemove),
      // which could target a different tile when a degree repeats.
      const badges = buildOrderBadgeStack([position], onRemoveOrder);
      if (badges) tile.appendChild(badges);
      tile.addEventListener("click", () => onRemoveOrder(position));
    } else {
      tile.addEventListener("click", () => onRemove(degree));
    }
    tray.appendChild(tile);
  });
  container.appendChild(tray);
}
