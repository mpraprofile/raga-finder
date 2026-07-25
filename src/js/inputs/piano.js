// C-C one-octave piano input. See specs/02-swara-keyboard-finder.md.
import { WHITE_KEY_DEGREES, BLACK_KEYS, labelForDegree, buildOrderBadgeStack } from "../notation.js";

const WHITE_KEY_WIDTH_PCT = 100 / WHITE_KEY_DEGREES.length;
const BLACK_KEY_WIDTH_PCT = 7;

// Compound labels (e.g. "R2/G1") stack with G/N on top, R/D on bottom, on
// both key types - a single physical key showing two note names reads
// better stacked than run together on one line.
function keyLabelHtml(degree, labelPrefs) {
  const label = labelForDegree(degree, labelPrefs);
  if (!label.includes("/")) return `<span class="key-label">${label}</span>`;
  const [bottom, top] = label.split("/");
  return `<span class="key-label stacked">${top}<br>${bottom}</span>`;
}

// render(container, { selected, onToggle, onRemoveOrder, labelPrefs,
// order }): (re)builds the whole widget from the current `selected`
// Set<degree> each call. `order`, if given, is a Map<degree, number[]>
// (every 1-based click position for that degree, since a note can recur)
// used to show a small stacked order-badge per key when "record note
// order" is on - clicking a badge calls `onRemoveOrder(position)` to
// remove that exact recorded occurrence. Low Sa (degree 0) and high Sa
// (degree 12) are independent keys/degrees now - no shared state between
// the first and last white key.
export function render(container, { selected, onToggle, onRemoveOrder, labelPrefs, order }) {
  container.className = "piano";
  container.innerHTML = "";

  const buildKey = (degree, className) => {
    const key = document.createElement("button");
    key.className = className + (selected.has(degree) ? " selected" : "");
    key.innerHTML = keyLabelHtml(degree, labelPrefs);
    const badges = buildOrderBadgeStack(order && order.get(degree), onRemoveOrder);
    if (badges) key.appendChild(badges);
    return key;
  };

  WHITE_KEY_DEGREES.forEach((degree, i) => {
    const key = buildKey(degree, "key white-key");
    key.style.left = `${i * WHITE_KEY_WIDTH_PCT}%`;
    key.style.width = `${WHITE_KEY_WIDTH_PCT}%`;
    key.addEventListener("click", () => onToggle(degree));
    container.appendChild(key);
  });

  BLACK_KEYS.forEach(({ degree, afterWhiteIndex }) => {
    const key = buildKey(degree, "key black-key");
    const boundary = (afterWhiteIndex + 1) * WHITE_KEY_WIDTH_PCT;
    key.style.left = `${boundary - BLACK_KEY_WIDTH_PCT / 2}%`;
    key.style.width = `${BLACK_KEY_WIDTH_PCT}%`;
    key.addEventListener("click", (e) => {
      e.stopPropagation();
      onToggle(degree);
    });
    container.appendChild(key);
  });
}
