# Bundled fonts

Both files are **subsets**, generated once from the Google Fonts CSS2 API's
`text=` parameter and committed here so the app fetches nothing at runtime.
That was the point of bundling: `index.html` used to pull Forum from
`fonts.googleapis.com` on every load, which is a third-party request from a
private family app and a hole in an offline-first PWA - the one thing the
service worker could not cache.

Both faces are licensed under the SIL Open Font License 1.1 (`OFL.txt`), which
permits redistribution provided the licence travels with the font.

## gentium-book-plus-swara.woff2 - 5.9 KB

Gentium Book Plus, (c) SIL International. Reserved Font Name "Gentium".

Used for **swara labels only** - see `--font-swara` in `css/style.css`. Chosen
because it draws by far the most visible sthayi marks: measured (see
`demos/font-research.html`) it puts 0.176 of the letter's own ink
into the dot above and 0.099 into the dot below, against 0.064 / 0.046 for the
`system-ui` face it replaced. The marks have to stay real combining characters -
U+0307 and U+0323 - so that labels remain copyable and searchable, which left
the type face as the only lever.

Subset to exactly the characters a swara label can contain. That set is closed
and was computed from `notation.js` rather than guessed: every `labelForDegree`
output across every label preference, with every sthayi applied, uses only

    / 1 2 3 D G M N P R S  U+0307  U+0323

Digits 0 and 4-9 are included as insurance. **If a swara label ever needs a
character outside that set, add it here and regenerate** - otherwise the browser
silently falls back for that one glyph and the label renders in two faces.

## forum-headings.woff2 - 19.1 KB

Forum, (c) Denis Masharov.

The display serif the page and panel headings already used; this only changes
where it comes from. Subset to basic Latin, digits and common punctuation
rather than to the current heading strings, since headings are prose and will
change - **plus the IAST transliteration letters**, which is not optional
insurance here: the app's own name is set in this face and is spelled
`SwaRāga`, so U+0101 is load-bearing. The rest of the IAST set (ī ū ṛ ṅ ñ ṭ ḍ
ṇ ś ṣ ṃ ḥ and their capitals) is included so a future heading naming a raga or
a tala properly doesn't hit the fallback trap described above.

## Regenerating

    # swara subset - the 13 characters above, plus spare digits
    https://fonts.googleapis.com/css2?family=Gentium+Book+Plus&text=<url-encoded>

    # headings subset
    https://fonts.googleapis.com/css2?family=Forum&text=<url-encoded>

Request with a current browser User-Agent or the API returns TTF instead of
woff2, then download the `url(...)` out of the CSS it replies with. Anything
added here must also go in `sw.js`'s precache list, and the cache version must
be bumped, or installed copies keep the old file.
