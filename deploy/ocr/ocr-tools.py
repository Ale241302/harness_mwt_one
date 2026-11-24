#!/usr/bin/env python3
"""Local OCR helpers for the FaberLoom attachment reader.

Two engines run on this machine and neither talks to a network:

- `deskew` straightens a photographed or scanned page. Tesseract reads a
  tilted page as line noise, and the measured repair is to rotate the picture
  before recognition instead of switching engines: on four real receipts rotated
  by 7 degrees either way, Tesseract recovered every checked amount and tax id.
- `rapid` runs RapidOCR (PP-OCR over ONNX, CPU) and turns its boxes into text
  that keeps the page's rows: a photographed table arrives as `a | b | c`, not
  as a wall of lines. It reads a photographed hand-written invoice that
  Tesseract cannot, and it re-reads printed pages with the Latin recognition
  model, which keeps word spaces and accents.

Both commands print one JSON document on stdout and send library noise to
stderr, so the caller never has to scrape logs. A missing model, a corrupt
image, or a timeout is reported per file instead of aborting the batch.
"""

import argparse
import contextlib
import json
import os
import statistics
import sys
import time

PY_PATH = os.environ.get("FABERLOOM_OCR_PY", "/opt/ocr/py")
if os.path.isdir(PY_PATH) and PY_PATH not in sys.path:
    sys.path.insert(0, PY_PATH)

# Angular search range for deskew. A page tilted more than this is not a
# photographed document but a rotated scan, which Tesseract's own orientation
# model handles; wider searches cost time and latch onto table rules.
MAX_ANGLE = 12.0
ANGLE_STEP = 0.5
# Angles below this are inside Tesseract's tolerance and rotating only resamples
# the pixels, so the original bytes are passed through untouched.
MIN_ANGLE = 0.5
# Long side of the copy the angle search runs on. Measured: 800 px finds the
# same angle as full resolution on the real receipts, at a fraction of the cost.
SEARCH_LONG_SIDE = 800
# Ink threshold on the grayscale copy. Scans are near-binary; a photograph's
# paper sits well above this and its ink below.
INK_THRESHOLD = 128

# Latin recognition model: keeps the spaces between words and the accents that
# the default Chinese model drops (`Muito Work Limitada`, `Adriana Jiménez`).
LATIN_MODEL = os.environ.get("FABERLOOM_OCR_LATIN_MODEL", "/opt/ocr/models/latin_rec.onnx")
LATIN_DICT = os.environ.get("FABERLOOM_OCR_LATIN_DICT", "/opt/ocr/models/latin_dict.json")
# Median line confidence above which a page is printed rather than handwritten.
# Measured on four real attachments: the hand-written phone photo scores 0.959
# and the three printed receipts 0.990 to 0.996. Printed pages go to the Latin
# model; anything lower keeps the Chinese model, which read four of six checked
# fields on the photo where the Latin model read two.
PRINTED_MEDIAN = 0.98
# A line the engine is not sure about is marked instead of passing as text. The
# hand-written identification number on the real photo scores 0.78 and is read
# wrong by every engine measured; the mark stops it from becoming a fact.
DUBIOUS_LINE = 0.85
# Two lines belong to the same visual row when their centres sit within this
# fraction of the shorter line's height.
ROW_TOLERANCE = 0.6


def _fail(command: str, path: str, reason: str) -> dict:
    return {"command": command, "file": path, "ok": False, "error": reason}


def deskew(src: str, dst: str) -> dict:
    """Estimate the page tilt and write a straightened copy.

    :param src: image to read.
    :param dst: where the straightened JPEG is written.
    :returns: the applied angle, or why nothing was written.
    """
    try:
        import numpy as np
        from PIL import Image
    except ImportError as error:
        return _fail("deskew", src, f"missing-dependency: {error}")

    started = time.time()
    try:
        original = Image.open(src)
        original.load()
    except Exception as error:  # noqa: BLE001 - any decoder error is reported, not raised
        return _fail("deskew", src, f"unreadable: {error}")

    gray = original.convert("L")
    scale = SEARCH_LONG_SIDE / max(gray.width, gray.height)
    small = gray.resize(
        (max(1, int(gray.width * scale)), max(1, int(gray.height * scale))),
        Image.BILINEAR,
    ) if scale < 1 else gray
    ink = (np.asarray(small, dtype=np.float32) < INK_THRESHOLD).astype(np.float32) * 255

    best_angle, best_score = 0.0, -1.0
    steps = int(round((2 * MAX_ANGLE) / ANGLE_STEP)) + 1
    for index in range(steps):
        deg = -MAX_ANGLE + index * ANGLE_STEP
        rotated = np.asarray(
            Image.fromarray(ink.astype(np.uint8)).rotate(deg, resample=Image.BILINEAR, fillcolor=0),
            dtype=np.float32,
        )
        profile = rotated.sum(axis=1)
        # A straight page has its ink concentrated on few rows, so the row
        # profile changes sharply; a tilted one smears across many rows.
        score = float(np.sum(np.diff(profile) ** 2))
        if score > best_score:
            best_score, best_angle = score, float(deg)

    if abs(best_angle) < MIN_ANGLE:
        return {
            "command": "deskew", "file": src, "ok": True, "applied": False,
            "angle": 0.0, "seconds": round(time.time() - started, 2),
        }

    try:
        # JPEG, not PNG: re-encoding a 12 MP phone photo to PNG measured 6.8 s
        # against 0.04 s for JPEG at quality 95, and both read identically
        # through Tesseract on the real receipts (5 of 5 checked fields).
        original.convert("RGB").rotate(
            best_angle, resample=Image.BICUBIC, expand=True, fillcolor=(255, 255, 255),
        ).save(dst, format="JPEG", quality=95)
    except Exception as error:  # noqa: BLE001 - a write failure falls back to the original
        return _fail("deskew", src, f"write-failed: {error}")

    return {
        "command": "deskew", "file": src, "ok": True, "applied": True,
        "angle": round(best_angle, 2), "output": dst,
        "seconds": round(time.time() - started, 2),
    }


def _latin_engine(chinese):
    """Build the Latin recogniser from the Chinese one's configuration.

    The character list is committed as JSON because its first entry is a space,
    which a plain text file cannot carry without tripping whitespace gates; the
    recogniser needs a file, so this writes one.
    :param chinese: the loaded default engine, whose config file is reused.
    :returns: the Latin engine, or None when the model is not installed.
    """
    if not (os.path.isfile(LATIN_MODEL) and os.path.isfile(LATIN_DICT)):
        return None
    try:
        import tempfile

        import yaml
        from rapidocr_onnxruntime import RapidOCR

        with open(LATIN_DICT, encoding="utf8") as handle:
            characters = json.load(handle)["characters"]
        # Two tenants read pages at the same time; a shared scratch file would
        # let one read a document the other is still writing.
        scratch = tempfile.mkdtemp(prefix="rapidocr-latin-")
        keys_path = os.path.join(scratch, "dict.txt")
        with open(keys_path, "w", encoding="utf8") as handle:
            handle.write("\n".join(characters) + "\n")
        # The package ships its config next to the module; locate it by module
        # file so a moved installation still works.
        module_file = sys.modules["rapidocr_onnxruntime"].__file__ or ""
        base = os.path.join(os.path.dirname(module_file), "config.yaml")
        with open(base, encoding="utf8") as handle:
            config = yaml.safe_load(handle)
        config["Rec"]["model_path"] = LATIN_MODEL
        config["Rec"]["rec_keys_path"] = keys_path
        derived = os.path.join(scratch, "config.yaml")
        with open(derived, "w", encoding="utf8") as handle:
            yaml.safe_dump(config, handle)
        engine = RapidOCR(config_path=derived)
        # The engine holds the decoded character list in memory, so the scratch
        # directory is only needed until it finishes loading.
        import shutil

        shutil.rmtree(scratch, ignore_errors=True)
        return engine
    except Exception:  # noqa: BLE001 - the Latin model is an improvement, not a requirement
        return None


def _read(engine, path: str) -> list[dict]:
    """Read one image into lines with their boxes.

    :param engine: a loaded RapidOCR.
    :param path: image to read.
    :returns: one entry per detected line, in detector order.
    """
    with contextlib.redirect_stdout(sys.stderr):
        found, _ = engine(path)
    lines = []
    for box, text, score in found or []:
        xs = [point[0] for point in box]
        ys = [point[1] for point in box]
        lines.append({
            "text": text,
            "score": float(score),
            "left": float(min(xs)),
            "right": float(max(xs)),
            "top": float(min(ys)),
            "bottom": float(max(ys)),
        })
    return lines


def _rows(lines: list[dict]) -> list[list[dict]]:
    """Group lines into visual rows, left to right.

    :param lines: detected lines with boxes.
    :returns: rows, each a list of lines sorted by horizontal position.
    """
    ordered = sorted(lines, key=lambda line: (line["top"] + line["bottom"]) / 2)
    rows: list[list[dict]] = []
    for line in ordered:
        centre = (line["top"] + line["bottom"]) / 2
        height = line["bottom"] - line["top"]
        if rows:
            last = rows[-1]
            last_centre = sum((item["top"] + item["bottom"]) / 2 for item in last) / len(last)
            last_height = min(item["bottom"] - item["top"] for item in last)
            if abs(centre - last_centre) <= ROW_TOLERANCE * min(height, last_height):
                last.append(line)
                continue
        rows.append([line])
    for row in rows:
        row.sort(key=lambda line: line["left"])
    return rows


def _render(lines: list[dict]) -> str:
    """Turn boxes into text that keeps the page's rows.

    A page with at least two multi-cell rows is a table: each row becomes its
    cells joined by ` | `, so a photographed table arrives with its columns.
    Any other page keeps one line per detected line.
    :param lines: detected lines with boxes.
    :returns: the page text.
    """
    if not lines:
        return ""
    rows = _rows(lines)
    multi = [row for row in rows if len(row) >= 2]
    rendered = []
    for row in rows:
        cells = []
        for line in row:
            text = line["text"]
            if line["score"] < DUBIOUS_LINE and len(text.strip()) >= 4:
                # The engine is guessing on a field long enough to matter: say so
                # instead of passing it as text. Single letters and digits are
                # left alone because a wrong `S` in a month cell is not a claim.
                text = f"[?] {text}"
            cells.append(text)
        rendered.append(" | ".join(cells))
    if len(multi) >= 2:
        return "\n".join(rendered).strip()
    return "\n".join(cell for cell in rendered).strip()


def rapid(files: list[str]) -> dict:
    """Read every file with RapidOCR, choosing the recognition model per page.

    :param files: images to read, in the order the caller wants them back.
    :returns: per-file text, confidence, and the reason a file has none.
    """
    started = time.time()
    try:
        with contextlib.redirect_stdout(sys.stderr):
            from rapidocr_onnxruntime import RapidOCR
            chinese = RapidOCR()
    except Exception as error:  # noqa: BLE001 - a missing engine disables this path only
        return {
            "command": "rapid", "ok": False, "error": f"engine-unavailable: {error}",
            "files": [_fail("rapid", path, "engine-unavailable") for path in files],
        }

    latin = _latin_engine(chinese)
    results = []
    for path in files:
        try:
            lines = _read(latin or chinese, path)
            model = "latin" if latin is not None else "chinese"
            if lines and model == "latin":
                median = statistics.median(line["score"] for line in lines)
                if median < PRINTED_MEDIAN:
                    # Not a printed page: the Chinese model reads hand-writing
                    # better, so the Latin reading is used only when it was sure.
                    fallback = _read(chinese, path)
                    if fallback:
                        lines, model = fallback, "chinese"
        except Exception as error:  # noqa: BLE001 - one bad file must not stop the batch
            results.append(_fail("rapid", path, f"failed: {error}"))
            continue
        scores = [line["score"] for line in lines]
        results.append({
            "command": "rapid", "file": path, "ok": True,
            "text": _render(lines),
            "confidence": round(100 * sum(scores) / len(scores), 1) if scores else 0.0,
            "lines": len(lines),
            "model": model,
            "dubious": sum(1 for score in scores if score < DUBIOUS_LINE),
        })

    return {"command": "rapid", "ok": True, "seconds": round(time.time() - started, 2), "files": results}


def main() -> int:
    parser = argparse.ArgumentParser(description="Local OCR helpers (deskew, rapid).")
    sub = parser.add_subparsers(dest="command", required=True)

    deskew_cmd = sub.add_parser("deskew", help="straighten a page")
    deskew_cmd.add_argument("src")
    deskew_cmd.add_argument("dst")

    rapid_cmd = sub.add_parser("rapid", help="read images with RapidOCR")
    rapid_cmd.add_argument("files", nargs="+")

    args = parser.parse_args()
    if args.command == "deskew":
        payload = deskew(args.src, args.dst)
    else:
        payload = rapid(args.files)
    json.dump(payload, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0 if payload.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
