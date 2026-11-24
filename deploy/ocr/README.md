# OCR helpers

`ocr-tools.py` is the local help for `packages/faberloom/inbound`: it straightens a
tilted page, reads it with a second and a third recognition model, and turns the
detected boxes back into rows so a photographed table keeps its columns. Nothing
here calls a network and no key is needed; a deployment without the Python
packages in `/opt/ocr/py` keeps reading every page with Tesseract.

## Why it exists

Tesseract reads a straight, printed page well and a photographed or hand-written
one badly. Measured on four attachments from the owner's mailbox — one 12 MP
phone photo of a hand-written invoice and three thermal receipts, each also
rotated 7 degrees either way, twelve variants in all, five checked fields each:

| Case | Tesseract | Tesseract after `deskew` | RapidOCR |
| --- | --- | --- | --- |
| Hand-written phone photo | 3/5 | 3/5 | 5/5 |
| Receipts, straight | 5/5, 5/5, 4/5 | unchanged | 5/5 |
| Receipts, rotated ±7° | 0-4/5 | 5/5 on all six | 5/5 |

## The two recognition models

RapidOCR ships a recognition model trained on Chinese, which also covers Latin
letters but drops the spaces between words and most accents: on a real printed
receipt it read `MuitoWorkLimitada` and `EnsaladaCaprese`. The Latin model
(`models/latin_rec.onnx`, from the RapidOCR model zoo) keeps both, keeps accents
(`Muito Work Limitada`, `Adriana Jiménez Leiva`, `resolución`), and reads a
printed receipt in 8 s instead of 14.

It is worse at hand-writing: on the phone photo it recovered two of six checked
fields where the Chinese model recovered four. So the model is chosen per page by
a measured signal: median line confidence above 0.98 means printed (the photo
scores 0.959, the three receipts 0.990 to 0.996), which sends the page to the
Latin model; anything lower keeps the Chinese model. A printed page therefore
pays one pass and a hand-written one pays two.

## Rows, columns, and doubt

The engine returns one box per text line. `rapid` groups lines whose centres sit
within 60 % of the shorter line's height into one visual row, sorts each row left
to right, and joins the cells with ` | `. A page with at least two multi-cell rows
is a table and is rendered that way; every other page keeps one line per line. On
the real receipt this turns `Sirloin 450 gr … 11.382` into `Sirloin 450 gr | 11.382`
and `3 Artículos … TOTAL … 29.249` into one row of three cells.

A line the engine scores under 0.85, and that carries at least four characters,
is prefixed `[?]`. That is not decoration: the hand-written identification number
on the real photo scores 0.78 and every engine measured reads it wrong (the
closest read five of six digits), so the mark is what stops a guess from being
taken as a value. A person or a later step can see which fields need checking.

## Commands

Both print one JSON document on stdout, send library noise to stderr, and exit
non-zero only when the whole call failed.

```sh
python3 ocr-tools.py deskew page.jpg straight.jpg
python3 ocr-tools.py rapid page1.png page2.png
```

`deskew` searches the rotation between -12 and 12 degrees that concentrates the
ink on the fewest rows, on an 800 px copy, and writes the straightened page as
JPEG at quality 95. JPEG rather than PNG because re-encoding a 12 MP photo to PNG
measured 6.8 s against 0.04 s, with identical readings. An angle under 0.5 degrees
is reported as `applied: false` and no file is written: rotating inside Tesseract's
tolerance only resamples the pixels.

`rapid` reads every named file in one model load and returns, per file, the text,
its mean confidence, the number of lines, which model read it, and how many lines
it marked as doubtful.

## What the caller decides

`packages/faberloom/inbound/src/ocr.ts` owns the rest of the policy: it straightens
every page, reads it with Tesseract, and only when the median word confidence is
under 75 does it ask for this engine, once per document. The helper reports facts
— including doubt — and lets the reader decide, so a threshold change does not
need a Python edit.

## Limits

- A missing dependency, an unreadable file, a missing Latin model, or a failed
  write is reported per file; one bad page never aborts a batch. Without the
  Latin model every page is read by the Chinese one.
- The angle search covers ±12 degrees. A page rotated further is a rotated scan,
  which Tesseract's own orientation model handles, not a photographed document.
- Row grouping assumes a horizontal page. A photographed page rotated 90 degrees
  has its rows read as columns; the deskew step does not rotate that far.
- Neither engine returns a full layout: a row is cells joined by ` | `, not a
  Markdown table with a header, and a cell whose text wraps onto two lines still
  arrives as two rows.
