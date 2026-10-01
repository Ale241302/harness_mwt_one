#!/usr/bin/env python3
"""Build a styled .pptx deck from a JSON spec using only the Python standard library.

The deployment image ships `python3` but not `python-pptx`, so this script writes
the Office Open XML package directly. The design follows the SONDEL V2 deck
language: a dark navy cover with an accent bar and side panel, and light content
slides with a running kicker, a title, a hairline, a footer, styled bullets,
KPI blocks, callouts, and framed raster images (PNG/JPEG/GIF).

Usage:
    python3 build_pptx.py deck.json out.pptx

Spec (all fields optional except a title or at least one slide):
    {
      "title": "Deck title",
      "subtitle": "Optional subtitle",
      "brand": "Footer brand line",
      "kicker": "CONFIDENCIAL · ELABORADO PARA ...",
      "lead": ["Cover bullet", ...],
      "footer": ["Line 1", "Line 2"],
      "slides": [
        {"section": "TU POSICIÓN", "kicker": "LÁMINA 03 · TU POSICIÓN",
         "title": "Slide title", "lead": "One-line intro",
         "bullets": ["one", {"text": "two", "level": 1}],
         "image": "chart.png",
         "kpis": [{"value": "15,4×", "label": "facturado/ganado", "note": "2020-2026"}],
         "callout": {"tone": "warn", "title": "Advertencia", "text": "..."}}
      ]
    }
"""

from __future__ import annotations

import json
import os
import struct
import sys
import zipfile
from datetime import datetime, timezone
from xml.sax.saxutils import escape

EMU_PER_INCH = 914400
SLIDE_W = 12192000
SLIDE_H = 6858000

A = "http://schemas.openxmlformats.org/drawingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
P = "http://schemas.openxmlformats.org/presentationml/2006/main"
CT = "http://schemas.openxmlformats.org/package/2006/content-types"
PR = "http://schemas.openxmlformats.org/package/2006/relationships"
XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
CORE_PROPERTIES = "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties"

IMAGE_TYPES = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif"}

# --- Design tokens (SONDEL V2 language) -------------------------------------
NAVY = "101A26"
BLUE = "0F5C8C"
PANEL = "1B2A3B"
HAIRLINE_DARK = "2A3B4F"
RULE_LIGHT = "D9DEE6"
WHITE = "FFFFFF"
SKY = "7FB4D9"
GREY_LIGHT = "C7D3DE"
GREY = "9FB0C0"
GREY_MUTED = "6B7686"
BODY = "3D4756"
RED = "8F2B26"
GREEN = "1C6B46"
AMBER = "8A6100"
AMBER_BG = "FDF3DD"

TONES = {"blue": BLUE, "red": RED, "green": GREEN, "amber": AMBER, "navy": NAVY}
TONE_BG = {"amber": AMBER_BG, "blue": "EAF3F9", "red": "FAECEB", "green": "EAF3EE", "navy": "EEF1F5"}

FONT = "Arial"

# --- Geometry ---------------------------------------------------------------
MARGIN = 0.62
CONTENT_TOP = 1.9
CONTENT_BOTTOM = 6.9


def inch(value: float) -> int:
    return int(round(value * EMU_PER_INCH))


def png_size(path: str) -> tuple[int, int] | None:
    """Pixel size of a PNG from its IHDR chunk, or None for other formats."""
    try:
        with open(path, "rb") as handle:
            head = handle.read(24)
        if head[:8] != b"\x89PNG\r\n\x1a\n":
            return None
        return struct.unpack(">II", head[16:24])
    except OSError:
        return None


def fit_box(px: int, py: int, box_w: float, box_h: float) -> tuple[float, float]:
    """Largest w×h inside the box that preserves the image aspect ratio."""
    ratio = px / py
    w, h = box_w, box_w / ratio
    if h > box_h:
        h, w = box_h, box_h * ratio
    return (w, h)


# --- XML atoms --------------------------------------------------------------
def run(text: str, size: int, color: str, bold: bool = False) -> str:
    return (
        f'<a:r><a:rPr lang="es-ES" sz="{size}" b="{1 if bold else 0}" dirty="0">'
        f'{solid_fill(color)}</a:rPr><a:t>{escape(text)}</a:t></a:r>'
    )


def solid_fill(color: str) -> str:
    return f'<a:solidFill><a:srgbClr val="{color}"/></a:solidFill>'


def paragraph(
    runs: list[tuple[str, int, str, bool]],
    *,
    align: str = "l",
    bullet: str | None = None,
    bullet_color: str = BLUE,
    level: int = 0,
    space_after: int = 600,
) -> str:
    props = f'<a:pPr algn="{align}">'
    if level > 0:
        props += f' marL="{342900 * (level + 1)}" indent="-260350"'
    props += f'<a:spcAft><a:spcPts val="{space_after}"/></a:spcAft>'
    if bullet is not None:
        props += f'<a:buClr><a:srgbClr val="{bullet_color}"/></a:buClr><a:buFont typeface="Arial"/><a:buChar char="{bullet}"/>'
    else:
        props += "<a:buNone/>"
    props += "</a:pPr>"
    return f"<a:p>{props}{''.join(run(*r) for r in runs)}</a:p>"


def text_box(
    shape_id: int,
    name: str,
    x: float,
    y: float,
    w: float,
    h: float,
    paragraphs: str,
    *,
    anchor: str = "t",
) -> str:
    return (
        "<p:sp><p:nvSpPr>"
        f'<p:cNvPr id="{shape_id}" name="{escape(name)}"/>'
        '<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr/></p:nvSpPr>'
        f'<p:spPr><a:xfrm><a:off x="{inch(x)}" y="{inch(y)}"/>'
        f'<a:ext cx="{inch(w)}" cy="{inch(h)}"/></a:xfrm>'
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>'
        f'<p:txBody><a:bodyPr wrap="square" rtlCol="0" anchor="{anchor}"><a:normAutofit/></a:bodyPr>'
        f"<a:lstStyle/>{paragraphs}</p:txBody></p:sp>"
    )


def rect(shape_id: int, name: str, x: float, y: float, w: float, h: float, fill: str) -> str:
    return (
        "<p:sp><p:nvSpPr>"
        f'<p:cNvPr id="{shape_id}" name="{escape(name)}"/>'
        '<p:cNvSpPr/><p:nvPr/></p:nvSpPr>'
        f'<p:spPr><a:xfrm><a:off x="{inch(x)}" y="{inch(y)}"/>'
        f'<a:ext cx="{inch(w)}" cy="{inch(h)}"/></a:xfrm>'
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'
        f"{solid_fill(fill)}</p:spPr></p:sp>"
    )


def picture(rel_id: str, shape_id: int, x: float, y: float, w: float, h: float) -> str:
    return (
        f'<p:pic><p:nvPicPr><p:cNvPr id="{shape_id}" name="Picture {shape_id}"/>'
        '<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>'
        f'<p:blipFill><a:blip r:embed="{rel_id}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>'
        f'<p:spPr><a:xfrm><a:off x="{inch(x)}" y="{inch(y)}"/>'
        f'<a:ext cx="{inch(w)}" cy="{inch(h)}"/></a:xfrm>'
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>'
    )


def shape_tree(children: str) -> str:
    return (
        '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
        '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/>'
        f'<a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>{children}</p:spTree>'
    )


def slide_xml(children: str) -> str:
    return (
        f'{XML_DECL}<p:sld xmlns:a="{A}" xmlns:r="{R}" xmlns:p="{P}">'
        f"<p:cSld>{shape_tree(children)}</p:cSld>"
        "<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>"
    )


# --- Slide composition ------------------------------------------------------
def bullet_paragraphs(bullets: list, size: int = 1200, small: int = 1000, color: str = BODY) -> str:
    out = []
    for item in bullets:
        if isinstance(item, str):
            text, level = item, 0
        elif isinstance(item, dict):
            text, level = str(item.get("text", "")), int(item.get("level", 0))
        else:
            continue
        level = max(0, min(level, 2))
        out.append(paragraph(
            [(text, size if level == 0 else small, color, False)],
            bullet="\u25aa" if level == 0 else "\u2013",
            bullet_color=BLUE,
            level=level,
            space_after=700 if level == 0 else 500,
        ))
    return "".join(out)


def kpi_row(kpis: list, x: float, y: float, w: float) -> tuple[str, float]:
    """Value/label blocks across one row; returns the XML and its height."""
    count = max(1, min(len(kpis), 4))
    gap = 0.22
    card_w = (w - gap * (count - 1)) / count
    h = 1.5
    children = ""
    shape_id = 50
    for i, kpi in enumerate(kpis[:4]):
        cx = x + i * (card_w + gap)
        tone = TONES.get(str(kpi.get("tone", "blue")), BLUE)
        children += rect(shape_id, f"KPI bg {i}", cx, y, card_w, h, TONE_BG.get(str(kpi.get("tone", "blue")), TONE_BG["blue"]))
        children += rect(shape_id + 1, f"KPI rule {i}", cx, y, card_w, 0.06, tone)
        paras = (
            paragraph([(str(kpi.get("value", "")), 3000, tone, True)], space_after=200)
            + paragraph([(str(kpi.get("label", "")), 1100, NAVY, True)], space_after=100)
            + paragraph([(str(kpi.get("note", "")), 900, GREY_MUTED, False)], space_after=0)
        )
        children += text_box(shape_id + 2, f"KPI text {i}", cx + 0.18, y + 0.22, card_w - 0.36, h - 0.32, paras)
        shape_id += 3
    return children, h


def callout_block(callout: dict, x: float, y: float, w: float, shape_id: int) -> str:
    tone_key = str(callout.get("tone", "amber"))
    tone = TONES.get(tone_key, AMBER)
    bg = TONE_BG.get(tone_key, AMBER_BG)
    h = 1.0
    paras = ""
    title = str(callout.get("title", "")).strip()
    if title != "":
        paras += paragraph([(title, 1000, tone, True)], space_after=200)
    paras += paragraph([(str(callout.get("text", "")), 1000, BODY, False)], space_after=0)
    return (
        rect(shape_id, "Callout bg", x, y, w, h, bg)
        + rect(shape_id + 1, "Callout rule", x, y, 0.06, h, tone)
        + text_box(shape_id + 2, "Callout text", x + 0.2, y + 0.12, w - 0.4, h - 0.24, paras, anchor="ctr")
    )


def cover_children(spec: dict) -> str:
    title = str(spec.get("title", "")).strip()
    subtitle = str(spec.get("subtitle", "")).strip()
    kicker = str(spec.get("kicker", "CONFIDENCIAL")).strip().upper()
    lead = spec.get("lead") or []
    footer = spec.get("footer") or []
    children = rect(2, "Cover bg", 0, 0, 13.333, 7.5, NAVY)
    children += rect(3, "Cover top bar", 0, 0, 13.333, 0.14, BLUE)
    children += rect(4, "Cover panel", 9.03, 0.14, 4.30, 7.36, PANEL)
    children += rect(5, "Cover panel edge", 9.03, 0.14, 0.02, 7.36, HAIRLINE_DARK)
    sid = 10
    if kicker:
        children += text_box(sid, "Cover kicker", 0.9, 0.78, 10.0, 0.3,
                             paragraph([(kicker, 950, SKY, True)], space_after=0))
        sid += 1
    if title:
        children += text_box(sid, "Cover title", 0.86, 1.24, 8.0, 2.2,
                             paragraph([(title, 3700, WHITE, True)], space_after=0))
        sid += 1
    children += rect(sid, "Cover rule", 0.9, 3.34, 2.3, 0.07, BLUE)
    sid += 1
    if subtitle:
        children += text_box(sid, "Cover subtitle", 0.9, 3.58, 8.0, 1.0,
                             paragraph([(subtitle, 1600, GREY_LIGHT, False)], space_after=0))
        sid += 1
    if lead:
        children += text_box(sid, "Cover lead", 0.9, 4.36, 7.9, 1.7,
                             bullet_paragraphs(lead, size=1100, small=1000, color=GREY))
        sid += 1
    if footer:
        children += rect(sid, "Cover footer rule", 0.9, 6.18, 11.5, 0.01, HAIRLINE_DARK)
        sid += 1
        children += text_box(sid, "Cover footer", 0.9, 6.3, 11.6, 0.9,
                             "".join(paragraph([(str(line), 900, GREY_MUTED, False)], space_after=0) for line in footer))
        sid += 1
    return children


def content_children(spec: dict, index: int, total: int, brand: str) -> str:
    kicker = str(spec.get("kicker", "")).strip().upper()
    if kicker == "":
        kicker = f"LÁMINA {index:02d}"
    title = str(spec.get("title", "")).strip()
    lead = str(spec.get("lead", "")).strip()
    bullets = spec.get("bullets") or []
    kpis = spec.get("kpis") or []
    callout = spec.get("callout") or None
    image_path = spec.get("image")
    has_image = isinstance(image_path, str) and image_path != ""

    children = rect(2, "Top rule", 0, 0, 13.333, 0.09, NAVY)
    sid = 10
    children += text_box(sid, "Kicker", MARGIN, 0.4, 12.09, 0.26,
                         paragraph([(kicker, 950, BLUE, True)], space_after=0))
    sid += 1
    children += text_box(sid, "Title", 0.6, 0.64, 12.19, 0.78,
                         paragraph([(title, 2400, NAVY, True)], space_after=0))
    sid += 1
    children += rect(sid, "Title rule", MARGIN, 1.44, 12.09, 0.012, RULE_LIGHT)
    sid += 1
    if lead:
        children += text_box(sid, "Lead", MARGIN, 1.52, 12.09, 0.3,
                             paragraph([(lead, 1000, GREY_MUTED, False)], space_after=0))
        sid += 1
    children += text_box(sid, "Footer brand", MARGIN, 7.03, 9.6, 0.3,
                         paragraph([(brand, 800, GREY_MUTED, False)], space_after=0))
    sid += 1
    children += text_box(sid, "Footer index", 9.71, 7.03, 3.0, 0.3,
                         paragraph([(f"LÁMINA {index:02d} / {total}", 800, GREY_MUTED, True)], align="r", space_after=0))
    sid += 1

    text_x = MARGIN
    text_w = 6.2 if has_image else 12.09
    cursor = CONTENT_TOP
    if kpis:
        kpi_xml, kpi_h = kpi_row(kpis, MARGIN, cursor, 12.09)
        children += kpi_xml
        sid += 12
        cursor += kpi_h + 0.3
    if bullets:
        body_h = max(0.5, (CONTENT_BOTTOM - cursor) - (1.25 if callout else 0.1))
        children += text_box(sid, "Body", text_x, cursor, text_w, body_h, bullet_paragraphs(bullets))
        sid += 1
    if has_image:
        ext = os.path.splitext(image_path)[1].lstrip(".").lower()
        if ext not in IMAGE_TYPES:
            raise SystemExit(f"deck.json: unsupported image extension .{ext} on slide {index}")
        box_w, box_h = 5.7, 4.9
        size = png_size(image_path)
        w, h = fit_box(*size, box_w, box_h) if size is not None else (box_w, box_h)
        img_x = 13.333 - MARGIN - w
        img_y = CONTENT_TOP + max(0.0, (box_h - h) / 2)
        children += picture("rId2", sid, img_x, img_y, w, h)
        sid += 1
    if callout:
        children += callout_block(callout, MARGIN, CONTENT_BOTTOM - 1.0, 12.09, sid)
        sid += 3
    return children


# --- Package plumbing -------------------------------------------------------
def theme_xml() -> str:
    fills = (
        f"<a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill>"
        f"<a:solidFill><a:schemeClr val=\"phClr\"><a:tint val=\"95000\"/><a:satMod val=\"170000\"/></a:schemeClr></a:solidFill>"
        "<a:gradFill rotWithShape=\"1\"><a:gsLst><a:gs pos=\"0\"><a:schemeClr val=\"phClr\"><a:tint val=\"93000\"/>"
        "<a:satMod val=\"150000\"/><a:shade val=\"98000\"/></a:schemeClr></a:gs><a:gs pos=\"100000\">"
        "<a:schemeClr val=\"phClr\"><a:tint val=\"98000\"/><a:satMod val=\"130000\"/></a:schemeClr></a:gs></a:gsLst>"
        "<a:lin ang=\"5400000\" scaled=\"0\"/></a:gradFill>"
    )
    lines = "".join(
        f'<a:ln w="{w}" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
        '<a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>'
        for w in (6350, 12700, 19050)
    )
    effects = "".join(
        f'<a:effectStyle><a:effectLst>{effect}</a:effectLst></a:effectStyle>'
        for effect in (
            "",
            '<a:outerShdw blurRad="40000" dist="20000" dir="5400000" rotWithShape="0">'
            '<a:srgbClr val="000000"><a:alpha val="38000"/></a:srgbClr></a:outerShdw>',
            '<a:outerShdw blurRad="40000" dist="23000" dir="5400000" rotWithShape="0">'
            '<a:srgbClr val="000000"><a:alpha val="35000"/></a:srgbClr></a:outerShdw>',
        )
    )
    return (
        f'{XML_DECL}<a:theme xmlns:a="{A}" name="MWT"><a:themeElements>'
        '<a:clrScheme name="MWT">'
        f'<a:dk1><a:srgbClr val="{NAVY}"/></a:dk1><a:lt1><a:srgbClr val="{WHITE}"/></a:lt1>'
        f'<a:dk2><a:srgbClr val="{PANEL}"/></a:dk2><a:lt2><a:srgbClr val="F2F4F7"/></a:lt2>'
        f'<a:accent1><a:srgbClr val="{BLUE}"/></a:accent1><a:accent2><a:srgbClr val="{RED}"/></a:accent2>'
        f'<a:accent3><a:srgbClr val="{AMBER}"/></a:accent3><a:accent4><a:srgbClr val="{GREEN}"/></a:accent4>'
        f'<a:accent5><a:srgbClr val="{SKY}"/></a:accent5><a:accent6><a:srgbClr val="{GREY_MUTED}"/></a:accent6>'
        f'<a:hlink><a:srgbClr val="{BLUE}"/></a:hlink><a:folHlink><a:srgbClr val="{GREY_MUTED}"/></a:folHlink>'
        "</a:clrScheme>"
        f'<a:fontScheme name="MWT"><a:majorFont><a:latin typeface="{FONT}"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>'
        f'<a:minorFont><a:latin typeface="{FONT}"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>'
        f'<a:fmtScheme name="MWT"><a:fillStyleLst>{fills}</a:fillStyleLst>'
        f'<a:lnStyleLst>{lines}</a:lnStyleLst><a:effectStyleLst>{effects}</a:effectStyleLst>'
        f'<a:bgFillStyleLst>{fills}</a:bgFillStyleLst></a:fmtScheme>'
        "</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>"
    )


def slide_master_xml() -> str:
    return (
        f'{XML_DECL}<p:sldMaster xmlns:a="{A}" xmlns:r="{R}" xmlns:p="{P}">'
        f'<p:cSld><p:bg><p:bgPr>{solid_fill(WHITE)}<a:effectLst/></p:bgPr></p:bg>{shape_tree("")}</p:cSld>'
        f'<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" '
        'accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>'
        '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>'
        f'<p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="2400" b="1">{solid_fill(NAVY)}</a:defRPr></a:lvl1pPr></p:titleStyle>'
        f'<p:bodyStyle><a:lvl1pPr><a:defRPr sz="1200">{solid_fill(BODY)}</a:defRPr></a:lvl1pPr></p:bodyStyle>'
        f'<p:otherStyle><a:lvl1pPr><a:defRPr sz="1200">{solid_fill(BODY)}</a:defRPr></a:lvl1pPr></p:otherStyle></p:txStyles>'
        "</p:sldMaster>"
    )


def slide_layout_xml() -> str:
    return (
        f'{XML_DECL}<p:sldLayout xmlns:a="{A}" xmlns:r="{R}" xmlns:p="{P}" type="blank" preserve="1">'
        f'<p:cSld name="Blank">{shape_tree("")}</p:cSld>'
        "<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>"
    )


def rels(items: list[tuple[str, str, str]]) -> str:
    body = "".join(
        f'<Relationship Id="{rid}" Type="{kind}" Target="{target}"/>' for rid, kind, target in items
    )
    return f'{XML_DECL}<Relationships xmlns="{PR}">{body}</Relationships>'


def core_properties_xml(title: str) -> str:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return (
        f'{XML_DECL}<cp:coreProperties '
        'xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
        'xmlns:dc="http://purl.org/dc/elements/1.1/" '
        'xmlns:dcterms="http://purl.org/dc/terms/" '
        'xmlns:dcmitype="http://purl.org/dc/dcmitype/" '
        'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
        f"<dc:title>{escape(title)}</dc:title>"
        "<dc:creator>dsh pptx-deck</dc:creator>"
        "<cp:lastModifiedBy>dsh pptx-deck</cp:lastModifiedBy><cp:revision>1</cp:revision>"
        f'<dcterms:created xsi:type="dcterms:W3CDTF">{now}</dcterms:created>'
        f'<dcterms:modified xsi:type="dcterms:W3CDTF">{now}</dcterms:modified>'
        "</cp:coreProperties>"
    )


def app_properties_xml(slide_count: int) -> str:
    return (
        f'{XML_DECL}<Properties '
        'xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" '
        'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">'
        "<Application>dsh pptx-deck</Application>"
        f"<Slides>{slide_count}</Slides><Paragraphs>0</Paragraphs><Words>0</Words>"
        "<PresentationFormat>Widescreen</PresentationFormat></Properties>"
    )


def content_types(slide_count: int, media_extensions: list[str]) -> str:
    defaults = "".join(
        f'<Default Extension="{ext}" ContentType="{IMAGE_TYPES[ext]}"/>' for ext in sorted(set(media_extensions))
    )
    overrides = [
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
        '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
        '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>',
        '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>',
        '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>',
        '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>',
        '<Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/>',
    ]
    overrides += [
        f'<Override PartName="/ppt/slides/slide{index}.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>'
        for index in range(1, slide_count + 1)
    ]
    return (
        f'{XML_DECL}<Types xmlns="{CT}">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        f"{defaults}{''.join(overrides)}</Types>"
    )


def normalize_spec(spec: dict) -> tuple[list[dict], str, str]:
    title = str(spec.get("title", "")).strip()
    subtitle = str(spec.get("subtitle", "")).strip()
    raw = spec.get("slides") or []
    if not isinstance(raw, list):
        raise SystemExit("deck.json: 'slides' must be a list")
    slides: list[dict] = []
    if title:
        slides.append({
            "cover": True,
            "title": title,
            "subtitle": subtitle,
            "kicker": spec.get("kicker"),
            "lead": spec.get("lead"),
            "footer": spec.get("footer"),
        })
    for index, item in enumerate(raw, start=1):
        if not isinstance(item, dict):
            raise SystemExit(f"deck.json: slide {index} must be an object")
        slides.append(item)
    if not slides:
        raise SystemExit("deck.json: a title or at least one slide is required")
    return slides, title, subtitle


def build(spec: dict, out_path: str) -> int:
    slides, title, _subtitle = normalize_spec(spec)
    brand = str(spec.get("brand", "")).strip() or title or "dsh pptx-deck"
    content_total = sum(1 for s in slides if not s.get("cover"))

    media: list[tuple[str, bytes]] = []
    media_extensions: list[str] = []
    parts: dict[str, str | bytes] = {}
    entries: list[tuple[str, str, list[tuple[str, str, str]]]] = []
    content_index = 0

    for index, slide in enumerate(slides, start=1):
        rel_items: list[tuple[str, str, str]] = [
            ("rId1", f"{R}/slideLayout", "../slideLayouts/slideLayout1.xml"),
        ]
        if slide.get("cover"):
            children = cover_children(slide)
        else:
            content_index += 1
            image_path = slide.get("image")
            if isinstance(image_path, str) and image_path != "":
                ext = os.path.splitext(image_path)[1].lstrip(".").lower()
                if ext not in IMAGE_TYPES:
                    raise SystemExit(f"deck.json: unsupported image extension .{ext} on slide {index}")
                with open(image_path, "rb") as handle:
                    data = handle.read()
                media_name = f"image{len(media) + 1}.{ext}"
                media.append((media_name, data))
                media_extensions.append(ext)
                rel_items.append(("rId2", f"{R}/image", f"../media/{media_name}"))
            children = content_children(slide, content_index, content_total, brand)
        entries.append((f"ppt/slides/slide{index}.xml", slide_xml(children), rel_items))

    parts["[Content_Types].xml"] = content_types(len(entries), media_extensions)
    parts["_rels/.rels"] = rels([
        ("rId1", f"{R}/officeDocument", "ppt/presentation.xml"),
        ("rId2", CORE_PROPERTIES, "docProps/core.xml"),
        ("rId3", f"{R}/extended-properties", "docProps/app.xml"),
    ])
    parts["docProps/core.xml"] = core_properties_xml(title)
    parts["docProps/app.xml"] = app_properties_xml(len(entries))

    presentation_rel_items = [("rId1", f"{R}/slideMaster", "slideMasters/slideMaster1.xml")]
    slide_ids = []
    for index in range(1, len(entries) + 1):
        presentation_rel_items.append((f"rId{index + 1}", f"{R}/slide", f"slides/slide{index}.xml"))
        slide_ids.append(f'<p:sldId id="{255 + index}" r:id="rId{index + 1}"/>')
    next_rel = len(entries) + 2
    presentation_rel_items.append((f"rId{next_rel}", f"{R}/theme", "theme/theme1.xml"))
    presentation_rel_items.append((f"rId{next_rel + 1}", f"{R}/presProps", "presProps.xml"))
    parts["ppt/_rels/presentation.xml.rels"] = rels(presentation_rel_items)
    parts["ppt/presentation.xml"] = (
        f'{XML_DECL}<p:presentation xmlns:a="{A}" xmlns:r="{R}" xmlns:p="{P}" saveSubsetFonts="1">'
        '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>'
        f'<p:sldIdLst>{"".join(slide_ids)}</p:sldIdLst>'
        f'<p:sldSz cx="{SLIDE_W}" cy="{SLIDE_H}"/><p:notesSz cx="6858000" cy="9144000"/>'
        "</p:presentation>"
    )
    parts["ppt/presProps.xml"] = f'{XML_DECL}<p:presentationPr xmlns:a="{A}" xmlns:r="{R}" xmlns:p="{P}"/>'
    parts["ppt/theme/theme1.xml"] = theme_xml()
    parts["ppt/slideMasters/slideMaster1.xml"] = slide_master_xml()
    parts["ppt/slideMasters/_rels/slideMaster1.xml.rels"] = rels([
        ("rId1", f"{R}/slideLayout", "../slideLayouts/slideLayout1.xml"),
        ("rId2", f"{R}/theme", "../theme/theme1.xml"),
    ])
    parts["ppt/slideLayouts/slideLayout1.xml"] = slide_layout_xml()
    parts["ppt/slideLayouts/_rels/slideLayout1.xml.rels"] = rels([
        ("rId1", f"{R}/slideMaster", "../slideMasters/slideMaster1.xml"),
    ])
    for name, xml, rel_items in entries:
        parts[name] = xml
        parts[f"ppt/slides/_rels/{os.path.basename(name)}.rels"] = rels(rel_items)
    for media_name, data in media:
        parts[f"ppt/media/{media_name}"] = data

    directory = os.path.dirname(os.path.abspath(out_path))
    if directory:
        os.makedirs(directory, exist_ok=True)
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, payload in parts.items():
            archive.writestr(name, payload)
    return len(entries)


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    with open(argv[1], "r", encoding="utf-8-sig") as handle:
        spec = json.load(handle)
    count = build(spec, argv[2])
    print(f"Wrote {argv[2]} ({count} slides)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
