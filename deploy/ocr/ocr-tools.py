#!/usr/bin/env python3
"""Local OCR helpers for the FaberLoom attachment reader.

Two engines run on this machine and neither talks to a network:

- `deskew` straightens a photographed or scanned page. Tesseract reads a
  tilted page as line noise, and the measured repair is to rotate the picture
  before recognition instead of switching engines: on four real receipts rotated
  by 7 degrees either way, Tesseract recovered every checked amount and tax id.
- `rapid` runs RapidOCR (PP-OCRv4, ONNX, CPU). It reads a photographed
  hand-written invoice that Tesseract cannot: on the real phone photo measured
  for this change, Tesseract got two of five checked fields and RapidOCR five.

Both commands print one JSON document on stdout and send library noise to
stderr, so the caller never has to scrape logs. A missing model, a corrupt
image, or a timeout is reported per file instead of aborting the batch.
"""

import argparse
import contextlib
import json
import os
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


def _fail(command: str, path: str, reason: str) -> dict:
    return {"command": command, "file": path, "ok": False, "error": reason}


def deskew(src: str, dst: str) -> dict:
    """Estimate the page tilt and write a straightened copy.

    :param src: image to read.
    :param dst: where the straightened PNG is written.
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


def rapid(files: list[str]) -> dict:
    """Read every file with RapidOCR in one model load.

    :param files: images to read, in the order the caller wants them back.
    :returns: per-file text, confidence, and the reason a file has none.
    """
    started = time.time()
    try:
        with contextlib.redirect_stdout(sys.stderr):
            from rapidocr_onnxruntime import RapidOCR
            engine = RapidOCR()
    except Exception as error:  # noqa: BLE001 - a missing engine disables this path only
        return {
            "command": "rapid", "ok": False, "error": f"engine-unavailable: {error}",
            "files": [_fail("rapid", path, "engine-unavailable") for path in files],
        }

    results = []
    for path in files:
        try:
            with contextlib.redirect_stdout(sys.stderr):
                found, _ = engine(path)
        except Exception as error:  # noqa: BLE001 - one bad file must not stop the batch
            results.append(_fail("rapid", path, f"failed: {error}"))
            continue
        lines = []
        for box, text, score in found or []:
            top = sum(point[1] for point in box) / len(box)
            lines.append((top, text, float(score)))
        # Reading order is vertical position: the detector returns boxes in
        # confidence order, which would scramble a table.
        lines.sort(key=lambda item: item[0])
        text = "\n".join(item[1] for item in lines).strip()
        confidences = [item[2] for item in lines]
        results.append({
            "command": "rapid", "file": path, "ok": True, "text": text,
            "confidence": round(100 * sum(confidences) / len(confidences), 1) if confidences else 0.0,
            "lines": len(lines),
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
    json.dump(payload, sys.stdout)
    sys.stdout.write("\n")
    return 0 if payload.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
