// The melakarta chakra chart - the SVG and its detail panel.
// See specs/04-melakarta-chakra-wheel.md.
//
// Twelve sectors of six rings, one cell per melakarta. The arrangement is the
// point: the sector fixes the Rishabha-Gandhara pair, the ring fixes the
// Dhaivata-Nishada pair, and which half of the wheel you are in fixes the
// Madhyama - so the chart *is* the derivation rather than a picture of it.
// All three axes are labelled on the chart itself, because a grid of 72
// numbers that only means something after you tap it is not a reference.
//
// Knows nothing about app.js: renderRow and the mela->raga map are handed in
// (importing app.js from here would be circular). Both scraped JSON files are
// optional - without them the chakras go unnamed and the katapayadi decode
// hides, and everything else still works, since everything else is arithmetic
// over data/ragas.json.

import { CHAKRA_COUNT, CHAKRA_SIZE, chakraOf, dnComboOf, derivedRaga, madhyamaOf, melaOf, positionOf, rgComboOf } from "./melakarta.js";
import { renumberLabel } from "./notation.js";

// melakarta.js hands back the mainstream tokens (that is its documented
// contract - the same ones the scraper writes), so both chart axes have to be
// put through the user's numbering preference before they are drawn, exactly
// as a stored raga's own labels are. Only the G and N tokens can move; R, D
// and M pass through renumberLabel unchanged, so a pair is always mapped as a
// pair rather than the caller deciding which half needs it.
function pairLabel(combo, prefs) {
  return `${renumberLabel(combo.labels[0], prefs)} ${renumberLabel(combo.labels[1], prefs)}`;
}

// One square viewBox, scaled to whatever width the page gives it. Every
// number below is in viewBox units, so the whole chart scales as one piece
// and nothing needs to be recomputed on resize.
const VB = 1000;
// Breathing room outside the circle. The chakra labels are set tangentially
// at the rim, so the widest of them (top and bottom of the wheel, where the
// text runs nearly horizontal) reach past the circle's own bounding box - four
// of the twelve were crossing the viewBox edge before this existed. Padding
// the box rather than pulling the rim in keeps the type at its measured size.
const PAD = 24;
const CX = VB / 2;
const CY = VB / 2;
// A generous centre disc, and not only to hold "S P S" and the two half
// labels: the innermost ring is where the ring axis competes with the cell
// numbers for arc, and arc at a given ring is proportional to its radius. At
// R_INNER 136 ring 1 was 82 units wide, which a 72-unit chip and a two-digit
// number could not both fit - and the left half is all two-digit (67-72) where
// the right half is single (1-6), so it failed on one side only. Pushing the
// disc out to 172 makes ring 1 a hundred units wide and the problem goes away.
const R_INNER = 172; // the centre disc: S, P and upper S, which all 72 share
const R_OUTER = 390; // where the cells stop and the chakra rim begins
const R_RIM = 444; // the chakra rim: name outside it, R-G pair inside it
const RING_W = (R_OUTER - R_INNER) / CHAKRA_SIZE;
const SECTOR_DEG = 360 / CHAKRA_COUNT;

// Screen point for a polar coordinate measured *clockwise from 12 o'clock*.
// That convention is what puts chakras 1-6 in the right half and 7-12 in the
// left, which in turn makes the M1/M2 boundary the vertical diameter - the
// one line the classic printed charts always draw.
function pt(r, deg) {
  const a = ((deg - 90) * Math.PI) / 180;
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
}

function f(n) {
  return n.toFixed(1);
}

// Where a cell's number sits inside its own sector, as an offset in degrees
// from that sector's leading edge. Normally dead centre, at half of 30.
//
// The exception is the two sectors flanking the top of the wheel, because the
// ring axis runs up that boundary and the inner cells are where it is
// tightest. The numbers of chakras 1 and 12 step aside, by exactly enough and
// only on the rings that need it - measured rather than guessed: a chip half
// width of 40, a gap, and a two-digit number's rotated half-extent of 22 need
// 66 units of clearance from the axis, which ring 1 (r=190) reaches at 20.5
// degrees and ring 2 (r=227) at 17. From ring 3 outward the ordinary centre
// already clears it, so nothing moves.
const NUMBER_ANGLE = [20.5, 17, 15, 15, 15, 15];

function numberAngle(q, k) {
  if (q === 0) return NUMBER_ANGLE[k];
  if (q === CHAKRA_COUNT - 1) return SECTOR_DEG - NUMBER_ANGLE[k];
  return SECTOR_DEG / 2;
}

// A half disc, centre outward - the two hemispheres of the hub.
function halfDiscPath(r, a0, a1) {
  const [x1, y1] = pt(r, a0);
  const [x2, y2] = pt(r, a1);
  return `M${CX} ${CY}L${f(x1)} ${f(y1)}A${r} ${r} 0 0 1 ${f(x2)} ${f(y2)}Z`;
}

// One cell: the annular sector between two radii and two angles.
function cellPath(r0, r1, a0, a1) {
  const [x1, y1] = pt(r0, a0);
  const [x2, y2] = pt(r0, a1);
  const [x3, y3] = pt(r1, a1);
  const [x4, y4] = pt(r1, a0);
  return `M${f(x1)} ${f(y1)}A${r0} ${r0} 0 0 1 ${f(x2)} ${f(y2)}L${f(x3)} ${f(y3)}A${r1} ${r1} 0 0 0 ${f(x4)} ${f(y4)}Z`;
}

// Text follows the arc it sits in, and flips through 180 degrees in the lower
// half of the wheel so nothing is ever read upside down.
function tangential(x, y, deg) {
  const flip = deg > 90 && deg < 270 ? 180 : 0;
  return `rotate(${f(deg + flip)} ${f(x)} ${f(y)})`;
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function chakraLabel(chakra, chakras) {
  const entry = chakras?.find((c) => c.number === chakra);
  return entry ? `${chakra} ${entry.name}` : `chakra ${chakra}`;
}

function chartSvg(melaNames, chakras, selected, labelPrefs) {
  let s = `<svg class="mela-svg" viewBox="${-PAD} ${-PAD} ${VB + PAD * 2} ${VB + PAD * 2}" role="group" aria-label="Melakarta chakra chart, 72 cells">`;

  // The two hemispheres, themed as hemispheres: an arc band behind the chakra
  // labels, one tone on the M1 side and another on the M2. This is where the
  // Madhyama split is carried now, which is what frees the cells themselves to
  // say something else entirely - see the fill below.
  s += `<path class="mela-half-band half-m1" d="${cellPath(R_OUTER, VB / 2, 0, 180)}"/>`;
  s += `<path class="mela-half-band half-m2" d="${cellPath(R_OUTER, VB / 2, 180, 360)}"/>`;

  // Cells first, then the divider over them, then the ring chips over that -
  // the chips label the same axis the divider draws, so they have to win.
  //
  // Colour is `q % 6`, not `q`: one hue per Rishabha-Gandhara combination, and
  // chakra k and chakra k+6 get *the same colour*, not two tones of it. Those
  // two sectors are diametrically opposite - 180 degrees apart by construction
  // - and they share their R-G pair exactly, differing only in Madhyama. An
  // identical fill is the plainest way to say so, and it makes the pairing
  // readable straight off the chart rather than only from the rim labels.
  // Which half you are in is the band above, the divider, and the hub labels.
  s += '<g class="mela-cells">';
  for (let q = 0; q < CHAKRA_COUNT; q++) {
    const a0 = q * SECTOR_DEG;
    for (let k = 0; k < CHAKRA_SIZE; k++) {
      const mela = melaOf(q + 1, k + 1);
      const r0 = R_INNER + k * RING_W;
      const name = melaNames.get(mela);
      const on = selected === mela;
      s += `<path class="mela-cell ring-${k}${on ? " is-selected" : ""}" data-mela="${mela}" role="button" tabindex="${on ? 0 : -1}"`;
      s += ` aria-label="${esc(name ? `${mela} ${name}` : `Melakarta ${mela}`)}" aria-pressed="${on}"`;
      s += ` d="${cellPath(r0, r0 + RING_W, a0, a0 + SECTOR_DEG)}" fill="var(--mela-c-${q % 6})">`;
      s += `<title>${esc(name ? `${mela} ${name}` : `Melakarta ${mela}`)}</title></path>`;
    }
  }
  s += "</g>";

  // Cell numbers are a separate pass so that no cell's fill can ever paint
  // over a neighbour's number.
  s += '<g class="mela-numbers" aria-hidden="true">';
  for (let q = 0; q < CHAKRA_COUNT; q++) {
    for (let k = 0; k < CHAKRA_SIZE; k++) {
      const mela = melaOf(q + 1, k + 1);
      const am = q * SECTOR_DEG + numberAngle(q, k);
      const [x, y] = pt(R_INNER + k * RING_W + RING_W / 2, am);
      s += `<text x="${f(x)}" y="${f(y)}" transform="${tangential(x, y, am)}">${mela}</text>`;
    }
  }
  s += "</g>";

  // The M1/M2 boundary. It is the vertical diameter by construction, not by
  // coincidence - see pt() above. Runs the full radius so it cuts the two
  // hemisphere bands as well as the cells, rather than stopping short and
  // leaving the bands looking like decoration.
  s += `<line class="mela-divider" x1="${CX}" y1="${CY - VB / 2}" x2="${CX}" y2="${CY + VB / 2}"/>`;

  // Ring axis: the Dhaivata-Nishada pair each ring stands for, stacked up the
  // top of the divider. The room these need is what NUMBER_ANGLE buys.
  s += '<g class="mela-ring-axis">';
  for (let k = 0; k < CHAKRA_SIZE; k++) {
    const dn = dnComboOf(melaOf(1, k + 1));
    const y = CY - (R_INNER + k * RING_W + RING_W / 2);
    s += `<rect x="${CX - 40}" y="${f(y - 15)}" width="80" height="30" rx="6"/>`;
    s += `<text x="${CX}" y="${f(y)}">${pairLabel(dn, labelPrefs)}</text>`;
  }
  s += "</g>";

  // Sector axis: chakra number, its name once the scraper has run, and the
  // Rishabha-Gandhara pair it fixes.
  //
  // Two independent <text> elements at fixed radii rather than one with two
  // <tspan dy>: dy is measured in the rotated frame, so in the lower half of
  // the wheel - where the 180 degree flip is applied - the stack came out
  // upside down, with the R-G pair sitting outside the chakra name it belongs
  // to. Anchoring each line to its own radius makes the order the same all the
  // way round. Both are centred on their radius (dominant-baseline in the CSS)
  // for the same reason: an alphabetic baseline puts the ascenders outward in
  // one half of the wheel and inward in the other, which had the R-G pair
  // three units off the cells on the flipped side and comfortably clear on the
  // other.
  s += '<g class="mela-rim">';
  for (let q = 0; q < CHAKRA_COUNT; q++) {
    const rg = rgComboOf(melaOf(q + 1, 1));
    const am = q * SECTOR_DEG + SECTOR_DEG / 2;
    const [nx, ny] = pt(R_RIM + 28, am);
    const [px, py] = pt(R_RIM - 20, am);
    s += `<text x="${f(nx)}" y="${f(ny)}" transform="${tangential(nx, ny, am)}">${esc(chakraLabel(q + 1, chakras))}</text>`;
    s += `<text class="mela-rim-pair" x="${f(px)}" y="${f(py)}" transform="${tangential(px, py, am)}">${pairLabel(rg, labelPrefs)}</text>`;
  }
  s += "</g>";

  // The hub is barely tinted, so the divider shows straight through it - which
  // is what lets the two half labels sit here at all: set vertically either
  // side of that line at the middle of the chart, each one is reading up its
  // own hemisphere, and the split is named where it is drawn rather than off
  // in a corner.
  // The hub takes the same two neutral tones as the rim bands, split on the
  // same diameter - so each hemisphere is tinted continuously from the centre
  // out to the rim, and the M1/M2 labels sitting in here are on their own
  // half's ground rather than on a neutral disc straddling both.
  s += `<path class="mela-hub-half half-m1" d="${halfDiscPath(R_INNER, 0, 180)}"/>`;
  s += `<path class="mela-hub-half half-m2" d="${halfDiscPath(R_INNER, 180, 360)}"/>`;
  s += `<circle class="mela-hub" cx="${CX}" cy="${CY}" r="${R_INNER}"/>`;
  s += `<text class="mela-hub-notes" x="${CX}" y="${CY - 10}">S &#183; P &#183; S&#775;</text>`;
  s += `<text class="mela-hub-sub" x="${CX}" y="${CY + 40}">in all 72</text>`;
  s += `<text class="mela-half-label" x="${CX - 100}" y="${CY}" transform="rotate(-90 ${CX - 100} ${CY})">Prati M2</text>`;
  s += `<text class="mela-half-label" x="${CX + 105}" y="${CY}" transform="rotate(-90 ${CX + 105} ${CY})">Shuddha M1</text>`;

  return s + "</svg>";
}

// What the three axes mean, in words, under the chart. Not a colour key: the
// ring axis is labelled on the chart itself, where it belongs.
function legendHtml() {
  return (
    '<p class="mela-legend">' +
    "<span><b>Sector</b> Rishabha &amp; Gandhara</span>" +
    "<span><b>Ring</b> Dhaivata &amp; Nishada, position 1 innermost</span>" +
    "<span><b>Half</b> Madhyama</span>" +
    "</p>"
  );
}

// --- Katapayadi ----------------------------------------------------------
// Every decode shown anywhere in the app comes out of data/katapayadi.json,
// which scripts/scrape_katapayadi.py writes only after checking all 72 names
// against their own mela numbers. Deliberately not re-derived here: a second
// implementation of the syllable segmentation would be a second thing to be
// wrong, and this one is the one a human ran and read.
function decodeFor(katapayadi, mela) {
  return katapayadi?.decodes?.find((d) => d.mela === mela) || null;
}

function decodeHtml(decode) {
  if (!decode) return "";
  const chips = decode.syllables
    .map((s) => `<span class="kata-syllable">${esc(s.text)}<span class="kata-arrow">&#8594;</span><span class="kata-digit">${s.digit}</span></span>`)
    .join("");
  const digits = decode.syllables.map((s) => s.digit).join("");
  let out = `<div class="mela-decode"><span class="mela-decode-label">Katapayadi</span>${chips}`;
  out += `<span class="kata-arrow">&#8594;</span><span class="kata-result">${esc(digits)} read right to left = ${decode.value}</span>`;
  if (!decode.matches) out += `<span class="kata-note">does not decode to its own number under the strict rules</span>`;
  return out + "</div>";
}

// The rules and the letter table, for the collapsed block at the foot of the
// page. Hidden entirely when the JSON has not been scraped yet.
export function renderKatapayadiReference(el, katapayadi) {
  const block = el.closest("details") || el;
  if (!katapayadi?.table) {
    block.hidden = true;
    return;
  }
  block.hidden = false;

  let html = "";
  if (katapayadi.rules?.length) html += `<ul class="kata-rules">${katapayadi.rules.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>`;

  const byDigit = new Map();
  for (const [letter, digit] of Object.entries(katapayadi.table)) {
    if (!byDigit.has(digit)) byDigit.set(digit, []);
    byDigit.get(digit).push(letter);
  }
  html += '<table class="reference-table kata-table"><thead><tr><th>Digit</th><th>Consonants</th></tr></thead><tbody>';
  for (const digit of [...byDigit.keys()].sort((a, b) => a - b)) {
    html += `<tr><td>${digit}</td><td>${esc(byDigit.get(digit).join(", "))}</td></tr>`;
  }
  html += "</tbody></table>";

  const failures = (katapayadi.decodes || []).filter((d) => !d.matches);
  if (failures.length) {
    html += `<p class="kata-footnote">${failures.length} of the 72 do not decode to their own number under the strict rules: `;
    html += `${failures.map((d) => `${esc(d.name)} (${d.mela})`).join(", ")}. Listed rather than hidden - the rules are not loosened to make them pass.</p>`;
  }
  el.innerHTML = html;
}

// --- Mounting ------------------------------------------------------------

export function mountMelaChart(root, options) {
  // getLabelPrefs is read at draw time, not captured once: the preference is a
  // live object in app.js that the reference table's radios mutate in place.
  const { melaRagas, renderRow, getChakras, getKatapayadi, getLabelPrefs = () => ({}) } = options;
  const chartEl = root.querySelector(".mela-chart");
  const legendEl = root.querySelector(".mela-legend-wrap");
  const detailEl = root.querySelector(".mela-detail");
  legendEl.innerHTML = legendHtml(); // fixed content: it never depends on selection or on the scraped files
  let selected = null;

  const melaNames = new Map();
  for (const [mela, raga] of melaRagas) melaNames.set(mela, raga.name);

  function ragaFor(mela) {
    return melaRagas.get(mela) || derivedRaga(mela, melaNames.get(mela));
  }

  function renderDetail() {
    detailEl.innerHTML = "";
    if (selected === null) {
      detailEl.innerHTML = '<p class="mela-detail-empty">Pick any cell for its name, its scale, and how its number is spelled into its own name.</p>';
      return;
    }
    const mela = selected;
    const chakra = chakraOf(mela);
    const entry = getChakras()?.find((c) => c.number === chakra);
    const ma = madhyamaOf(mela);

    const head = document.createElement("p");
    head.className = "mela-detail-meta";
    const chakraText = entry ? `chakra ${chakra} ${entry.name}` : `chakra ${chakra}`;
    head.textContent = `${chakraText} · position ${positionOf(mela)} · ${ma.label} ${ma.degree === 5 ? "shuddha" : "prati"} madhyama`;
    detailEl.appendChild(head);

    // The chakra's gloss gets its own line rather than a parenthesis on the
    // one above: these are whole sentences in the source's own words (some of
    // them list all six seasons), and inlining them buried the position and
    // the Madhyama behind a paragraph.
    if (entry?.meaning) {
      const gloss = document.createElement("p");
      gloss.className = "mela-chakra-gloss";
      gloss.textContent = entry.meaning;
      detailEl.appendChild(gloss);
    }

    const decode = decodeFor(getKatapayadi(), mela);
    if (decode) detailEl.insertAdjacentHTML("beforeend", decodeHtml(decode));

    const list = document.createElement("ul");
    list.className = "results mela-detail-row";
    list.appendChild(renderRow(ragaFor(mela)));
    detailEl.appendChild(list);
  }

  function draw() {
    chartEl.innerHTML = chartSvg(melaNames, getChakras(), selected, getLabelPrefs());
    for (const cell of chartEl.querySelectorAll(".mela-cell")) {
      cell.addEventListener("click", () => select(Number(cell.dataset.mela)));
      cell.addEventListener("keydown", onCellKey);
    }
  }

  function select(mela, { focus = false } = {}) {
    selected = mela;
    draw();
    renderDetail();
    const cell = chartEl.querySelector(`.mela-cell[data-mela="${mela}"]`);
    if (focus && cell) cell.focus();
  }

  // One tab stop for the whole chart, not 72 - arrow keys walk it from there.
  // Left/right move round the chakras, up/down move outward and inward
  // through the positions, which is exactly how the two axes are labelled.
  function onCellKey(e) {
    const mela = Number(e.currentTarget.dataset.mela);
    const wrap = (n, max) => ((n - 1 + max) % max) + 1;
    let chakra = chakraOf(mela);
    let position = positionOf(mela);
    switch (e.key) {
      case "ArrowRight":
        chakra = wrap(chakra + 1, CHAKRA_COUNT);
        break;
      case "ArrowLeft":
        chakra = wrap(chakra - 1, CHAKRA_COUNT);
        break;
      case "ArrowUp":
        position = wrap(position + 1, CHAKRA_SIZE);
        break;
      case "ArrowDown":
        position = wrap(position - 1, CHAKRA_SIZE);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        select(mela, { focus: true });
        return;
      default:
        return;
    }
    e.preventDefault();
    select(melaOf(chakra, position), { focus: true });
  }

  draw();
  renderDetail();

  // Called when the scraped JSON arrives, and whenever the swara numbering
  // preference changes - both the chart's own two axes and the detail panel's
  // scale line are rendered under that choice, so both have to be rebuilt to
  // follow it like every other scale in the app does.
  return {
    refresh() {
      draw();
      renderDetail();
    },
  };
}
