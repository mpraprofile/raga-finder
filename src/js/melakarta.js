// The 72 melakartas, derived rather than stored - see
// specs/04-melakarta-chakra-wheel.md.
//
// Nothing in this file is data: every one of the 72 scales falls out of the
// mela number by arithmetic, which is exactly why the chakra chart is a
// *chart* and not a table. `data/ragas.json` still holds the authoritative
// copy (names, and the arohana/avarohana the scraper read from the source),
// and checkAgainstStored() below exists to prove the two agree.
//
// Pure: no DOM, no fetch, no imports. Notes come out in the canonical
// {degree, label} form CLAUDE.md fixes, with the mainstream labels - the same
// tokens the scraper writes - so noteLabel() can apply the user's numbering
// preference to these identically to how it does to a stored raga.

export const MELA_COUNT = 72;

// The only six (Rishabha, Gandhara) combinations that occur, ascending - and
// the same six shapes again for (Dhaivata, Nishada). CLAUDE.md explains why
// there are six and not nine: R2=G1, R3=G2 are literally the same pitch, so
// no raga ever needs both names at once.
export const RG_COMBOS = [
  { degrees: [1, 2], labels: ["R1", "G1"] },
  { degrees: [1, 3], labels: ["R1", "G2"] },
  { degrees: [1, 4], labels: ["R1", "G3"] },
  { degrees: [2, 3], labels: ["R2", "G2"] },
  { degrees: [2, 4], labels: ["R2", "G3"] },
  { degrees: [3, 4], labels: ["R3", "G3"] },
];

export const DN_COMBOS = [
  { degrees: [8, 9], labels: ["D1", "N1"] },
  { degrees: [8, 10], labels: ["D1", "N2"] },
  { degrees: [8, 11], labels: ["D1", "N3"] },
  { degrees: [9, 10], labels: ["D2", "N2"] },
  { degrees: [9, 11], labels: ["D2", "N3"] },
  { degrees: [10, 11], labels: ["D3", "N3"] },
];

export const CHAKRA_COUNT = 12;
export const CHAKRA_SIZE = 6;

// Chakra = which sixth of the 72 the mela falls in, 1-12. It fixes the
// Rishabha-Gandhara pair, and (via which half of the 72 it is in) the
// Madhyama.
export function chakraOf(mela) {
  return Math.floor((mela - 1) / CHAKRA_SIZE) + 1;
}

// Position within the chakra, 1-6. It fixes the Dhaivata-Nishada pair.
export function positionOf(mela) {
  return ((mela - 1) % CHAKRA_SIZE) + 1;
}

export function melaOf(chakra, position) {
  return (chakra - 1) * CHAKRA_SIZE + position;
}

export function rgComboOf(mela) {
  return RG_COMBOS[(chakraOf(mela) - 1) % 6];
}

export function dnComboOf(mela) {
  return DN_COMBOS[positionOf(mela) - 1];
}

// The first 36 melakartas take shuddha madhyama, the last 36 prati madhyama -
// the single split the whole chart is arranged around.
export function madhyamaOf(mela) {
  return mela <= 36 ? { degree: 5, label: "M1" } : { degree: 6, label: "M2" };
}

// Every melakarta is sampurna - all seven swaras, both directions, in order -
// so the avarohana is always exactly the arohana reversed and no other shape
// can arise here.
export function melaScale(mela) {
  const rg = rgComboOf(mela);
  const dn = dnComboOf(mela);
  const ma = madhyamaOf(mela);
  const arohana = [
    { degree: 0, label: "S" },
    { degree: rg.degrees[0], label: rg.labels[0] },
    { degree: rg.degrees[1], label: rg.labels[1] },
    { degree: ma.degree, label: ma.label },
    { degree: 7, label: "P" },
    { degree: dn.degrees[0], label: dn.labels[0] },
    { degree: dn.degrees[1], label: dn.labels[1] },
    { degree: 12, label: "S" },
  ];
  return { arohana, avarohana: [...arohana].reverse() };
}

// A raga-shaped object for the 999-in-a-million case where a melakarta is
// missing from ragas.json - same fields renderRow() and loadRagaIntoKeyboard()
// read, so the chart's detail panel works either way. The stored raga is
// preferred wherever there is one; this is the fallback, not the default.
export function derivedRaga(mela, name) {
  const { arohana, avarohana } = melaScale(mela);
  return { name: name || `Melakarta ${mela}`, mela, is_melakarta: true, arohana, avarohana };
}

// The spec's check 2, run in the browser instead of only in the scraper: for
// every mela present in ragas.json, does the arithmetic above reproduce the
// stored arohana degree for degree? Returns the mismatches, so the caller can
// decide how loud to be. Degrees only - `label` is the raga-context name the
// source gave and is not recomputable from a degree, per CLAUDE.md.
export function checkAgainstStored(melaRagas) {
  const failures = [];
  for (let mela = 1; mela <= MELA_COUNT; mela++) {
    const stored = melaRagas.get(mela);
    if (!stored) {
      failures.push({ mela, reason: "missing from ragas.json" });
      continue;
    }
    const derived = melaScale(mela).arohana.map((n) => n.degree).join(" ");
    const actual = stored.arohana.map((n) => n.degree).join(" ");
    if (derived !== actual) failures.push({ mela, name: stored.name, reason: `derived ${derived}, stored ${actual}` });
  }
  return failures;
}
