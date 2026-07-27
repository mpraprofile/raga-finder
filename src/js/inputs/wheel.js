// Swara wheel input style. See specs/03-swara-wheel.md.
//
// Angle is the swara, radius is the octave: degree d sits at d x 30 degrees
// clockwise from 12 o'clock, so Sa is at the top and each step round the
// circle is one semitone. M2 (degree 6) therefore lands diametrically
// opposite Sa, because a tritone is half an octave. Degree 12 (upper Sa)
// sits on degree 0's own spoke, further out - the same swara an octave up,
// and the layout says so. A future mandra/tara sthayi is another ring at
// another radius, not a redesign.
//
// Why a circle at all, when Piano and Buttons already select the same 13
// degrees: pitch wraps, so a raga becomes a closed *shape*, and a shape can
// be rotated. The controls that rotate it are the block's own Transpose row
// (index.html + app.js), not the wheel's: they turned out to belong to the
// selection rather than to any one way of drawing it, and Piano wants them
// too.
import { DEGREES, SWARA_PALETTE, applySwaraColors, keyLabelHtml, renderSelectionBox, swaraColor } from "../notation.js";
import { playPianoTone } from "../audio.js";

// All positions are in a 0-100 square coordinate space, applied as
// percentages so the whole widget scales with its container. Retuning any
// of these means re-checking the clearances in specs/03: ring nodes clear
// each other (spacing 2*pi*32/12 = 16.8 vs diameter 13), the ring clears
// the box (32 + 6.5 < 50), S' clears the box (45 + 5 = 50, with the centre
// offset giving the margin), and S' clears S (centre distance 13 vs radii
// sum 11.5).
const CENTRE_X = 50;
const CENTRE_Y = 53; // nudged down: the S' node needs headroom at the top
const RING_R = 32;
const RING_NODE_R = 6.5;
const UPPER_SA_R = 45;
const UPPER_SA_NODE_R = 5.0; // deliberately smaller than a ring node

// How far either side of the ring a pointer still counts as "on the rim".
// This band, split into twelve 30-degree wedges, *is* the hit target - see
// degreeAtPoint. At the 260px separate-mode size one wedge is ~44px along
// the ring and ~47px across the band, so every spoke clears the touch
// guideline without the visible node having to grow (and without the
// per-node invisible hit box specs/03 sketches, which would only matter if
// hit-testing were element-based).
const HIT_BAND = 9;
const UPPER_SA_HIT_R = UPPER_SA_NODE_R + 1.5;

// A fast sweep across all twelve spokes would otherwise fire a burst of
// overlapping oscillators; at this spacing a full circle is still audibly
// a run rather than a chord.
const TONE_MIN_GAP_MS = 55;

// The polygon and the order path are drawn on their own, smaller radius
// rather than through the node centres. Straight from node to node, any skip
// of exactly one degree cuts clean through the skipped note's circle (a 60
// degree chord at r=32 passes within 4.3 of the node between its ends, which
// is inside that node's 6.5 radius) - so a line near a note was ambiguous
// about whether that note was in the scale. At r=22 the tightest case, two
// adjacent pitch classes, clears an unselected node's inner edge by 4.3, and
// a one-degree skip clears it by 6.4. A short radial tick from each used
// pitch class's vertex out to its own node is what says "this note is a
// vertex" - the shape's silhouette is unchanged, only its size. (24 was the
// first try; the 1.5-unit gap it left was too small for a legible tick.)
const SHAPE_R = 22;
const TICK_OUTER_R = 26; // just past the node's inner edge (25.5), so it visibly touches

// Repeated traversals of the same pair of notes are fanned out sideways
// instead of stacked on one line - see appendOrderPath.
const LANE_GAP = 1.7;
const ARROW_LEN = 4.2;
const ARROW_HALF_WIDTH = 2.4;

function nodeRadius(degree) {
  return degree === 12 ? UPPER_SA_NODE_R : RING_NODE_R;
}

function angleFor(degree) {
  return (degree % 12) * 30; // degree 12 shares degree 0's spoke
}

// x = 50 + r*sin(theta), y = 53 - r*cos(theta) - y grows downward.
function pointAt(angleDeg, r) {
  const theta = (angleDeg * Math.PI) / 180;
  return { x: CENTRE_X + r * Math.sin(theta), y: CENTRE_Y - r * Math.cos(theta) };
}

function pointFor(degree) {
  return pointAt(angleFor(degree), degree === 12 ? UPPER_SA_R : RING_R);
}

// A vertex of the shape / a point on the order path: pitch-class space, on
// the inset radius. S and S' share a point here, deliberately - the shape is
// the *set of pitches*, and putting the octave repeat at its own radius would
// give the outline a zero-width spike along the Sa spoke.
function shapePointFor(degree) {
  return pointAt(angleFor(degree), SHAPE_R);
}

// render(container, props) - the shared contract from
// specs/02-swara-keyboard-finder.md, plus `onReplace` (specs/03), which
// replaces the whole selection at once. The wheel drives *every* edit
// through onReplace rather than onToggle: it plays its own tones (a sweep
// has to sound as it happens, before any re-render), so routing adds
// through app.js's onToggle - which plays a tone of its own - would double
// up. `onToggle` is accepted and ignored, the same way Piano and Buttons
// ignore props they don't use.
export function render(container, props) {
  const { selected, list, labelPrefs, order, onReplace, onRemove, onRemoveOrder, descending, summary } = props;
  const orderMode = Boolean(order);

  container.className = "wheel-wrap";
  container.innerHTML = "";

  const root = document.createElement("div");
  root.className = `wheel palette-${SWARA_PALETTE}`;
  container.appendChild(root);

  if (orderMode) appendOrderPath(root, list);
  else appendShape(root, list);

  appendCentre(root, summary);
  const nodesByDegree = appendNodes(root, { selected, labelPrefs, order });

  attachPointerHandlers(root, { selected, list, orderMode, onReplace, nodesByDegree });

  // Order mode only: the recorded positions live in the shared selection
  // box below, not on the wheel. Numbers on the nodes would stack and
  // overlap the moment a note repeated - the exact problem that forced
  // Piano's badge cap - whereas the box has room for as many occurrences as
  // the phrase actually has. The wheel therefore needs no equivalent of
  // piano.MAX_VISIBLE_BADGES: a path never runs out of room. Outside order
  // mode there's nothing for a box to add - the filled nodes and the
  // polygon already show the selection, and tapping a node removes it.
  if (orderMode) {
    const box = document.createElement("div");
    renderSelectionBox(box, { list, order: true, onRemove, onRemoveOrder, labelPrefs, descending });
    container.appendChild(box);
  }
}

// --- The shape in the middle -------------------------------------------

const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl(name, attrs) {
  const el = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function svgLayer(className) {
  return svgEl("svg", { class: className, viewBox: "0 0 100 100", "aria-hidden": "true" });
}

// The short radial ticks joining each used pitch class's node to its vertex
// on the inset shape. Without them the shape floats free of the ring and
// nothing says which notes its corners belong to; with them, a line running
// *past* a node and a line *ending at* one look completely different.
function appendTicks(svg, pitchClasses) {
  for (const pc of pitchClasses) {
    const inner = pointAt(pc * 30, SHAPE_R);
    const outer = pointAt(pc * 30, TICK_OUTER_R);
    svg.appendChild(svgEl("line", { class: "wheel-tick", x1: inner.x, y1: inner.y, x2: outer.x, y2: outer.y }));
  }
}

// Not in order mode: the selected degrees joined into a filled polygon, with
// a conic-gradient whose stops sit at each selected swara's own angle,
// clipped to that polygon. Because the palette's hues already progress around
// the circle, the fill genuinely runs through the colours of the notes
// chosen. Drawn over distinct pitch classes on the inset radius - see
// SHAPE_R for why it isn't drawn through the node centres.
function appendShape(root, list) {
  const pcs = [...new Set(list.map((d) => d % 12))].sort((a, b) => a - b);
  if (pcs.length === 0) return;

  const ticks = svgLayer("wheel-path wheel-ticks");
  appendTicks(ticks, pcs);
  root.appendChild(ticks);

  if (pcs.length < 3) return; // fewer than three points is a line, not a shape

  const points = pcs.map((pc) => pointAt(pc * 30, SHAPE_R));
  const first = swaraColor(pcs[0]);
  const stops = [`${first} 0deg`, ...pcs.map((pc) => `${swaraColor(pc)} ${pc * 30}deg`), `${first} 360deg`];

  const shape = document.createElement("div");
  shape.className = "wheel-shape";
  // A conic gradient starts at 12 o'clock and runs clockwise - the same
  // convention as angleFor - so the stops need no re-mapping, only the
  // centre moved to the wheel's own (offset) centre.
  shape.style.background = `conic-gradient(from 0deg at ${CENTRE_X}% ${CENTRE_Y}%, ${stops.join(", ")})`;
  shape.style.clipPath = `polygon(${points.map((p) => `${p.x}% ${p.y}%`).join(", ")})`;
  root.appendChild(shape);
}

// Where a repeated traversal of the same pair of notes gets pushed to,
// sideways: 0, +1, -1, +2, -2 ... lanes. Drawing them all down the same line
// hid every repeat but the last under the last one drawn.
function laneOffset(index) {
  return (index % 2 === 1 ? 1 : -1) * Math.ceil(index / 2) * LANE_GAP;
}

// In order mode there is no polygon, and that is not a shortcut - a polygon
// needs a simple closed boundary to have an interior worth filling, and a
// recorded sequence supplies neither: it revisits notes (zero-area lobes) and
// crosses itself (even-odd and non-zero winding disagree about what "inside"
// even means). The conic fill's own premise - each swara's colour at its own
// angle, once, in angular order - is exactly what a vakra phrase breaks.
//
// So the *path* carries the colour instead. Each segment is stroked in the
// colour of the note it arrives at, so the line into G3 is G3's colour; every
// segment gets its own arrowhead at its midpoint, filled with a direction
// colour (rising and falling are two different colours, not two orientations
// of the same one); and repeated traversals of the same pair fan out into
// parallel lanes rather than overdrawing each other. Start and end are marked
// with a hollow and a filled dot.
//
// Drawn in pitch-class space like the polygon, so S and S' share a point: an
// ascending scale then closes its own circle, and a step to the upper Sa is a
// zero-length segment, skipped.
function appendOrderPath(root, list) {
  const pcs = [...new Set(list.map((d) => d % 12))].sort((a, b) => a - b);
  const svg = svgLayer("wheel-path");
  appendTicks(svg, pcs);

  const lanes = new Map();
  const segments = [];
  for (let i = 0; i < list.length - 1; i++) {
    const from = list[i];
    const to = list[i + 1];
    if (from % 12 === to % 12) continue; // a repeat, or S -> S': no line to draw
    const key = [from % 12, to % 12].sort((a, b) => a - b).join("-");
    const lane = lanes.get(key) ?? 0;
    lanes.set(key, lane + 1);
    segments.push({ from, to, lane });
  }

  for (const { from, to, lane } of segments) {
    const a = shapePointFor(from);
    const b = shapePointFor(to);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    const ux = dx / len;
    const uy = dy / len;
    // Perpendicular, so repeats of one interval sit side by side.
    const off = laneOffset(lane);
    const ox = -uy * off;
    const oy = ux * off;
    const x1 = a.x + ox;
    const y1 = a.y + oy;
    const x2 = b.x + ox;
    const y2 = b.y + oy;

    const seg = svgEl("line", { class: "wheel-seg", x1, y1, x2, y2 });
    seg.style.stroke = swaraColor(to % 12);
    svg.appendChild(seg);

    // Direction is carried by colour, not just by the arrow pointing: an
    // ascending move and a descending one along the same line are then
    // distinguishable even where the two lanes sit close together.
    const rising = to > from;
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const tipX = mx + (ux * ARROW_LEN) / 2;
    const tipY = my + (uy * ARROW_LEN) / 2;
    const baseX = tipX - ux * ARROW_LEN;
    const baseY = tipY - uy * ARROW_LEN;
    svg.appendChild(
      svgEl("polygon", {
        class: `wheel-arrow ${rising ? "rising" : "falling"}`,
        points: [
          `${tipX},${tipY}`,
          `${baseX - uy * ARROW_HALF_WIDTH},${baseY + ux * ARROW_HALF_WIDTH}`,
          `${baseX + uy * ARROW_HALF_WIDTH},${baseY - ux * ARROW_HALF_WIDTH}`,
        ].join(" "),
      }),
    );
  }

  if (list.length > 0) {
    const start = shapePointFor(list[0]);
    const end = shapePointFor(list[list.length - 1]);
    svg.appendChild(svgEl("circle", { class: "wheel-path-start", cx: start.x, cy: start.y, r: 2.1 }));
    svg.appendChild(svgEl("circle", { class: "wheel-path-end", cx: end.x, cy: end.y, r: 1.6 }));
  }

  root.appendChild(svg);
}

// --- Centre text --------------------------------------------------------

// The live result summary, in the hole the polygon leaves: information that
// otherwise only exists in the list further down the page, and the middle
// of a wheel is the natural place for it. The wrapper is pointer-events:
// none in CSS so it never swallows a sweep; only the button itself takes a
// tap.
function appendCentre(root, summary) {
  if (!summary) return;

  const centre = document.createElement("div");
  centre.className = "wheel-centre";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "wheel-summary";
  btn.textContent = summary.text;
  if (summary.onPlay) {
    btn.title = "Play this raga";
    btn.addEventListener("click", summary.onPlay);
  } else {
    btn.disabled = true;
  }

  centre.appendChild(btn);
  root.appendChild(centre);
}

// --- Nodes --------------------------------------------------------------

function appendNodes(root, { selected, labelPrefs, order }) {
  const nodesByDegree = new Map();

  for (const degree of DEGREES) {
    const { x, y } = pointFor(degree);
    const r = nodeRadius(degree);
    const isSelected = selected.has(degree);

    const node = document.createElement("button");
    node.type = "button";
    node.className = "wheel-node swara-chip" + (isSelected ? " selected" : "");
    node.dataset.degree = String(degree);
    node.style.left = `${x - r}%`;
    node.style.top = `${y - r}%`;
    node.style.width = `${r * 2}%`;
    node.style.height = `${r * 2}%`;

    applySwaraColors(node, degree);
    node.innerHTML = keyLabelHtml(degree, labelPrefs);
    node.setAttribute("aria-pressed", String(isSelected));

    // A node used more than once shows a plain repeat count - not the
    // positions themselves, which belong in the selection box below.
    const repeats = order ? order.get(degree) : null;
    if (repeats && repeats.length > 1) {
      const count = document.createElement("span");
      count.className = "wheel-repeat";
      count.textContent = `×${repeats.length}`;
      node.appendChild(count);
    }

    // Pointer input is handled angularly on the root (see
    // attachPointerHandlers), so this listener exists only for keyboard
    // activation - which reports detail 0, unlike any mouse click.
    node.addEventListener("click", (e) => {
      if (e.detail === 0) root.dispatchEvent(new CustomEvent("wheel-tap", { detail: degree }));
    });

    root.appendChild(node);
    nodesByDegree.set(degree, node);
  }

  return nodesByDegree;
}

// --- Tap and sweep ------------------------------------------------------

let lastToneAt = 0;

function playTone(degree) {
  const now = performance.now();
  if (now - lastToneAt < TONE_MIN_GAP_MS) return;
  lastToneAt = now;
  playPianoTone(degree);
}

// Hit-testing is angular, not element-based: the pointer position is
// converted to (r, theta) about the centre and theta mapped to the nearest
// spoke. That works across the gaps between nodes - which elementFromPoint
// would not - so a sweep never drops a note just because the finger passed
// between two circles. S' is off the ring entirely, so it gets its own
// circular test first; nothing else lives out at that radius.
function degreeAtPoint(root, event) {
  const rect = root.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * 100;
  const y = ((event.clientY - rect.top) / rect.height) * 100;

  const upper = pointFor(12);
  if (Math.hypot(x - upper.x, y - upper.y) <= UPPER_SA_HIT_R) return 12;

  const dx = x - CENTRE_X;
  const dy = y - CENTRE_Y;
  const r = Math.hypot(dx, dy);
  if (r < RING_R - HIT_BAND || r > RING_R + HIT_BAND) return null;

  let angle = (Math.atan2(dx, -dy) * 180) / Math.PI; // clockwise from 12 o'clock
  if (angle < 0) angle += 360;
  return Math.round(angle / 30) % 12;
}

function attachPointerHandlers(root, { selected, list, orderMode, onReplace, nodesByDegree }) {
  if (typeof onReplace !== "function") return;

  // A tap adds and plays, or removes silently - the same rule every other
  // input style follows. In order mode a tap always appends another
  // occurrence, since repeats are the point.
  function commitTap(degree) {
    if (!orderMode && selected.has(degree)) {
      onReplace(list.filter((d) => d !== degree));
      return;
    }
    onReplace([...list, degree]);
  }

  // A sweep **only adds**. Never deselect by dragging: an accidental sweep
  // that wipes a selection is far worse than one that adds a note too many.
  function commitRun(entered) {
    const next = [...list];
    const have = new Set(list);
    for (const degree of entered) {
      if (!orderMode && have.has(degree)) continue;
      next.push(degree);
      have.add(degree);
    }
    if (next.length === list.length) return; // nothing new - don't churn a re-render
    onReplace(next);
  }

  root.addEventListener("wheel-tap", (e) => commitTap(e.detail));

  // A sweep is committed once, on pointerup, rather than note by note:
  // every commit re-renders this whole widget, which would destroy the very
  // element the gesture is captured on. Until then the notes entered so far
  // are shown by toggling the class directly.
  let sweep = null;

  function enter(degree) {
    if (!sweep || degree === sweep.last) return; // holding still inside one node isn't a re-entry
    sweep.last = degree;
    sweep.entered.push(degree);

    const node = nodesByDegree.get(degree);
    if (node && !node.classList.contains("selected")) {
      node.classList.add("selected");
      sweep.marked.push(node);
    }
    // Entering a note that isn't already selected is an add, and adds are
    // audible; touching one you already have stays silent, matching the
    // silent-deselect rule. In order mode every entry is an add.
    if (orderMode || !sweep.have.has(degree)) playTone(degree);
    sweep.have.add(degree);
  }

  root.addEventListener("pointerdown", (e) => {
    if (sweep) return;
    if (e.target.closest(".wheel-centre")) return; // the summary button takes its own taps
    const degree = degreeAtPoint(root, e);
    if (degree === null) return;
    e.preventDefault();
    // So the gesture survives leaving a node's box. Guarded: capture throws
    // NotFoundError if the pointer isn't active by the time we ask, and
    // losing the whole sweep over that would be worse than running it
    // uncaptured (which still works as long as the finger stays on the
    // widget).
    try {
      root.setPointerCapture(e.pointerId);
    } catch {
      /* not capturable - carry on uncaptured */
    }
    sweep = { pointerId: e.pointerId, entered: [], marked: [], have: new Set(selected), last: null };
    enter(degree);
  });

  root.addEventListener("pointermove", (e) => {
    if (!sweep || e.pointerId !== sweep.pointerId) return;
    const degree = degreeAtPoint(root, e);
    if (degree === null) return; // drifting off the rim pauses the sweep, it doesn't end it
    enter(degree);
  });

  root.addEventListener("pointerup", (e) => {
    if (!sweep || e.pointerId !== sweep.pointerId) return;
    const { entered } = sweep;
    sweep = null;
    // Tap vs sweep: a gesture that touched exactly one node is a tap, so it
    // toggles and can therefore deselect; one that touched more is an
    // add-run and turns nothing off. Without this rule a plain tap would be
    // a one-node sweep and lose the ability to deselect at all.
    if (entered.length === 1) commitTap(entered[0]);
    else if (entered.length > 1) commitRun(entered);
  });

  root.addEventListener("pointercancel", (e) => {
    if (!sweep || e.pointerId !== sweep.pointerId) return;
    for (const node of sweep.marked) node.classList.remove("selected");
    sweep = null;
  });
}
