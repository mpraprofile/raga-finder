// Plain button-row input - the simplest of the three styles.
import { labelForDegree, buildOrderBadgeStack } from "../notation.js";

// 5 rows, mirroring the piano's shape without drawing an actual keyboard:
// S alone; the 6 notes between S and P (R1 through M2); P alone; the 4
// notes between P and top S (D1 through N3); top S alone.
const BUTTON_ROWS = [[0], [1, 2, 3, 4, 5, 6], [7], [8, 9, 10, 11], [12]];

// Every row is sized off this same column count (the longest row, R1-M2),
// so a button's width is always 1/6 of the row's full width regardless of
// how many buttons actually sit in its own row - a lone S or P button is
// exactly as wide as one of the 6 in row 2, not stretched to fill the row.
// Percentage-based (not a fixed rem size) so all buttons resize together
// as the page width changes, the same way the piano's keys already do.
const BUTTON_COLUMNS = Math.max(...BUTTON_ROWS.map((row) => row.length));
// Keep in sync with .button-sub-row's `gap` in style.css.
const BUTTON_GAP_REM = 0.4;
const BUTTON_WIDTH = `calc((100% - ${BUTTON_COLUMNS - 1} * ${BUTTON_GAP_REM}rem) / ${BUTTON_COLUMNS})`;

// Compound labels (e.g. "R2/G1") stack with G/N on top, R/D on bottom -
// matches the piano/assembler treatment.
function keyLabelHtml(degree, labelPrefs) {
  const label = labelForDegree(degree, labelPrefs);
  if (!label.includes("/")) return `<span class="key-label">${label}</span>`;
  const [bottom, top] = label.split("/");
  return `<span class="key-label stacked">${top}<br>${bottom}</span>`;
}

export function render(container, { selected, onToggle, onRemoveOrder, labelPrefs, order }) {
  container.className = "button-rows";
  container.innerHTML = "";

  BUTTON_ROWS.forEach((degrees) => {
    const row = document.createElement("div");
    row.className = "button-sub-row";
    degrees.forEach((degree) => {
      const btn = document.createElement("button");
      btn.className = "key button-key" + (selected.has(degree) ? " selected" : "");
      btn.style.flex = `0 0 ${BUTTON_WIDTH}`;
      btn.innerHTML = keyLabelHtml(degree, labelPrefs);
      const badges = buildOrderBadgeStack(order && order.get(degree), onRemoveOrder);
      if (badges) btn.appendChild(badges);
      btn.addEventListener("click", () => onToggle(degree));
      row.appendChild(btn);
    });
    container.appendChild(row);
  });
}
