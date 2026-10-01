#!/usr/bin/env python3
"""Build a real .pptx deck from a JSON spec using only the Python standard library.

The deployment image ships `python3` but not `python-pptx`, so this script writes
the Office Open XML package directly. Every slide gets a title, an optional
bullet body, and an optional raster picture (PNG/JPEG/GIF). Speaker notes are not
written; see SKILL.md for the python-pptx path when notes or richer layouts are
needed.

Usage:
    python3 build_pptx.py deck.json out.pptx

deck.json:
    {
      "title": "Deck title",
      "subtitle": "Optional subtitle",
      "slides": [
        {"title": "Slide 1", "bullets": ["one", {"text": "two", "level": 1}], "image": "chart.png"}
      ]
    }

An empty title omits the cover slide.
"""

from __future__ import annotations

import json
import os
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

# Relationship type for the package core properties (docProps/core.xml).
CORE_PROPERTIES = "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties"

IMAGE_TYPES = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif"}

TITLE_SIZE = 3200
COVER_SIZE = 4400
SUBTITLE_SIZE = 1800
BULLET_SIZE = 1800
BULLET_SMALL = 1400


def inch(value: float) -> int:
    return int(round(value * EMU_PER_INCH))


def run(text: str, size: int, bold: bool) -> str:
    return f'<a:r><a:rPr lang="es-ES" sz="{size}" b="{1 if bold else 0}" dirty="0"/><a:t>{escape(text)}</a:t></a:r>'


def text_box(shape_id: int, name: str, x: int, y: int, cx: int, cy: int, paragraphs: str) -> str:
    return (
        "<p:sp><p:nvSpPr>"
        f'<p:cNvPr id="{shape_id}" name="{escape(name)}"/>'
        '<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr/></p:nvSpPr>'
        f'<p:spPr><a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm>'
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>'
        "<p:txBody>"
        f'<a:bodyPr wrap="square" rtlCol="0"><a:normAutofit/></a:bodyPr><a:lstStyle/>{paragraphs}'
        "</p:txBody></p:sp>"
    )


def paragraph(text: str, size: int, bold: bool, align: str = "l", indent_level: int = 0) -> str:
    if indent_level == 0:
        props = f'<a:pPr algn="{align}"/>'
    else:
        margin = 342900 * (indent_level + 1)
        props = (
            f'<a:pPr marL="{margin}" indent="-342900" lvl="{min(indent_level, 4)}" algn="{align}">'
            '<a:buChar char="\u2022"/></a:pPr>'
        )
    return f"<a:p>{props}{run(text, size, bold)}</a:p>"


def body_box(shape_id: int, items: list, x: int, y: int, cx: int, cy: int) -> str:
    paragraphs = []
    for item in items:
        if isinstance(item, str):
            paragraphs.append(paragraph(item, BULLET_SIZE, False, indent_level=1))
        elif isinstance(item, dict):
            level = int(item.get("level", 0)) + 1
            size = BULLET_SIZE if level <= 1 else BULLET_SMALL
            paragraphs.append(paragraph(str(item.get("text", "")), size, False, indent_level=level))
    return text_box(shape_id, "Body", x, y, cx, cy, "".join(paragraphs))


def picture(rel_id: str, shape_id: int, x: int, y: int, cx: int, cy: int) -> str:
    return (
        f'<p:pic><p:nvPicPr><p:cNvPr id="{shape_id}" name="Picture {shape_id}"/>'
        '<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>'
        f'<p:blipFill><a:blip r:embed="{rel_id}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>'
        f'<p:spPr><a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm>'
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


def theme_xml() -> str:
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
    fills = (
        '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
        '<a:solidFill><a:schemeClr val="phClr"><a:tint val="95000"/><a:satMod val="170000"/></a:schemeClr></a:solidFill>'
        '<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="93000"/>'
        '<a:satMod val="150000"/><a:shade val="98000"/></a:schemeClr></a:gs><a:gs pos="100000">'
        '<a:schemeClr val="phClr"><a:tint val="98000"/><a:satMod val="130000"/></a:schemeClr></a:gs></a:gsLst>'
        '<a:lin ang="5400000" scaled="0"/></a:gradFill>'
    )
    return (
        f'{XML_DECL}<a:theme xmlns:a="{A}" name="MWT"><a:themeElements>'
        '<a:clrScheme name="MWT">'
        '<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>'
        '<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>'
        '<a:dk2><a:srgbClr val="1A1A1A"/></a:dk2><a:lt2><a:srgbClr val="F2F2F2"/></a:lt2>'
        '<a:accent1><a:srgbClr val="C8102E"/></a:accent1><a:accent2><a:srgbClr val="1F3A5F"/></a:accent2>'
        '<a:accent3><a:srgbClr val="C9A227"/></a:accent3><a:accent4><a:srgbClr val="2E6B4F"/></a:accent4>'
        '<a:accent5><a:srgbClr val="6B4FA0"/></a:accent5><a:accent6><a:srgbClr val="B4552D"/></a:accent6>'
        '<a:hlink><a:srgbClr val="1F3A5F"/></a:hlink><a:folHlink><a:srgbClr val="6B4FA0"/></a:folHlink>'
        "</a:clrScheme>"
        '<a:fontScheme name="MWT"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>'
        '<a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>'
        f'<a:fmtScheme name="MWT"><a:fillStyleLst>{fills}</a:fillStyleLst>'
        f'<a:lnStyleLst>{lines}</a:lnStyleLst><a:effectStyleLst>{effects}</a:effectStyleLst>'
        f'<a:bgFillStyleLst>{fills}</a:bgFillStyleLst></a:fmtScheme>'
        "</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>"
    )


def slide_master_xml() -> str:
    return (
        f'{XML_DECL}<p:sldMaster xmlns:a="{A}" xmlns:r="{R}" xmlns:p="{P}">'
        '<p:cSld><p:bg><p:bgPr><a:solidFill><a:schemeClr val="bg1"/></a:solidFill>'
        f"<a:effectLst/></p:bgPr></p:bg>{shape_tree('')}</p:cSld>"
        '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" '
        'accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>'
        '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>'
        '<p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4400" b="1"/></a:lvl1pPr></p:titleStyle>'
        '<p:bodyStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:bodyStyle>'
        '<p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles>'
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
        "<PresentationFormat>Widescreen</PresentationFormat>"
        "<Company></Company></Properties>"
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


def cover_slide(title: str, subtitle: str) -> dict:
    bullets = [subtitle] if subtitle else []
    return {"title": title, "bullets": bullets, "cover": True}


def normalize_spec(spec: dict) -> tuple[list[dict], str, str]:
    title = str(spec.get("title", "")).strip()
    subtitle = str(spec.get("subtitle", "")).strip()
    raw_slides = spec.get("slides") or []
    if not isinstance(raw_slides, list):
        raise SystemExit("deck.json: 'slides' must be a list")
    slides: list[dict] = []
    if title:
        slides.append(cover_slide(title, subtitle))
    for index, raw in enumerate(raw_slides, start=1):
        if not isinstance(raw, dict):
            raise SystemExit(f"deck.json: slide {index} must be an object")
        slides.append(raw)
    if not slides:
        raise SystemExit("deck.json: a title or at least one slide is required")
    return slides, title, subtitle


def build(spec: dict, out_path: str) -> int:
    slides, _title, _subtitle = normalize_spec(spec)
    media: list[tuple[str, bytes]] = []
    media_extensions: list[str] = []
    parts: dict[str, str | bytes] = {}
    slide_entries: list[tuple[str, str, list[tuple[str, str, str]]]] = []

    for index, slide in enumerate(slides, start=1):
        children = ""
        shape_id = 2
        slide_title = str(slide.get("title", "")).strip()
        bullets = slide.get("bullets") or []
        image_path = slide.get("image")
        has_image = isinstance(image_path, str) and image_path != ""
        cover = bool(slide.get("cover"))

        if slide_title:
            children += text_box(
                shape_id, "Title", inch(0.7), inch(0.5 if not cover else 2.4), inch(11.93), inch(1.2),
                paragraph(slide_title, COVER_SIZE if cover else TITLE_SIZE, True),
            )
            shape_id += 1
        if cover and bullets:
            children += text_box(
                shape_id, "Subtitle", inch(0.7), inch(3.8), inch(11.93), inch(1.2),
                paragraph(str(bullets[0]), SUBTITLE_SIZE, False),
            )
            shape_id += 1
        elif bullets:
            width = inch(6.6) if has_image else inch(11.93)
            children += body_box(shape_id, list(bullets), inch(0.7), inch(1.9), width, inch(4.6))
            shape_id += 1

        # Every slide is related to its layout, as PowerPoint-authored files
        # are; a slide with no slideLayout relationship makes PowerPoint offer
        # to repair the presentation even though the schema allows it.
        slide_rel_items: list[tuple[str, str, str]] = [
            ("rId1", f"{R}/slideLayout", "../slideLayouts/slideLayout1.xml"),
        ]
        if has_image:
            ext = os.path.splitext(image_path)[1].lstrip(".").lower()
            if ext not in IMAGE_TYPES:
                raise SystemExit(f"deck.json: unsupported image extension .{ext} on slide {index}")
            with open(image_path, "rb") as handle:
                data = handle.read()
            media_name = f"image{len(media) + 1}.{ext}"
            media.append((media_name, data))
            media_extensions.append(ext)
            slide_rel_items.append(("rId2", f"{R}/image", f"../media/{media_name}"))
            children += picture("rId2", shape_id, inch(7.5), inch(1.9), inch(5.2), inch(4.4))

        slide_entries.append((f"ppt/slides/slide{index}.xml", slide_xml(children), slide_rel_items))

    parts["[Content_Types].xml"] = content_types(len(slide_entries), media_extensions)
    parts["_rels/.rels"] = rels([
        ("rId1", f"{R}/officeDocument", "ppt/presentation.xml"),
        ("rId2", CORE_PROPERTIES, "docProps/core.xml"),
        ("rId3", f"{R}/extended-properties", "docProps/app.xml"),
    ])
    parts["docProps/core.xml"] = core_properties_xml(_title)
    parts["docProps/app.xml"] = app_properties_xml(len(slide_entries))

    presentation_rel_items = [("rId1", f"{R}/slideMaster", "slideMasters/slideMaster1.xml")]
    slide_ids = []
    for index in range(1, len(slide_entries) + 1):
        presentation_rel_items.append((f"rId{index + 1}", f"{R}/slide", f"slides/slide{index}.xml"))
        slide_ids.append(f'<p:sldId id="{255 + index}" r:id="rId{index + 1}"/>')
    next_rel = len(slide_entries) + 2
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
    for name, xml, rel_items in slide_entries:
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
    return len(slide_entries)


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
