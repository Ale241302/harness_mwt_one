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
  "subtitle": "Subtítulo opcional",
  "slides": [
    { "title": "Primera lámina", "bullets": ["Punto uno", "Punto dos"] },
    { "title": "Con subnivel", "bullets": ["Nivel uno", { "text": "Nivel dos", "level": 1 }] },
    { "title": "Con imagen", "bullets": ["Dato"], "image": "grafico.png" }
  ]
}
```

- A non-empty `title` adds a cover slide.
- `bullets` accepts strings or `{ "text": ..., "level": 0..4 }` objects.
- `image` is optional and must be a **PNG, JPEG, or GIF** file that already
  exists on disk (relative to where you run the command, or absolute). It is
  placed on the right half of its slide.
- The output is a 16:9 deck.

## Charts and diagrams

The generator embeds raster images only. When a slide needs a chart:

1. Prefer expressing the numbers as bullets or a single sentence when the point
   survives without a graphic.
2. If a raster image already exists in the workspace, reference it with `image`.
3. If you have an SVG/HTML chart, you need a rasterizer first. Check for one
   (`rsvg-convert`, `inkscape`, `convert` from ImageMagick, or `python3 -c
   "import cairosvg"`). Convert to PNG, then reference it. Do **not** promise a
   chart you cannot rasterize; fall back to bullets.

## Richer decks (optional)

If `python-pptx` is importable (`python3 -c "import pptx"`), you may use it
instead for tables, speaker notes, and theme access. Do not attempt to
`pip install` it: the runtime image has no package manager and may be offline.
When `python-pptx` is unavailable, stay with `build_pptx.py`; it always produces
a valid file.

## Limits of this generator

- No speaker notes and no tables (use `python-pptx` when available).
- Images must be raster (PNG/JPEG/GIF); SVG is not embedded.
- One flat master/layout: titles, bullets, images only. This is deliberate —
  it keeps the deck portable and the generator dependency-free.

## Known failure modes to avoid

- Writing slides no one asked for; keep the user's requested length.
- Long bullet walls: split into more slides instead of shrinking text.
- Naming the output `.ppt` — the generator writes OOXML, so the extension must
  be `.pptx`.
- Claiming the deck was delivered without calling `present`.
