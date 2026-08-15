// The per-raga detail page - specs/06-raga-detail-page.md.
//
// Phase 2 builds the shell and three of its sixteen sections: identity, the
// scale, and the melakarta/janya context. The rest arrive in later phases, and
// the section order here is the human's field order, so a new section slots in
// where the spec already put it rather than wherever it happened to be built.
//
// The rule that shapes every section: **render only what there is data for.**
// Roughly seven hundred ragas have nothing but a name, a parent mela and two
// scales, and a page of empty headings would be the same page for all of them.
// A raga with little to say gets a short page that looks deliberate.
//
// This module owns layout and nothing else. Playback, the current Key, the
// numbering preference and navigation all live in app.js and arrive through
// `deps` - the same arrangement mountMelaChart uses, and for the same reason:
// the sound and the selection are one app-wide thing, and a second module
// holding its own opinion about either is how they drift apart.

import { noteLabel } from "./notation.js";
import { chakraOf, positionOf, madhyamaOf, melaScale } from "./melakarta.js";
import { decodeFor, decodeHtml } from "./mela-chart.js";

const JATI_COUNTS = { audava: 5, shadava: 6, sampurna: 7 };

// Every link between raga pages goes through here, so the route shape is
// written once. app.js's router parses the other half of it.
export function ragaHref(raga) {
  return `#raga/${encodeURIComponent(raga.id)}`;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function section(title) {
  const wrap = el("section", "raga-section");
  wrap.appendChild(el("h3", "raga-section-title", title));
  return wrap;
}

// The "Janya · of melakarta #29-Dhirasankarabharanam" unit, used by a result
// row and by this page's own chip line. It lives here, and is exported rather
// than written twice, because the two are meant to be the same object: a raga
// should wear its labels identically in a list and on its own page, and two
// copies of this markup would drift the first time one of them was touched.
//
// A janya gets a chip like a melakarta does, but the parent is a
// cross-reference to another raga rather than a label from a closed set, and
// "of melakarta #29-Dhirasankarabharanam" is far too long to read inside a
// pill. So the chip carries the category and the reference trails it as a
// qualifier in the chip's own size and colour, the two reading as one object.
// Both sit in one .result-janya flex item: the line wraps around the pair,
// never between them, so the qualifier can never be orphaned from its chip.
//
// `parent` is the parent melakarta's raga (or null) - passing it in rather than
// looking it up keeps this free of any particular caller's data plumbing.
export function janyaUnit(raga, parentName, parent) {
  const wrap = el("span", "result-janya");
  wrap.appendChild(el("span", "badge badge-janya", "Janya"));

  const note = el("span", "result-janya-note");
  if (raga.mela == null) {
    note.textContent = "parent melakarta unknown";
  } else {
    note.append("of melakarta ");
    // U+2011 non-breaking hyphen, as melaContext uses: the number and the name
    // are one identifier and must not break across lines (ragas.js).
    const label = `#${raga.mela}${parentName ? `‑${parentName}` : ""}`;
    if (parent) {
      const link = el("a", "parent-mela-link", label);
      link.href = ragaHref(parent);
      note.appendChild(link);
    } else {
      note.append(label);
    }
  }
  wrap.appendChild(note);
  return wrap;
}

// --- 1. Identity ----------------------------------------------------------

function identityBlock(raga, deps) {
  const head = el("header", "raga-head");

  // The name has the heading to itself. The chips sit on their own line under
  // it, as they do on a result row: inside the <h2> they were part of the
  // heading's text, so a long name pushed them to a second line at an arbitrary
  // point and they read as a tail on the title rather than as a set.
  const title = el("h2", "raga-title");
  title.append(raga.name);
  head.appendChild(title);

  const chips = el("div", "raga-chips");
  // Both traditions are badged, and the tradition comes first. Until
  // 2026-08-14 only the 43 Hindustani rows were, on the reasoning that
  // Carnatic is this app's unmarked default - but the *names* carried a
  // "{Hindustani}" tag then, so this badge was a second copy of something the
  // title already said, and a Carnatic raga was identifiable by the absence of
  // a tag in its name rather than by the absence of a badge. With the tags
  // gone the badge is the only carrier, and "no badge" is not something a
  // reader can be asked to interpret.
  const isHindustani = raga.tradition === "hindustani";
  chips.appendChild(el("span", `badge badge-tradition${isHindustani ? " hindustani" : ""}`,
    isHindustani ? "Hindustani" : "Carnatic"));
  // Melakarta or janya, on the same line and in the same shapes a result row
  // uses. The number rides in the chip either way, so the prose mela line this
  // page used to carry underneath is gone: for a melakarta it repeated the chip
  // exactly, and for a janya it is now this unit's own qualifier.
  if (raga.is_melakarta) {
    chips.appendChild(el("span", "badge badge-mela", `Melakarta #${raga.mela}`));
  } else {
    const parent = deps.melakartaFor?.(raga.mela) || null;
    chips.appendChild(janyaUnit(raga, parent?.name || deps.melaNames?.get(raga.mela), parent));
  }
  head.appendChild(chips);

  // Aliases sit beside the name rather than in a section of their own: 14
  // ragas have any, and "also called" reads as part of the name anyway.
  if (raga.aliases?.length) {
    head.appendChild(el("p", "raga-alsocalled", `also called ${raga.aliases.join(", ")}`));
  }

  // Three rarely-filled fields (school 1, qualifier 2, composer 10) share one
  // line, so none earns a heading and the common case adds no vertical space.
  // `qualifier` is what the name's brace tag used to say where it said more
  // than a tradition - Hameer Kalyani's "Carnatic interpretation of Kedar" is
  // a real fact about the raga, and dropping the brace without rehousing it
  // would have deleted it from the app rather than tidied it.
  const attribution = [
    raga.school ? `${raga.school} school` : null,
    raga.qualifier || null,
    raga.composer ? `composed by ${raga.composer}` : null,
  ].filter(Boolean);
  if (attribution.length) {
    head.appendChild(el("p", "raga-attrib", attribution.join(" · ")));
  }
  return head;
}

// --- 2. The scale ---------------------------------------------------------

// Prose that names a scale, with the scale rendered rather than spelled.
//
// A human's recorded note has to be able to say "the stored scale is X" - but
// writing X as text pins it to whichever numbering convention the author used,
// and the page next to it renders scales in whichever convention the *reader*
// chose. Suddha Dhanyasi showed both at once: the scale read `S G1 M1 P N1 Ṡ`
// under the alt default while the note beneath it said "S G2 M1 P N2 S", the
// same six notes contradicting themselves on one screen.
//
// So notes reference their scales as `{name}` and store the degrees in a
// `scales` object beside the text. Everything on the page then answers to one
// setting, and the stored data holds degrees rather than somebody's spelling -
// which is the rule CLAUDE.md already applies to ragas.json, arriving late to
// the one file that writes prose.
function renderProseWithScales(container, text, scales, labelPrefs) {
  const parts = String(text).split(/(\{[a-z_]+\})/i);
  for (const part of parts) {
    const ref = /^\{([a-z_]+)\}$/i.exec(part);
    const notes = ref && scales?.[ref[1]];
    if (!notes) {
      // An unresolved {token} is left exactly as written rather than hidden:
      // a note referring to a scale nobody supplied is a mistake to see.
      container.append(part);
      continue;
    }
    container.appendChild(scaleNotes(notes, labelPrefs));
  }
}

function scaleNotes(notes, labelPrefs) {
  const wrap = el("span", "raga-scale-notes");
  for (const note of notes) {
    wrap.appendChild(el("span", "swara-code", noteLabel(note, labelPrefs)));
  }
  return wrap;
}

function scaleLine(raga, direction, deps) {
  const row = el("div", "raga-scale-line");
  row.appendChild(el("span", "raga-scale-label", direction === "arohana" ? "Arohana" : "Avarohana"));
  row.appendChild(scaleNotes(raga[direction], deps.labelPrefs));

  const play = el("button", "result-play-btn raga-play-btn");
  play.type = "button";
  play.title = `Play the ${direction}`;
  deps.attachPlayer(play, () => deps.scaleSequence(raga, direction));
  row.appendChild(play);
  return row;
}

function scaleBlock(raga, deps) {
  const wrap = section("Swaras");
  wrap.appendChild(scaleLine(raga, "arohana", deps));
  wrap.appendChild(scaleLine(raga, "avarohana", deps));

  const anya = anyaSwaraLine(raga, deps);
  if (anya) wrap.appendChild(anya);

  const actions = el("div", "raga-scale-actions");
  const both = el("button", "result-play-btn raga-play-both");
  both.type = "button";
  both.title = "Play the arohana and the avarohana";
  deps.attachPlayer(both, () => deps.scaleSequence(raga, "both"));
  actions.appendChild(both);
  actions.appendChild(el("span", "raga-play-both-label", "Play both"));
  // Straight from the result rows, unchanged - the way back from reading about
  // a raga to hearing it under your own hands.
  actions.appendChild(deps.loadButton(raga));
  wrap.appendChild(actions);

  const tempo = tempoControl(deps);
  if (tempo) wrap.appendChild(tempo);
  return wrap;
}

// Speed for every Play on this page, directly under the one you are most
// likely to press - and the same control the finder shows beside each of its
// three Loop toggles. Radio pills in the shape the Controls panel uses for
// Theme and Layout, so a choice-of-several looks the same wherever it appears.
//
// No listener here. Every copy of this control is a view of one number, so
// app.js hears them all through a single delegated handler on data-tempo and
// writes the answer back to all of them; this only has to render the value as
// it stands when the page is built.
//
// The name attribute is unique per render: a raga page is rebuilt on every
// route change, and two live radio groups sharing a name would let a stale one
// steal the checked state from the visible one.
let tempoGroupSeq = 0;

function tempoControl(deps) {
  if (!deps.tempo) return null;
  const wrap = el("fieldset", "tempo-pills raga-tempo");
  wrap.appendChild(el("legend", null, "Tempo"));
  const groupName = `raga-tempo-${++tempoGroupSeq}`;

  for (const rate of deps.tempo.choices) {
    const label = el("label");
    const input = el("input");
    input.type = "radio";
    input.name = groupName;
    // The same hook the finder's three copies carry, so one change handler
    // and one sync pass cover every tempo control on the page.
    input.dataset.tempo = String(rate);
    input.checked = rate === deps.tempo.get();
    label.appendChild(input);
    label.append(`${rate}x`);
    wrap.appendChild(label);
  }
  return wrap;
}

// --- 3. Classification ----------------------------------------------------

// "audava-sampurna" is the source's own word for the shape and teaches nothing
// to anyone who has not already been taught it, so it is always glossed.
function jatiGloss(jati) {
  const [up, down] = String(jati).split("-");
  const a = JATI_COUNTS[up];
  const d = JATI_COUNTS[down];
  if (!a || !d) return null;
  return a === d
    ? `${a} notes each way`
    : `${a} notes ascending, ${d} descending`;
}

// Whether the scale turns back on itself - the property that makes a raga
// vakra. Derived from the degrees rather than read from a source, because
// spec 06 Phase 1 measured the alternative and found it wanting: the article
// infobox `Type` row says "Vakra" for exactly one raga out of the 23 that
// carry the row at all.
//
// The subtlety is the 56 scales that step across Sa into an octave the schema
// cannot hold (see PROGRESS.md). A plain monotonicity test calls all of them
// vakra - Punnagavarali's arohana opens on the *mandra* nishada, stored as
// degree 10, so the run reads as a fifth-and-a-half leap downwards before it
// starts. Testing only from the first Sa of an arohana, and only down to the
// first Sa of an avarohana, skips those octave artefacts and leaves the real
// zigzags: 374 ragas rather than the naive 397, and the 23 removed are exactly
// the octave-crossers. It under-reports rather than over-reports, which is the
// right way round - the ones it misses are scales whose stored octaves are
// already known to be wrong.
function isVakra(raga) {
  const aro = degreesOf(raga.arohana);
  const ava = degreesOf(raga.avarohana);
  const fromSa = aro.indexOf(0);
  const toSa = ava.indexOf(0);
  const up = fromSa === -1 ? aro : aro.slice(fromSa);
  const down = toSa === -1 ? ava : ava.slice(0, toSa + 1);
  return up.some((d, i) => i > 0 && d <= up[i - 1])
    || down.some((d, i) => i > 0 && d >= down[i - 1]);
}

function degreesOf(notes) {
  return notes.map((n) => n.degree);
}

// The parent mela's notes that this raga leaves out. Arithmetic over the
// melakarta derivation, not stored anywhere - and shown nowhere in the app
// before now, though it is half of what defines a janya.
function varjaSwaras(raga, labelPrefs) {
  if (raga.is_melakarta || raga.mela == null) return null;
  const used = new Set([...degreesOf(raga.arohana), ...degreesOf(raga.avarohana)]);
  const dropped = melaScale(raga.mela).arohana.filter(
    (n) => n.degree !== 0 && n.degree !== 12 && !used.has(n.degree));
  if (!dropped.length) return null;
  return dropped.map((n) => noteLabel(n, labelPrefs)).join(" ");
}

function classificationBlock(raga, deps) {
  const facts = [];
  if (raga.jati) {
    const gloss = jatiGloss(raga.jati);
    facts.push(["Jati", gloss ? `${raga.jati} — ${gloss}` : raga.jati]);
  }
  const varja = varjaSwaras(raga, deps.labelPrefs);
  if (varja) facts.push(["Varja swaras", `${varja} — omitted from the parent scale`]);
  if (isVakra(raga)) {
    facts.push(["Vakra", "the scale turns back on itself rather than running straight up and down"]);
  }
  // Upanga/bhashanga is a statement about a janya. Saying "upanga" of a
  // melakarta would be a category error - a parent scale has no outside notes
  // to borrow or abstain from.
  if (!raga.is_melakarta && raga.mela != null) {
    facts.push(raga.anya_swaras?.length
      ? ["Bhashanga", "borrows notes from outside its parent scale"]
      : ["Upanga", "uses only notes of its parent scale"]);
  }
  if (!facts.length) return null;

  const wrap = section("Classification");
  const list = el("dl", "raga-facts");
  for (const [term, detail] of facts) {
    list.appendChild(el("dt", null, term));
    list.appendChild(el("dd", null, detail));
  }
  wrap.appendChild(list);
  return wrap;
}

// --- 5. Anya swaras -------------------------------------------------------

// Inline with the scale, never with the variants: spec 05 is explicit that
// these are foreign notes *within* one scale, not an alternative scale, and
// putting them beside the variants would teach the opposite.
function anyaSwaraLine(raga, deps) {
  if (!raga.anya_swaras?.length) return null;
  const line = el("p", "raga-anya");
  line.append("Anya swaras: ");
  for (const note of raga.anya_swaras) {
    line.appendChild(el("span", "swara-code", noteLabel(note, deps.labelPrefs)));
    line.append(" ");
  }
  const parent = deps.melakartaFor(raga.mela);
  line.append(parent
    ? `— borrowed from outside melakarta ${raga.mela}‑${parent.name}`
    : "— borrowed from outside the parent scale");
  return line;
}

// --- The variants block ---------------------------------------------------

// A clickable citation for one detail, resolved against the raga's own
// `sources` list - `variant.source` is a key like "wikipedia", and the URL it
// stands for is already recorded there. A detail that came from somewhere
// should say where, next to itself, rather than only in a section at the foot
// of the page; the same discipline the gathered notes will need in Phase 4.
function citation(sourceKey, raga) {
  const source = (raga.sources || []).find((s) => s.source === sourceKey);
  const span = el("span", "raga-cite");
  if (!source?.source_url) {
    span.textContent = sourceKey || "";
    return span;
  }
  const link = el("a", "raga-cite-link", "source");
  link.href = source.source_url;
  link.target = "_blank";
  link.rel = "noopener";
  link.title = `Where this comes from: ${source.source_url} (needs a connection)`;
  span.appendChild(link);
  return span;
}

function variantsBlock(raga, deps) {
  if (!raga.variants?.length) return null;
  const wrap = section("Also given as");

  // Where the scraper captured the source's own pairing (spec 05 F1a as
  // amended), each set is one whole alternative scale and is shown as one:
  // arohana and avarohana together, under a heading that numbers it. This is
  // the shape the source actually publishes, and grouping by direction instead
  // was what made a five-set raga read as "two more arohanas".
  if (raga.primary_set != null) {
    const sets = new Map();
    for (const variant of raga.variants) {
      if (!sets.has(variant.set)) sets.set(variant.set, {});
      sets.get(variant.set)[variant.direction] = variant;
    }
    let n = 1;
    for (const [, pair] of [...sets.entries()].sort((a, b) => a[0] - b[0])) {
      wrap.appendChild(el("h4", "raga-set-title", `Alternative ${n++}`));
      for (const direction of ["arohana", "avarohana"]) {
        const variant = pair[direction];
        if (!variant) continue;
        const row = el("div", "raga-scale-line raga-variant-line");
        row.appendChild(el("span", "raga-scale-label",
          direction === "arohana" ? "Arohana" : "Avarohana"));
        row.appendChild(scaleNotes(variant.notes, deps.labelPrefs));
        const play = el("button", "result-play-btn raga-play-btn");
        play.type = "button";
        play.title = `Play this alternative ${direction}`;
        deps.attachPlayer(play, () => deps.notesSequence(variant.notes));
        row.appendChild(play);
        row.appendChild(citation(variant.source, raga));
        wrap.appendChild(row);
      }
    }
    wrap.appendChild(el("p", "raga-note",
      `The source gives ${sets.size + 1} scales for this raga, written as two `
      + "parallel lists. The first is the one at the top of this page; these are "
      + "the rest, each one a complete arohana and avarohana as the source pairs "
      + "them."));
    const whyPaired = {
      article: "The scale at the top is the one the raga's own Wikipedia article gives.",
      "mela-fit": "The scale at the top is the one that stays inside the parent melakarta; that is the only reason it leads.",
      reviewed: "The scale at the top was chosen by a human reviewer.",
      unranked: "The source does not rank them, and nobody has: which of these is the primary scale is unestablished, not decided.",
    }[raga.primary_source];
    if (whyPaired) wrap.appendChild(el("p", "raga-note", whyPaired));
    return wrap;
  }

  // No pairing in the data: the two columns held different numbers of runs, so
  // these are alternatives for one direction at a time and reading across them
  // would invent scales the source does not give.
  for (const direction of ["arohana", "avarohana"]) {
    const alternatives = raga.variants.filter((v) => v.direction === direction);
    if (!alternatives.length) continue;
    for (const variant of alternatives) {
      const row = el("div", "raga-scale-line raga-variant-line");
      row.appendChild(el("span", "raga-scale-label",
        direction === "arohana" ? "Arohana" : "Avarohana"));
      row.appendChild(scaleNotes(variant.notes, deps.labelPrefs));
      const play = el("button", "result-play-btn raga-play-btn");
      play.type = "button";
      play.title = `Play this alternative ${direction}`;
      deps.attachPlayer(play, () => deps.notesSequence(variant.notes));
      row.appendChild(play);
      row.appendChild(citation(variant.source, raga));
      wrap.appendChild(row);
    }
  }

  // The count, said out loud. Without it the section reads as "here are two
  // more" and invites exactly the question it was asked. This branch is the
  // unpaired one: the two columns held different numbers of runs, so these are
  // alternatives for one direction at a time and there is no set to number.
  const extra = ["arohana", "avarohana"]
    .map((d) => raga.variants.filter((v) => v.direction === d).length);
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  // Singular or plural by how many distinct sources the alternatives actually
  // came from. It was always "the source" while every variant was one scraped
  // cell; a human review can now record alternatives drawn from *both*
  // Wikipedia surfaces (Asaveri), and calling two disagreeing pages "the
  // source" would flatten the very disagreement the review exists to show.
  const many = new Set(raga.variants.map((v) => v.source)).size > 1;
  wrap.appendChild(el("p", "raga-note",
    `${many ? "The sources give" : "The source gives"} `
    + `${plural(extra[0] + 1, "arohana")} and `
    + `${plural(extra[1] + 1, "avarohana")} for this raga, and different numbers `
    + "of each — so they do not pair into whole scales. The first of each is at "
    + "the top of this page; these are the rest, one direction at a time. "
    + `Reading across them would invent scales ${many ? "no source gives" : "the source does not give"}.`));

  // Which scale is the primary one, and on what grounds. `unranked` is the
  // honest case and the commonest (12 of the 17): the source lists these
  // without ordering them, and document order is a placeholder rather than a
  // judgement. Saying so is the difference between a gap and a lie.
  const why = {
    article: "The scale above is the one the raga's own Wikipedia article gives.",
    "mela-fit": "The scale above is the one that stays inside the parent melakarta; that is the only reason it leads.",
    reviewed: "The scale above was chosen by a human reviewer.",
    unranked: "The source does not rank them, and nobody has: which of these is the primary scale is unestablished, not decided.",
  }[raga.primary_source];
  if (why) wrap.appendChild(el("p", "raga-note", why));
  return wrap;
}

// --- 6. Same scale, different raga ----------------------------------------

// The page's most valuable section for the most ragas, and the one whose
// framing the human corrected the plan over: these are different ragas that
// share a set of pitches, not one raga under several names. So it is headed
// "same scale, different raga", never "also known as", and it says what
// distinguishes them - which today is tradition and parent mela, and later is
// everything the gathered-notes fields will carry.
function sameScaleBlock(raga, deps) {
  if (!raga.same_scale_as?.length) return null;
  const others = raga.same_scale_as.map(deps.ragaById).filter(Boolean);
  if (!others.length) return null;

  const wrap = section("Same scale, different raga");
  wrap.appendChild(el("p", "raga-note",
    "These ragas use the same swaras. They are not the same raga: what "
    + "separates them is gamaka, phrasing and the prayogas each one lives in — "
    + "which is why they are listed apart rather than merged."));

  const list = el("ul", "raga-links");
  for (const other of others) {
    const item = el("li");
    const link = el("a", "raga-link", other.name);
    link.href = ragaHref(other);
    item.appendChild(link);
    const context = [
      other.tradition === "hindustani" ? "Hindustani" : null,
      other.mela !== raga.mela ? `melakarta ${other.mela}` : null,
    ].filter(Boolean);
    if (context.length) item.appendChild(el("span", "raga-link-note", ` — ${context.join(", ")}`));
    list.appendChild(item);
  }
  wrap.appendChild(list);
  return wrap;
}

// --- 8. Hindustani equivalent ---------------------------------------------

function hindustaniBlock(raga, deps) {
  if (raga.tradition === "hindustani") return null;
  const stated = raga.hindustani_equivalent;
  // The same-scale list already knows about Hindustani entries sharing this
  // shape (Mohanam ↔ Bhoopali). That relationship was in the data long before
  // the harvest filled the field, so it is worth saying even where the field
  // is still empty - as a *shape* match, which is weaker than an equivalence
  // and has to be worded as such.
  const shared = (raga.same_scale_as || [])
    .map(deps.ragaById)
    .filter((r) => r && r.tradition === "hindustani");
  if (!stated && !shared.length) return null;

  const wrap = section("Hindustani equivalent");
  if (stated) {
    const p = el("p", "raga-fact-line");
    p.append("Given as ");
    const match = deps.ragaByName(stated, "hindustani");
    if (match) {
      const link = el("a", "raga-link", stated);
      link.href = ragaHref(match);
      p.appendChild(link);
    } else {
      p.appendChild(el("strong", null, stated));
    }
    p.append(", per its Wikipedia article.");
    wrap.appendChild(p);
  }
  if (shared.length) {
    const p = el("p", "raga-note");
    p.append(stated
      ? "The same swaras are also listed under "
      : "No equivalent is recorded, but the same swaras are listed under ");
    shared.forEach((other, i) => {
      if (i) p.append(i === shared.length - 1 ? " and " : ", ");
      const link = el("a", "raga-link", other.name);
      link.href = ragaHref(other);
      p.appendChild(link);
    });
    p.append(" — a shared scale, which is not by itself the same raga.");
    wrap.appendChild(p);
  }
  return wrap;
}

// --- 10-13. Gathered notes ------------------------------------------------

// Gamaka and prayogas, mood, time of day, deities. Everything here is a
// person's reading rather than a scraper's, so every line carries its credit
// in the open - a visible attribution, not a tooltip - and the block says what
// kind of thing it is before it says anything else.
const DETAIL_SECTIONS = [
  ["gamaka", "Characteristic gamaka"],
  ["prayogas", "Popular prayogas"],
  ["mood", "Mood and emotions"],
  ["time_of_day", "Time of day"],
  ["deities", "Associated deities"],
];

function citationText(citation) {
  if (!citation) return "source not recorded";
  const bits = [citation.author, citation.title].filter(Boolean);
  if (citation.page) bits.push(`p. ${citation.page}`);
  return bits.join(", ") || citation.url || "source not recorded";
}

function detailsBlock(raga, deps) {
  const notes = deps.detailsFor(raga.id);
  const present = DETAIL_SECTIONS.filter(([key]) => notes?.[key]?.length);
  if (!present.length) return null;

  const wrap = section("Gathered details");
  wrap.appendChild(el("p", "raga-note",
    "Gathered by hand from the sources credited below, not scraped. Where two "
    + "sources disagree, both are shown."));

  for (const [key, label] of present) {
    wrap.appendChild(el("h4", "raga-set-title", label));
    for (const entry of notes[key]) {
      const p = el("p", "raga-fact-line");
      // Scales inside the prose are rendered, never spelled - a note about
      // gamaka is prose about swaras almost by definition, and a spelled
      // scale would be in the author's numbering rather than the reader's.
      renderProseWithScales(p, entry.text, entry.scales, deps.labelPrefs);
      wrap.appendChild(p);

      const credit = el("p", "raga-note raga-credit");
      const citation = deps.citation(entry.cite);
      if (citation?.url) {
        const link = el("a", "raga-cite-link", citationText(citation));
        link.href = citation.url;
        link.target = "_blank";
        link.rel = "noopener";
        credit.append("— ");
        credit.appendChild(link);
      } else {
        credit.append(`— ${citationText(citation)}`);
      }
      if (citation?.type) credit.append(` (${citation.type})`);
      wrap.appendChild(credit);
    }
  }
  return wrap;
}

// A "Not yet sourced" block used to sit here, listing every field this raga had
// no data for, behind an authoring toggle on the Raga Reference page. Both were
// removed 2026-08-15.
//
// Every block on this page already returns null when it has nothing to say, so
// a page free of empty headings is the ordinary behaviour rather than a mode.
// The block did the reverse - it put the project's to-do list in front of a
// reader - and what is still missing is tracked in PROGRESS.md and in
// data/raga_details.json, which is where the work happens.

// --- 16. Provenance -------------------------------------------------------

// Three states that must read differently, per spec 06. The fourth - a raga
// with only one source, which is 862 of them - shows nothing at all: "only one
// source has been consulted" is not worth a section on nine hundred pages.
function provenanceBlock(raga, deps) {
  const sources = raga.sources || [];
  const second = sources.find((s) => s.source === "wikipedia-article");
  if (!second) return null;

  const wrap = section("Sources");
  const review = raga.source_review;
  const disagrees = sources.some((s) => s.agrees === false);

  if (review) {
    const verdict = {
      "stored-correct": "Two sources disagreed. Reviewed, and the scale shown above is the one this app follows.",
      "article-correct": "Two sources disagreed. Reviewed, and the scale shown above was corrected to the article's reading.",
      unresolved: "Two sources disagree and the question is still open. The scale above is one reading, not a settled answer.",
    }[review.verdict];
    if (verdict) wrap.appendChild(el("p", "raga-fact-line", verdict));
    const quote = el("p", "raga-note raga-review-note");
    quote.append("“");
    renderProseWithScales(quote, review.note, review.scales, deps.labelPrefs);
    quote.append(`” — reviewed ${review.date}`);
    wrap.appendChild(quote);
  } else if (disagrees) {
    wrap.appendChild(el("p", "raga-fact-line",
      "The two sources consulted give different swaras for this raga, and "
      + "nobody has settled which is right. The scale above is the list "
      + "page's reading; treat it as unconfirmed."));
  } else if (second.agrees === true) {
    wrap.appendChild(el("p", "raga-note",
      "Both sources consulted give this scale."));
  } else {
    wrap.appendChild(el("p", "raga-note",
      "A second source was consulted but could not be read"
      + (second.unusable_reason ? ` (${second.unusable_reason})` : "")
      + ", so this scale rests on one source."));
  }

  if (raga.article_url) {
    const p = el("p", "raga-note");
    const link = el("a", "raga-link", "Wikipedia article");
    link.href = raga.article_url;
    link.target = "_blank";
    link.rel = "noopener";
    p.appendChild(link);
    // This app works offline; a link that silently does nothing on a train is
    // worse than one that says why.
    p.append(" — needs a connection");
    wrap.appendChild(p);
  }
  return wrap;
}

// --- 4. Melakarta / janya -------------------------------------------------

// The parent mela as a link, for the ~900 janyas. The chip line at the top of
// the page now links it too, so this is the second route to the same place -
// kept because this one sits inside the Melakarta/janya section, where a reader
// following the classification finds it without going back up to the header.
function parentLink(raga, deps) {
  const parent = deps.melakartaFor(raga.mela);
  if (!parent || parent.id === raga.id) return null;
  const p = el("p", "raga-parent");
  p.append("Parent scale: ");
  const link = el("a", "raga-link", `${raga.mela} ${parent.name}`);
  link.href = ragaHref(parent);
  p.appendChild(link);
  return p;
}

function melaBlock(raga, deps) {
  if (raga.mela == null) return null;

  if (!raga.is_melakarta) {
    const link = parentLink(raga, deps);
    if (!link) return null;
    const wrap = section("Parent melakarta");
    wrap.appendChild(link);
    return wrap;
  }

  // For the 72, everything the reference chart's detail panel shows, so the
  // two surfaces cannot disagree about a raga's own numbers.
  const wrap = section("Its place among the 72");
  const chakra = chakraOf(raga.mela);
  const entry = deps.getChakras()?.find((c) => c.number === chakra);
  const ma = madhyamaOf(raga.mela);
  const chakraText = entry ? `chakra ${chakra} ${entry.name}` : `chakra ${chakra}`;
  wrap.appendChild(el("p", "raga-mela-meta",
    `${chakraText} · position ${positionOf(raga.mela)} · `
    + `${ma.label} ${ma.degree === 5 ? "shuddha" : "prati"} madhyama`));
  if (entry?.meaning) wrap.appendChild(el("p", "mela-chakra-gloss", entry.meaning));

  const decode = decodeFor(deps.getKatapayadi(), raga.mela);
  if (decode) wrap.insertAdjacentHTML("beforeend", decodeHtml(decode));

  return wrap;
}

// --- 4b. A melakarta's janyas ---------------------------------------------

// The other half of the parent/child relationship this section already shows.
// A janya's page links up to its parent; this is the same edge walked down, so
// the mela family is navigable in both directions.
//
// No new data: `mela` is on all 975 ragas, so this is the source's own *List of
// Janya ragas* structure - each melakarta followed by its janyas - rebuilt from
// what was already held and made clickable.
function janyaBlock(raga, deps) {
  if (!raga.is_melakarta || raga.mela == null) return null;
  const janyas = deps.janyasOf(raga.mela);
  if (!janyas.length) return null;

  // Collapsed, and not optionally so: the counts run past forty, and an open
  // list of forty links would push the rest of the page off the screen on
  // exactly the melakartas that have most to say. The count lives in the
  // summary, because the number is itself the fact most readers came for.
  const block = el("details", "raga-janyas");
  const summary = document.createElement("summary");
  summary.textContent = `${janyas.length} janya raga${janyas.length === 1 ? "" : "s"}`;
  block.appendChild(summary);

  const list = el("ul", "raga-links raga-janya-links");
  for (const janya of janyas) {
    const item = el("li");
    const link = el("a", "raga-link", janya.name);
    link.href = ragaHref(janya);
    item.appendChild(link);
    list.appendChild(item);
  }
  block.appendChild(list);

  // Last on the page, in its own section rather than tucked under "Its place
  // among the 72". Open, it is by far the longest thing here - 108 links on
  // the biggest melakartas - and anywhere but the end pushes everything after
  // it out of reach. The summary line is its own heading, so the section
  // carries no title of its own.
  const wrap = el("section", "raga-section raga-janya-section");
  wrap.appendChild(block);
  return wrap;
}

// --- The page -------------------------------------------------------------

// The section order is the human's field order from spec 06, and every builder
// returns null when its raga has nothing to say - which is the common case, not
// the exception. Roughly seven hundred ragas render the first three of these
// and stop.
export function renderRagaPage(root, raga, deps) {
  root.innerHTML = "";
  const page = el("article", "raga-page");
  page.appendChild(identityBlock(raga, deps));
  page.appendChild(scaleBlock(raga, deps));
  for (const build of [
    variantsBlock,
    classificationBlock,
    melaBlock,
    sameScaleBlock,
    hindustaniBlock,
    detailsBlock,
    provenanceBlock,
    janyaBlock,
  ]) {
    const block = build(raga, deps);
    if (block) page.appendChild(block);
  }
  root.appendChild(page);
}

// An id that names no raga. Reachable two ways that both deserve an answer
// rather than a blank view: a bookmark saved before session 18's id churn, and
// a hand-typed or truncated shared link.
export function renderRagaNotFound(root, id) {
  root.innerHTML = "";
  const page = el("article", "raga-page raga-missing");
  page.appendChild(el("h2", "raga-title", "No such raga"));
  page.appendChild(el("p", "raga-missing-body",
    `Nothing in the data has the id "${id}". If this was a saved link it may `
    + "predate a rename - searching by name is the surest way back."));
  const link = el("a", "raga-link", "Search ragas by name");
  link.href = "#search";
  page.appendChild(link);
  root.appendChild(page);
}

// Shown for the one case where a raga page is asked for before there is any
// data to draw it from: a shared link opened cold, where the router runs while
// ragas.json is still in flight. Saying "no such raga" there would be a lie
// about the commonest way this page will ever be opened by someone else.
export function renderRagaLoading(root) {
  root.innerHTML = "";
  const page = el("article", "raga-page");
  page.appendChild(el("p", "raga-loading", "Loading raga…"));
  root.appendChild(page);
}
