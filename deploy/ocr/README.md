# OCR helpers

`ocr-tools.py` is the local help for `packages/faberloom/inbound`: it straightens a
tilted page and runs a second recognition engine for pages Tesseract cannot read.
Nothing here calls a network and no key is needed; a deployment without the
Python packages in `/opt/ocr/py` keeps reading every page with Tesseract.

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

Straightening repairs tilt without giving up Tesseract's word spacing and speed;
the second engine repairs what straightening cannot, at about three times the
cost per page.

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

`rapid` reads every named file in one model load and returns, per file, the text
in reading order, its mean confidence, and the number of lines. Reading order is
vertical position, not the detector's confidence order, so a table does not come
back scrambled.

## What the caller decides

`packages/faberloom/inbound/src/ocr.ts` owns the policy: it straightens every
page, reads it with Tesseract, and only when the median word confidence is under
75 does it ask for the second engine, once per document. The helper reports facts
and lets the reader decide, so a threshold change does not need a Python edit.

## Limits

- A missing dependency, an unreadable file, or a failed write is reported per
  file; one bad page never aborts a batch.
- The angle search covers ±12 degrees. A page rotated further is a rotated scan,
  which Tesseract's own orientation model handles, not a photographed document.
- Neither engine returns layout. A photographed table arrives as lines, and the
  second engine drops inter-word spaces more often than Tesseract.
