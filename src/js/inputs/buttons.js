// Button-row input, plus the "swara selection box" below it (merged in from
// the former separate Assembler style, which was practically the same
// input paradigm wearing a different layout - see specs/02 for the
// original two-style writeup). The buttons themselves are the *only* way
// to select/deselect a note now; the box beneath is purely a display of
// the current selection (in click order when "Record note order" is on,
// sorted by degree otherwise), each of its own tiles independently
// tappable to remove exactly that occurrence via `renderSelectionBox`.
//
// No order-mode badges on the buttons themselves (unlike Piano) - the
// selection box below already shows the assembled order left-to-right, so
// a numbered tag on top of a button (and the extra tap target that comes
// with it) would just duplicate what the box already makes clear.
import { applySwaraColors, keyLabelHtml, renderSelectionBox } from "../notation.js";

// 5 rows, mirroring the piano's shape without drawing an actual keyboard:
// S alone; the 6 notes between S and P (R1 through M2); P alone; the 4
// notes between P and top S (D1 through N3); top S alone.
const BUTTON_ROWS = [[0], [1, 2, 3, 4, 5, 6], [7], [8, 9, 10, 11], [12]];

export function render(container, { selected, onToggle, onRemove, onRemoveOrder, labelPrefs, order, list, descending }) {
  container.className = "buttons-style";
  container.innerHTML = "";

  const rows = document.createElement("div");
  rows.className = "button-rows";
  BUTTON_ROWS.forEach((degrees) => {
    const row = document.createElement("div");
    row.className = "button-sub-row";
    degrees.forEach((degree) => {
      const btn = document.createElement("button");
      btn.type = "button";
      // Same coloured circle the wheel uses for this degree - one note is
      // one colour across every input style now, so switching styles is a
      // change of layout rather than of vocabulary. Sizing is CSS-side
      // (container-relative, see .button-key), not an inline percentage:
      // circles need a diameter cap, or a wide page would blow them up to
      // a sixth of its width.
      btn.className = "key button-key swara-chip" + (selected.has(degree) ? " selected" : "");
      applySwaraColors(btn, degree);
      btn.innerHTML = keyLabelHtml(degree, labelPrefs);
      btn.addEventListener("click", () => onToggle(degree));
      row.appendChild(btn);
    });
    rows.appendChild(row);
  });
  container.appendChild(rows);

  // Only in "Record note order" mode. Outside it the buttons themselves
  // already show the selection - the same notes, lit up, in a layout that
  // doesn't move - so a tray underneath was restating it in a second place
  // and doubling the ways to remove a note. In order mode the tray earns its
  // keep: it's the only thing that shows the *sequence*, including repeats.
  if (order) {
    const box = document.createElement("div");
    renderSelectionBox(box, { list, order, onRemove, onRemoveOrder, labelPrefs, descending, showPositions: false });
    container.appendChild(box);
  }
}
