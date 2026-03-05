#!/usr/bin/env python3
"""
Extract template cell boundaries from a PDF so our overlay boxes match the template layout.
Uses (1) PyMuPDF find_tables() when available for table/form layout, (2) drawn lines/rects
to build a grid, (3) text blocks for labels. Output: one box per logical cell, aligned to
the template.
Outputs JSON: { "pageWidth", "pageHeight", "cells": [ { "x", "y", "width", "height", "label" } ] }
Coordinates in PDF points, origin top-left (y down). Usage: python detect_template_cells.py <path_to_pdf>
"""
import sys
import json

try:
    import fitz  # PyMuPDF
except ImportError:
    sys.stderr.write("ERROR: PyMuPDF required. Run: pip install pymupdf\n")
    sys.exit(2)


def merge_edges(values, tol):
    """Merge nearby values into sorted unique edges."""
    if not values:
        return []
    s = sorted(set(values))
    out = [s[0]]
    for v in s[1:]:
        if v - out[-1] > tol:
            out.append(v)
    return out


def rect_to_cell(r, label=""):
    """Convert a rect-like to our cell dict (x, y, width, height, label)."""
    try:
        x0, y0, x1, y1 = r.x0, r.y0, r.x1, r.y1
    except (AttributeError, TypeError):
        x0, y0, x1, y1 = r[0], r[1], r[2], r[3]
    w = x1 - x0
    h = y1 - y0
    if w < 2 or h < 2:
        return None
    return {
        "x": round(x0, 2),
        "y": round(y0, 2),
        "width": round(w, 2),
        "height": round(h, 2),
        "label": (label or "").strip()[:80],
    }


def get_text_in_rect(page, r):
    """Get text that actually appears inside the given rect (clip to cell bbox)."""
    try:
        if hasattr(r, "x0"):
            clip = r
        else:
            clip = (r[0], r[1], r[2], r[3])
        raw = page.get_text("text", clip=clip, flags=fitz.TEXT_PRESERVE_WHITESPACE)
        if not raw:
            return ""
        return " ".join(raw.split()).strip()
    except Exception:
        return ""


def get_font_size_in_rect(page, r):
    """Get the dominant font size (max span size) of text inside the rect."""
    try:
        if hasattr(r, "x0"):
            clip = r
        else:
            clip = (r[0], r[1], r[2], r[3])
        td = page.get_text("dict", clip=clip, flags=fitz.TEXT_PRESERVE_WHITESPACE)
        sizes = []
        for blk in td.get("blocks", []):
            for line in blk.get("lines", []):
                for span in line.get("spans", []):
                    s = span.get("size")
                    if s is not None and s > 0:
                        sizes.append(float(s))
        return round(max(sizes)) if sizes else None
    except Exception:
        return None


def extract_cells_from_tables(page, page_width, page_height):
    """
    Use PyMuPDF find_tables() to get table cells with exact bboxes.
    For each cell we get the label from the text *inside* that cell's rect (clip),
    so labels match what's actually in the box instead of extract() order.
    """
    try:
        finder = page.find_tables()
    except Exception:
        return None
    if finder is None:
        return None
    tables = getattr(finder, "tables", None)
    if tables is None:
        return None
    if not isinstance(tables, (list, tuple)):
        tables = list(tables) if tables else []
    cells_out = []
    seen = set()

    for table in tables:
        try:
            cell_rects = getattr(table, "cells", None)
            if not cell_rects:
                continue
            for i, r in enumerate(cell_rects):
                if r is None:
                    continue
                try:
                    text = get_text_in_rect(page, r)
                    if text is None:
                        text = ""
                    text = str(text).strip()
                    if text.lower() == "none":
                        text = ""
                    cell = rect_to_cell(r, text)
                    if cell:
                        key = (round(cell["x"], 1), round(cell["y"], 1), round(cell["width"], 1), round(cell["height"], 1))
                        if key not in seen:
                            seen.add(key)
                            fs = get_font_size_in_rect(page, r)
                            if fs is not None:
                                cell["fontSize"] = fs
                            cells_out.append(cell)
                except Exception:
                    continue
        except Exception:
            continue

    if cells_out:
        cells_out.sort(key=lambda c: (c["y"], c["x"]))
        return cells_out
    return None


def main():
    if len(sys.argv) < 2:
        sys.stderr.write("Usage: python detect_template_cells.py <pdf_path>\n")
        sys.exit(1)
    path = sys.argv[1]
    try:
        doc = fitz.open(path)
    except Exception as e:
        sys.stderr.write(f"ERROR: Cannot open PDF: {e}\n")
        sys.exit(1)
    if len(doc) == 0:
        sys.stderr.write("ERROR: PDF has no pages\n")
        sys.exit(1)
    page = doc[0]
    page_rect = page.rect
    page_width = page_rect.width
    page_height = page_rect.height

    # 1) Try table-based extraction first (best for forms/tables like Bill of Lading)
    table_cells = extract_cells_from_tables(page, page_width, page_height)
    if table_cells and len(table_cells) >= 3:
        doc.close()
        out = {
            "pageWidth": round(page_width, 2),
            "pageHeight": round(page_height, 2),
            "cells": table_cells,
        }
        print(json.dumps(out, indent=0))
        return

    # 2) Fallback: build grid from drawings (lines/rects) + text, then assign text to cells
    lefts, rights, tops, bottoms = [], [], [], []

    def add_rect(r):
        try:
            x0, y0, x1, y1 = r.x0, r.y0, r.x1, r.y1
        except (AttributeError, TypeError):
            x0, y0, x1, y1 = r[0], r[1], r[2], r[3]
        lefts.append(x0)
        rights.append(x1)
        tops.append(y0)
        bottoms.append(y1)

    def add_point(p):
        try:
            x, y = p.x, p.y
        except (AttributeError, TypeError):
            x, y = p[0], p[1]
        lefts.append(x)
        rights.append(x)
        tops.append(y)
        bottoms.append(y)

    try:
        drawings = page.get_drawings()
    except Exception:
        drawings = []
    for d in drawings:
        r = d.get("rect")
        if r is not None:
            add_rect(r)
        for it in d.get("items") or []:
            if not isinstance(it, (list, tuple)) or len(it) < 2:
                continue
            kind = it[0]
            if kind == "l" and len(it) >= 3:
                add_point(it[1])
                add_point(it[2])
            elif kind == "re" and len(it) >= 2:
                add_rect(it[1])
            elif kind == "qu" and len(it) >= 2:
                q = it[1]
                try:
                    pts = [q.ul, q.ur, q.ll, q.lr] if hasattr(q, "ul") else list(q)[:4]
                    for pt in pts:
                        add_point(pt)
                except Exception:
                    pass
            elif kind == "c" and len(it) >= 5:
                for i in range(1, 5):
                    add_point(it[i])

    text_dict = {"blocks": []}
    try:
        text_dict = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)
        for blk in text_dict.get("blocks", []):
            b = blk.get("bbox", (0, 0, 0, 0))
            lefts.append(b[0])
            rights.append(b[2])
            tops.append(b[1])
            bottoms.append(b[3])
            for line in blk.get("lines", []):
                lb = line.get("bbox", b)
                lefts.append(lb[0])
                rights.append(lb[2])
                tops.append(lb[1])
                bottoms.append(lb[3])
    except Exception:
        pass

    merge_col = 10
    merge_row = 8
    col_edges = merge_edges([0, page_width] + lefts + rights, merge_col)
    row_edges = merge_edges([0, page_height] + tops + bottoms, merge_row)
    if col_edges[0] > 0:
        col_edges.insert(0, 0)
    if col_edges[-1] < page_width:
        col_edges.append(page_width)
    if row_edges[0] > 0:
        row_edges.insert(0, 0)
    if row_edges[-1] < page_height:
        row_edges.append(page_height)

    blocks = text_dict.get("blocks", [])
    text_blocks = []
    for blk in blocks:
        bbox = blk.get("bbox", (0, 0, 0, 0))
        for line in blk.get("lines", []):
            for span in line.get("spans", []):
                text = span.get("text", "").strip()
                if not text:
                    continue
                lb = line.get("bbox", bbox)
                size_pt = span.get("size")
                text_blocks.append({"bbox": lb, "text": text, "size": float(size_pt) if size_pt is not None and size_pt > 0 else None})

    cell_labels = {}
    for tb in text_blocks:
        b = tb["bbox"]
        cx = (b[0] + b[2]) / 2
        cy = (b[1] + b[3]) / 2
        ci = None
        for i in range(len(col_edges) - 1):
            if col_edges[i] <= cx < col_edges[i + 1]:
                ci = i
                break
        if ci is None:
            continue
        ri = None
        for i in range(len(row_edges) - 1):
            if row_edges[i] <= cy < row_edges[i + 1]:
                ri = i
                break
        if ri is None:
            continue
        key = (ri, ci)
        if key not in cell_labels:
            cell_labels[key] = []
        cell_labels[key].append({"text": tb["text"], "size": tb.get("size")})

    cells = []
    for (ri, ci), entries in sorted(cell_labels.items()):
        x = col_edges[ci]
        y = row_edges[ri]
        w = col_edges[ci + 1] - x
        h = row_edges[ri + 1] - y
        if w < 3 or h < 3:
            continue
        rect = (x, y, x + w, y + h)
        label_clip = get_text_in_rect(page, rect).strip()
        if label_clip.lower() == "none":
            label_clip = ""
        labels = [e["text"] for e in entries]
        label = (label_clip or " ".join(labels).strip())[:80]
        cell = {"x": round(x, 2), "y": round(y, 2), "width": round(w, 2), "height": round(h, 2), "label": label}
        sizes = [e["size"] for e in entries if e.get("size") is not None and e["size"] > 0]
        if sizes:
            cell["fontSize"] = round(max(sizes))
        cells.append(cell)

    doc.close()

    out = {
        "pageWidth": round(page_width, 2),
        "pageHeight": round(page_height, 2),
        "cells": cells,
    }
    print(json.dumps(out, indent=0))


if __name__ == "__main__":
    main()
