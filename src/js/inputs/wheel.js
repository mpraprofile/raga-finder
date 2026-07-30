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
import { DEGREES, SWARA_PALETTE, applySwaraColors, keyLabelHtml, labelForDegree, renderSelectionBox, stackReferenceLabel, swaraColor } from "../notation.js";
import { playPianoTone } from "../audio.js";

// All positions are in a 0-100 square coordinate space, applied as
// percentages so the whole widget scales with its container.
//
// Four concentric bands, from the middle out: the shape, the ring of note
// circles, the S' circle, and - only while transposed - the reference ring
// of original swara names. Retuning any of these means re-checking every
// clearance below.
const CENTRE_X = 50;
const CENTRE_Y = 50;
const RING_R = 27.5;
const RING_NODE_R = 5.6;
const UPPER_SA_R = 38.5;
const UPPER_SA_NODE_R = 4.6; // deliberately smaller than a ring node
// The reference ring sits close in, just outside the note circles, so a spoke
// reads as one thing: the swara that is there now and the swara that used to
// be, a few units apart. Out at 47.5 - where it started, because that was the
// only radius that cleared the S' circle - it read as a separate ring of text
// with a gap of nothing in the middle.
//
// One spoke can't have that: the one S and S' have rotated onto. S' is a real
// circle out at 38.5 and would sit straight on top of a label at 37.5, so that
// single label keeps the old outer radius and steps over it. Eleven labels
// close in and one further out looks deliberate, which it is - the far one is
// exactly where the extra circle is.
const REF_R = 37.5;
const REF_R_SA_SPOKE = 47.5;

// Clearances, all satisfied:
//   ring nodes clear each other  2*pi*27.5/12 = 14.4  vs diameter 11.2
//   S' clears S                  38.5 - 27.5 = 11.0   vs radii sum 10.2
//   near labels clear the nodes  37.5 - 2.3 = 35.2    vs node edge 33.1
//   the Sa-spoke label clears S' 47.5 - 2.3 = 45.2    vs S' edge 43.1
//   the reference ring clears the box  47.5 + 2.3 = 49.8  <  50
//
// A label's clearance is not a radial sum, which is what an earlier version got
// wrong: it is a horizontal *box* sitting on a spoke, so on a diagonal spoke
// its inner corner reaches much further in than its centre does. The 2.3 above
// is that corner's reach - half the height of a two-line name - and it only
// stayed that small because compound names are set on two lines. On one line
// ("R2 / G3", 7.5 units wide) the corner came 4.3 units in, which is what used
// to put it inside the S' circle.
// The whole wheel is smaller than it was (the ring was 32) to buy the outer
// band. That band is empty at zero transpose, but the geometry stays fixed
// either way - a wheel that resized itself the moment you pressed Transpose
// would be a far worse trade than a slightly smaller one that never moves.

// How far either side of the ring a pointer still counts as "on the rim".
// This band, split into twelve 30-degree wedges, *is* the hit target - see
// degreeAtPoint. At 380px one wedge is ~55px along the ring and ~61px across
// the band, so every spoke clears the touch guideline comfortably without the
// visible node having to grow.
const HIT_BAND = 8;
const UPPER_SA_HIT_R = UPPER_SA_NODE_R + 1.5;

// A fast sweep across all twelve spokes would otherwise fire a burst of
// overlapping oscillators; at this spacing a full circle is still audibly
// a run rather than a chord.
const TONE_MIN_GAP_MS = 55;

// The polygon and the order path are drawn on their own, smaller radius
// rather than through the node centres. Straight from node to node, any skip
// of exactly one degree cuts clean through the skipped note's circle - so a
// line near a note was ambiguous about whether that note was in the scale. At
// r=18.5 the tightest case, two adjacent pitch classes, passes 17.9 from the
// centre against an unselected node's inner edge of 21.9. A short radial tick
// from each used pitch class's vertex out to its own node is what says "this
// note is a vertex" - the shape's silhouette is unchanged, only its size.
const SHAPE_R = 18.5;
const TICK_OUTER_R = 22.5; // just past the node's inner edge (21.9), so it visibly touches

// Repeated traversals of the same pair of notes are fanned out sideways
// instead of stacked on one line - see appendOrderPath.
const LANE_GAP = 1.5;
const ARROW_LEN = 3.6;
const ARROW_HALF_WIDTH = 2.1;

function nodeRadius(degree) {
  return degree === 12 ? UPPER_SA_NODE_R : RING_NODE_R;
}

// Transposing rotates the wheel. `labelOffset` is where Sa now physically
// sits, in semitones from the original - the same value that slides the
// Piano's labels along its keys - so the spoke a degree occupies is its own
// position plus that offset. Sa is at 12 o'clock only at zero transpose;
// after that the S and S' circles have moved round to the new tonic, which is
// what makes graha bhēdam legible as a rotation rather than as the note set
// silently changing underneath a fixed frame.
//
// The twelve spoke *positions* never move - only which swara sits on each.
function angleFor(degree, labelOffset = 0) {
  return (((degree + labelOffset) % 12) + 12) % 12 * 30; // degree 12 shares degree 0's spoke
}

// x = 50 + r*sin(theta), y = 50 - r*cos(theta) - y grows downward.
function pointAt(angleDeg, r) {
  const theta = (angleDeg * Math.PI) / 180;
  return { x: CENTRE_X + r * Math.sin(theta), y: CENTRE_Y - r * Math.cos(theta) };
}

function pointFor(degree, labelOffset = 0) {
  return pointAt(angleFor(degree, labelOffset), degree === 12 ? UPPER_SA_R : RING_R);
}

// A vertex of the shape / a point on the order path: pitch-class space, on
// the inset radius. S and S' share a point here, deliberately - the shape is
// the *set of pitches*, and putting the octave repeat at its own radius would
// give the outline a zero-width spike along the Sa spoke.
function shapePointFor(degree, labelOffset = 0) {
  return pointAt(angleFor(degree, labelOffset), SHAPE_R);
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
  const { selected, list, labelPrefs, order, onReplace, summary, insertAt, labelOffset = 0 } = props;
  const orderMode = Boolean(order);

  container.className = "wheel-wrap";
  container.innerHTML = "";

  const root = document.createElement("div");
  root.className = `wheel palette-${SWARA_PALETTE}`;
  container.appendChild(root);

  if (orderMode) appendOrderPath(root, list, labelOffset);
  else appendShape(root, list, labelOffset);

  appendCentre(root, summary);
  const nodesByDegree = appendNodes(root, { selected, labelPrefs, order, labelOffset });
  appendReferenceRing(root, labelPrefs, labelOffset);

  attachPointerHandlers(root, { selected, list, orderMode, onReplace, nodesByDegree, insertAt, labelOffset });

  // Order mode only: the recorded positions live in the shared selection
  // box below, not on the wheel. Numbers on the nodes would stack and
  // overlap the moment a note repeated - the problem that eventually cost
  // the Piano its per-key badges too - whereas the box has room for as many
  // occurrences as the phrase actually has. Outside order mode there's
  // nothing for a box to add - the filled nodes and the polygon already show
  // the selection, and tapping a node removes it.
  if (orderMode) {
    const box = document.createElement("div");
    renderSelectionBox(box, { ...props, order: true });
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
function appendTicks(svg, pitchClasses, labelOffset) {
  for (const pc of pitchClasses) {
    const angle = angleFor(pc, labelOffset);
    const inner = pointAt(angle, SHAPE_R);
    const outer = pointAt(angle, TICK_OUTER_R);
    svg.appendChild(svgEl("line", { class: "wheel-tick", x1: inner.x, y1: inner.y, x2: outer.x, y2: outer.y }));
  }
}

// Not in order mode: the selected degrees joined into a filled polygon, with
// a conic-gradient whose stops sit at each selected swara's own angle,
// clipped to that polygon. Because the palette's hues already progress around
// the circle, the fill genuinely runs through the colours of the notes
// chosen. Drawn over distinct pitch classes on the inset radius - see
// SHAPE_R for why it isn't drawn through the node centres.
function appendShape(root, list, labelOffset) {
  const pcs = [...new Set(list.map((d) => d % 12))].sort((a, b) => a - b);
  if (pcs.length === 0) return;

  const ticks = svgLayer("wheel-path wheel-ticks");
  appendTicks(ticks, pcs, labelOffset);
  root.appendChild(ticks);

  if (pcs.length < 3) return; // fewer than three points is a line, not a shape

  // Ordered by the spoke each pitch class currently occupies, not by degree -
  // once the wheel is rotated those are different orders, and a conic
  // gradient's stops have to run round the circle monotonically or the fill
  // doubles back on itself.
  const placed = pcs.map((pc) => ({ pc, angle: angleFor(pc, labelOffset) })).sort((a, b) => a.angle - b.angle);
  const points = placed.map(({ angle }) => pointAt(angle, SHAPE_R));
  const first = swaraColor(placed[0].pc);
  const stops = [`${first} 0deg`, ...placed.map(({ pc, angle }) => `${swaraColor(pc)} ${angle}deg`), `${first} 360deg`];

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
function appendOrderPath(root, list, labelOffset) {
  const pcs = [...new Set(list.map((d) => d % 12))].sort((a, b) => a - b);
  const svg = svgLayer("wheel-path");
  appendTicks(svg, pcs, labelOffset);

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
    const a = shapePointFor(from, labelOffset);
    const b = shapePointFor(to, labelOffset);
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
    const start = shapePointFor(list[0], labelOffset);
    const end = shapePointFor(list[list.length - 1], labelOffset);
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

function appendNodes(root, { selected, labelPrefs, order, labelOffset }) {
  const nodesByDegree = new Map();

  for (const degree of DEGREES) {
    const { x, y } = pointFor(degree, labelOffset);
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

// --- Reference ring -----------------------------------------------------

// The swara that sat on each spoke *before* the transpose, dulled, just outside
// the note circles. Once the wheel rotates, the spoke at 12 o'clock is no longer
// Sa, and without this there is nothing left on screen tying the new arrangement
// to the one it came from - which is exactly what graha bhēdam is about. Reading
// a spoke outward gives "this note is now G2; it used to be P", and the two now
// sit close enough together to be read as one phrase.
//
// Only drawn while transposed. At zero offset it would restate the note
// circles it encloses, word for word.
function appendReferenceRing(root, labelPrefs, labelOffset) {
  if (!labelOffset) return;

  const ring = document.createElement("div");
  ring.className = "wheel-ref-ring";
  ring.setAttribute("aria-hidden", "true"); // the nodes already name every swara

  // Whichever spoke S and S' have rotated onto - the one label that has to
  // stand off further, since S' is a real circle in its way. See REF_R.
  const saSpoke = (((labelOffset % 12) + 12) % 12);

  for (let pc = 0; pc < 12; pc++) {
    const { x, y } = pointAt(pc * 30, pc === saSpoke ? REF_R_SA_SPOKE : REF_R);
    const label = document.createElement("span");
    label.className = "wheel-ref-label";
    label.style.left = `${x}%`;
    label.style.top = `${y}%`;
    // A compound name stacks, the way the node it echoes does - and in the same
    // order, higher swara on top, since stackReferenceLabel is what the Piano's
    // annotations use too. It was one wide line here originally, to keep a
    // reference mark from competing with a real label, but that width is
    // exactly what S' collided with (see the clearance note above).
    // .wheel-ref-label is white-space: pre-line, so the newline breaks.
    label.textContent = stackReferenceLabel(labelForDegree(pc, labelPrefs));
    ring.appendChild(label);
  }
  root.appendChild(ring);
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
function degreeAtPoint(root, event, labelOffset) {
  const rect = root.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * 100;
  const y = ((event.clientY - rect.top) / rect.height) * 100;

  const upper = pointFor(12, labelOffset);
  if (Math.hypot(x - upper.x, y - upper.y) <= UPPER_SA_HIT_R) return 12;

  const dx = x - CENTRE_X;
  const dy = y - CENTRE_Y;
  const r = Math.hypot(dx, dy);
  if (r < RING_R - HIT_BAND || r > RING_R + HIT_BAND) return null;

  let angle = (Math.atan2(dx, -dy) * 180) / Math.PI; // clockwise from 12 o'clock
  if (angle < 0) angle += 360;
  // Which spoke was hit, then which degree currently sits on it - the inverse
  // of angleFor, so the hit test rotates with the wheel.
  const spoke = Math.round(angle / 30) % 12;
  return (((spoke - labelOffset) % 12) + 12) % 12;
}

function attachPointerHandlers(root, { selected, list, orderMode, onReplace, nodesByDegree, insertAt, labelOffset }) {
  if (typeof onReplace !== "function") return;

  // Where new swaras land. Ordinarily the end; in order mode the selection
  // tray's caret can point somewhere inside the phrase instead, and a sweep
  // then goes in as a run at that point rather than being reversed into it
  // one note at a time.
  const place = (additions) => {
    if (!orderMode || insertAt === null || insertAt === undefined || insertAt > list.length) return [...list, ...additions];
    return [...list.slice(0, insertAt), ...additions, ...list.slice(insertAt)];
  };

  // A tap adds and plays, or removes silently - the same rule every other
  // input style follows. In order mode a tap always appends another
  // occurrence, since repeats are the point.
  function commitTap(degree) {
    if (!orderMode && selected.has(degree)) {
      onReplace(list.filter((d) => d !== degree));
      return;
    }
    onReplace(place([degree]));
  }

  // A sweep **only adds**. Never deselect by dragging: an accidental sweep
  // that wipes a selection is far worse than one that adds a note too many.
  function commitRun(entered) {
    const additions = [];
    const have = new Set(list);
    for (const degree of entered) {
      if (!orderMode && have.has(degree)) continue;
      additions.push(degree);
      have.add(degree);
    }
    if (additions.length === 0) return; // nothing new - don't churn a re-render
    onReplace(place(additions));
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
    const degree = degreeAtPoint(root, e, labelOffset);
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
    const degree = degreeAtPoint(root, e, labelOffset);
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
