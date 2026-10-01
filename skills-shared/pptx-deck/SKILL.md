---
name: pptx-deck
description: "Generate a real PowerPoint .pptx deck (title, bullet slides, optional images) as a local file the user can download. Use when the user asks for a presentation, deck, slides, PowerPoint, PPTX, 'genera una presentación', 'hazme un PowerPoint', or wants existing content turned into slides instead of an HTML page."
---

# PowerPoint Deck (.pptx)

Produce a real, openable `.pptx` file in the workspace. The deployment image
ships `python3` but not `python-pptx`, so the bundled generator writes the Office
Open XML package directly with the Python standard library — no install, no
network, no rasterizer required.

## When to use

- The user asks for a presentation, deck, slides, or PowerPoint/PPTX.
- The user wants the deck as a file to open in PowerPoint, Google Slides, or
  Keynote, or to attach to an email.
- Existing notes, a report, or an analysis should become slides.

Prefer `frontend-slides` instead when the user explicitly wants an animated
HTML deck, a web page, or a PDF export. Use this skill whenever "PowerPoint",
"PPTX", or "descargar la presentación" is the ask.

## Workflow

1. **Fix the content first.** You need a title and an ordered list of slides.
   Each slide has a title and 3–6 short bullets. Do not invent facts; take them
   from the conversation, the workspace files, or the user. Keep the deck's
   language identical to the user's.
2. **Write a spec file** `deck.json` in the workspace (see schema below).
   One item per slide; keep bullets short so they fit a slide.
3. **Run the generator.** The shared skill root is `/opt/skills-shared`:

   ```sh
   python3 /opt/skills-shared/pptx-deck/scripts/build_pptx.py deck.json presentation.pptx
   ```

   If that path is absent (a non-container host), locate the script once:

   ```sh
   find / -name build_pptx.py -path '*pptx-deck*' 2>/dev/null | head -n1
   ```

   Write `presentation.pptx` (or a name the user chose) into the workspace so it
   becomes a produced file.
4. **Verify** the file exists and is non-trivial

   (`ls -l presentation.pptx`; it should be a few kilobytes, not zero).
5. **Deliver it** so the user can download it: call `present` with
   `{"files": [{"path": "presentation.pptx", "description": "Presentación en PowerPoint"}]}`.
   The file card then offers **Download** even on a headless Host.

## deck.json schema

```json
{
  "title": "Título de la portada",
  "subtitle": "Subtítulo de la portada",
  "kicker": "CONFIDENCIAL · ELABORADO PARA …",
  "brand": "marca del pie de página",
  "lead": ["Viñeta de portada"],
  "footer": ["Línea 1 del pie de portada", "Línea 2"],
  "slides": [
    { "kicker": "LÁMINA 03 · TU POSICIÓN", "title": "Lámina", "lead": "Entradilla de una línea",
      "bullets": ["Punto", { "text": "Subpunto", "level": 1 }], "image": "grafico.png",
      "kpis": [{ "value": "15,4×", "label": "facturado / ganado", "note": "2020-2026", "tone": "blue" }],
      "callout": { "tone": "warn", "title": "Advertencia:", "text": "2026 está parcial." } }
  ]
}
```

- A non-empty `title` adds the cover slide; `kicker`, `lead`, and `footer` style it.
- `bullets` accepts strings or `{ "text": …, "level": 0..2 }` objects.
- `image` is optional and must be a **PNG, JPEG, or GIF** that already exists on
  disk (relative to where you run the command, or absolute). It is fitted,
  aspect-preserved, into the right column.
- `kpis` (up to 4) draws a row of value cards; `callout` draws one tinted note.
  `tone` is `blue`, `red`, `green`, `amber`, or `navy` (default `blue`).
- `section` is a shorter alternative to `kicker`; when neither is given the
  kicker is `LÁMINA NN`. The footer-right index is added automatically.
- The output is a 16:9 deck.

## Design

The generator ships one intentional visual system (the SONDEL V2 language), so
decks look designed without a template:

- **Cover**: full-bleed navy, a blue top bar, a side panel, a small uppercase
  kicker, a large white title, a short blue rule, the subtitle, optional lead
  bullets, and a hairline footer.
- **Content slides**: a thin navy top rule, the uppercase blue kicker, a 24pt
  navy title, a hairline, an optional grey lead, styled bullets (blue square
  markers), and a footer with the brand on the left and `LÁMINA NN / NN` on the
  right.
- **KPI cards** and **callouts** reuse the same palette and accent rules.
- The palette is navy `#101A26`, blue `#0F5C8C`, body grey `#3D4756`, with
  `red`/`green`/`amber` tones for status. Text uses Arial.

Keep one idea per slide and 4–6 bullets; the design is dense, not decorative.

## Charts and diagrams

The generator embeds raster images only. When a slide needs a chart:

1. Prefer expressing the numbers as bullets or a single sentence when the point
   survives without a graphic.
2. If a raster image already exists in the workspace, reference it with `image`.
3. If you have an SVG/HTML chart, you need a rasterizer first. Check for one
   (`rsvg-convert`, `inkscape`, `convert` from ImageMagick, or `python3 -c
   "import cairosvg"`). Convert to PNG, then reference it. Do **not** promise a
   chart you cannot rasterize; fall back to bullets or KPI cards.

## Richer decks (optional)

If `python-pptx` is importable (`python3 -c "import pptx"`), you may use it
instead for tables and speaker notes. Do not attempt to `pip install` it: the
runtime image has no package manager and may be offline. When `python-pptx` is
unavailable, stay with `build_pptx.py`; it always produces a valid file.

## Limits of this generator

- No speaker notes and no tables (use `python-pptx` when available).
- Images must be raster (PNG/JPEG/GIF); SVG is not embedded.
- One visual system, no template files: the design is code, not a `.potx`.
- Every slide must carry a `slideLayout` relationship and the package carries
  `docProps`; both are required or PowerPoint offers to repair the file.

## Known failure modes to avoid

- Writing slides no one asked for; keep the user's requested length.
- Long bullet walls: split into more slides instead of shrinking text.
- Naming the output `.ppt` — the generator writes OOXML, so the extension must
  be `.pptx`.
- Claiming the deck was delivered without calling `present`.
