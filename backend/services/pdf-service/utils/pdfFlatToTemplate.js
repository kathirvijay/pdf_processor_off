/**
 * Convert a flat PDF (no form fields) into template boxes by extracting text + positions.
 * Uses pdf.js-extract. Each text item or clustered line becomes an editable box.
 */
const PDFExtract = require('pdf.js-extract').PDFExtract;
const fs = require('fs');

const EDITOR_CANVAS_WIDTH = 794;
const EDITOR_CANVAS_HEIGHT = 1123;
const MIN_BOX_WIDTH = 60;
const MIN_BOX_HEIGHT = 16;
/** PDF points: group items within this vertical distance into same line */
const LINE_Y_TOLERANCE_PT = 5;
/** PDF points: merge items on same line if horizontal gap smaller than this */
const LINE_X_GAP_MERGE_PT = 18;
/** Font size: clamp extracted size to this range (points) - match PDF generator 8-72 */
const MIN_FONT_SIZE_PT = 6;
const MAX_FONT_SIZE_PT = 72;
/** Default font size for empty cells (no text) - avoid inferring from large cell height */
const DEFAULT_FONT_SIZE_EMPTY_CELL_PT = 11;
/** Max pts above mode to allow - larger values normalized to dominant size for consistency */
const FONT_SIZE_NORMALIZE_TOLERANCE_PT = 2;

/**
 * Normalize outlier font sizes so first/header fields match body text.
 * Uses the most frequent (mode) font size; any box > mode + tolerance gets mode.
 */
function normalizeFontSizes(boxes) {
  if (!boxes.length) return;
  const sizes = boxes.map((b) => Number(b.properties?.fontSize) || 12).filter((s) => s >= MIN_FONT_SIZE_PT && s <= MAX_FONT_SIZE_PT);
  if (sizes.length === 0) return;
  const counts = {};
  for (const s of sizes) {
    counts[s] = (counts[s] || 0) + 1;
  }
  const mode = parseInt(Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0], 10);
  const maxAllowed = mode + FONT_SIZE_NORMALIZE_TOLERANCE_PT;
  for (const b of boxes) {
    const fs = Number(b.properties?.fontSize) || 12;
    if (fs > maxAllowed) {
      b.properties = b.properties || {};
      b.properties.fontSize = mode;
    }
  }
}

/** Convert label to template variable name: lowercase, spaces → underscores */
function labelToFieldName(label) {
  if (!label || typeof label !== 'string') return '';
  const s = label.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  return s || '';
}

function extractFlatPdf(filePath) {
  return new Promise((resolve, reject) => {
    const pdfExtract = new PDFExtract();
    pdfExtract.extract(filePath, { firstPage: 1, lastPage: 1 }, (err, data) => {
      if (err) return reject(err);
      resolve(data);
    });
  });
}

/**
 * In pdf.js-extract, item.y is the baseline (distance from top of page to baseline).
 * Box position must be top-left, so box top = y - height.
 */
function itemTopY(item) {
  const y = Number(item.y) ?? 0;
  const h = Math.max(0, Number(item.height) ?? 12);
  return y - h;
}

/**
 * Merge nearby values into a sorted list of unique "edges" (for grid detection).
 */
function mergeToEdges(values, snapPt) {
  if (values.length === 0) return [];
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  const out = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - out[out.length - 1] > snapPt) out.push(sorted[i]);
  }
  return out;
}

/** Overlap in X: [aMin, aMax] and [bMin, bMax] overlap */
function overlapX(a, b) {
  return a.minX < b.maxX && a.maxX > b.minX;
}
function overlapY(a, b) {
  return a.minTopY < b.maxBottomY && a.maxBottomY > b.minTopY;
}

/**
 * Expand each segment's box to the nearest other segment (or page edge) in each direction.
 * This makes each box fill the "cell" defined by the gaps between content.
 */
function expandSegmentsToNeighbors(segments, pageWidth, pageHeight) {
  const pad = 2;
  return segments.map((seg) => {
    let left = Math.max(0, seg.minX - pad);
    let right = Math.min(pageWidth, seg.maxX + pad);
    let top = Math.max(0, seg.minTopY - pad);
    let bottom = Math.min(pageHeight, seg.maxBottomY + pad);
    for (const other of segments) {
      if (other === seg) continue;
      if (overlapY(seg, other)) {
        if (other.maxX <= seg.minX) left = Math.max(left, other.maxX);
        if (other.minX >= seg.maxX) right = Math.min(right, other.minX);
      }
      if (overlapX(seg, other)) {
        if (other.maxBottomY <= seg.minTopY) top = Math.max(top, other.maxBottomY);
        if (other.minTopY >= seg.maxBottomY) bottom = Math.min(bottom, other.minTopY);
      }
    }
    const minW = (MIN_BOX_WIDTH * pageWidth) / EDITOR_CANVAS_WIDTH;
    const minH = (MIN_BOX_HEIGHT * pageHeight) / EDITOR_CANVAS_HEIGHT;
    return {
      ...seg,
      pdfX: left,
      pdfTopY: top,
      pdfW: Math.max(minW, right - left),
      pdfH: Math.max(minH, bottom - top),
    };
  });
}

/** Merge expanded segments that are adjacent (same row) so label + placeholder become one box. */
const ADJACENT_MERGE_GAP_PT = 100;
function mergeAdjacentExpanded(expanded) {
  const list = expanded
    .filter((s) => (s.items || []).map((o) => o.item.str).join('').replace(/\s+/g, ' ').trim().length > 0)
    .slice();
  list.sort((a, b) => (a.pdfTopY !== b.pdfTopY ? a.pdfTopY - b.pdfTopY : a.pdfX - b.pdfX));
  const merged = [];
  let i = 0;
  while (i < list.length) {
    const seg = list[i];
    let box = {
      pdfX: seg.pdfX,
      pdfTopY: seg.pdfTopY,
      pdfW: seg.pdfW,
      pdfH: seg.pdfH,
      items: [...seg.items],
      texts: [seg.items.map((o) => o.item.str).join('').replace(/\s+/g, ' ').trim()],
    };
    let j = i + 1;
    while (j < list.length) {
      const next = list[j];
      const sameRow = Math.abs(next.pdfTopY - box.pdfTopY) < 30 && Math.abs((next.pdfTopY + next.pdfH) - (box.pdfTopY + box.pdfH)) < 30;
      const gapX = next.pdfX - (box.pdfX + box.pdfW);
      const overlapX = next.pdfX < box.pdfX + box.pdfW && next.pdfX + next.pdfW > box.pdfX;
      if (sameRow && (gapX <= ADJACENT_MERGE_GAP_PT || overlapX)) {
        box.pdfX = Math.min(box.pdfX, next.pdfX);
        box.pdfTopY = Math.min(box.pdfTopY, next.pdfTopY);
        box.pdfW = Math.max(box.pdfX + box.pdfW, next.pdfX + next.pdfW) - box.pdfX;
        box.pdfH = Math.max(box.pdfTopY + box.pdfH, next.pdfTopY + next.pdfH) - box.pdfTopY;
        box.items = box.items.concat(next.items);
        box.texts.push(next.items.map((o) => o.item.str).join('').replace(/\s+/g, ' ').trim());
        j++;
      } else break;
    }
    merged.push(box);
    i = j;
  }
  return merged;
}

/** Expand each merged box to fill the space until the next box or page edge (so boxes fill the layout). */
function expandMergedToFillCells(merged, pageWidth, pageHeight) {
  const pad = 2;
  return merged.map((box) => {
    let right = Math.min(pageWidth, box.pdfX + box.pdfW + pad);
    let bottom = Math.min(pageHeight, box.pdfTopY + box.pdfH + pad);
    for (const other of merged) {
      if (other === box) continue;
      const overlapY = box.pdfTopY < other.pdfTopY + other.pdfH && box.pdfTopY + box.pdfH > other.pdfTopY;
      const overlapX = box.pdfX < other.pdfX + other.pdfW && box.pdfX + box.pdfW > other.pdfX;
      if (overlapY && other.pdfX >= box.pdfX + box.pdfW) {
        right = Math.min(right, other.pdfX - 1);
      }
      if (overlapX && other.pdfTopY >= box.pdfTopY + box.pdfH) {
        bottom = Math.min(bottom, other.pdfTopY - 1);
      }
    }
    const pdfW = Math.max(box.pdfW, right - box.pdfX);
    const pdfH = Math.max(box.pdfH, bottom - box.pdfTopY);
    return { ...box, pdfW, pdfH };
  });
}

/**
 * Build one grid so every box is exactly one cell. Use raw text item positions (more points)
 * then merge and coarse-quantize so grid lines match typical printed form lines (e.g. 40–50pt columns).
 */
const TEMPLATE_COL_MERGE_PT = 40;
const TEMPLATE_ROW_MERGE_PT = 12;
const COARSE_COL_PT = 45;
const COARSE_ROW_PT = 18;

function buildTemplateGrid(segments, pageWidth, pageHeight, rawItems) {
  const lefts = [], rights = [], tops = [], bottoms = [];
  if (rawItems && rawItems.length > 0) {
    for (const it of rawItems) {
      const x = it.x ?? 0, w = it.w ?? 50, topY = it.topY ?? 0, h = it.h ?? 12;
      lefts.push(x);
      rights.push(x + w);
      tops.push(topY);
      bottoms.push(topY + h);
    }
  }
  for (const s of segments) {
    lefts.push(s.minX);
    rights.push(s.maxX);
    tops.push(s.minTopY);
    bottoms.push(s.maxBottomY);
  }
  let colEdges = mergeToEdges([0, pageWidth, ...lefts, ...rights], TEMPLATE_COL_MERGE_PT);
  let rowEdges = mergeToEdges([0, pageHeight, ...tops, ...bottoms], TEMPLATE_ROW_MERGE_PT);
  if (colEdges[0] > 0) colEdges = [0, ...colEdges];
  if (colEdges[colEdges.length - 1] < pageWidth) colEdges = [...colEdges, pageWidth];
  if (rowEdges[0] > 0) rowEdges = [0, ...rowEdges];
  if (rowEdges[rowEdges.length - 1] < pageHeight) rowEdges = [...rowEdges, pageHeight];

  function coarseQuantize(edges, maxVal, step) {
    const set = new Set([0, maxVal]);
    for (const e of edges) {
      const v = Math.round(e / step) * step;
      set.add(Math.max(0, Math.min(maxVal, v)));
    }
    const out = [...set].sort((a, b) => a - b);
    return mergeToEdges(out, step);
  }
  colEdges = coarseQuantize(colEdges, pageWidth, COARSE_COL_PT);
  rowEdges = coarseQuantize(rowEdges, pageHeight, COARSE_ROW_PT);
  if (colEdges[0] > 0) colEdges = [0, ...colEdges];
  if (colEdges[colEdges.length - 1] < pageWidth) colEdges = [...colEdges, pageWidth];
  if (rowEdges[0] > 0) rowEdges = [0, ...rowEdges];
  if (rowEdges[rowEdges.length - 1] < pageHeight) rowEdges = [...rowEdges, pageHeight];

  return { colEdges, rowEdges };
}

/**
 * Assign each segment to the grid cell that contains its center. Then output one box per cell
 * with the cell's exact bounds so every box aligns with the template (all four sides on grid lines).
 * Order: top-to-bottom, left-to-right (Shipper, Pages, Shipper's Reference, Bill of Lading Number, ...).
 */
function segmentsToGridCells(segments, colEdges, rowEdges, pageWidth, pageHeight) {
  if (colEdges.length < 2 || rowEdges.length < 2) return [];

  function cellFor(seg) {
    const cx = (seg.minX + seg.maxX) / 2;
    const cy = (seg.minTopY + seg.maxBottomY) / 2;
    let ci = 0;
    for (let i = 0; i < colEdges.length - 1; i++) {
      if (cx >= colEdges[i] && cx < colEdges[i + 1]) {
        ci = i;
        break;
      }
      if (cx < colEdges[i + 1]) {
        ci = i;
        break;
      }
      ci = i + 1;
    }
    ci = Math.min(ci, colEdges.length - 2);
    let ri = 0;
    for (let i = 0; i < rowEdges.length - 1; i++) {
      if (cy >= rowEdges[i] && cy < rowEdges[i + 1]) {
        ri = i;
        break;
      }
      if (cy < rowEdges[i + 1]) {
        ri = i;
        break;
      }
      ri = i + 1;
    }
    ri = Math.min(ri, rowEdges.length - 2);
    return { col: ci, row: ri };
  }

  const byCell = new Map();
  for (const seg of segments) {
    const str = seg.items.map((o) => o.item.str).join('').replace(/\s+/g, ' ').trim();
    if (!str) continue;
    const { col, row } = cellFor(seg);
    const key = `${row},${col}`;
    if (!byCell.has(key)) {
      byCell.set(key, {
        col,
        row,
        pdfX: colEdges[col],
        pdfTopY: rowEdges[row],
        pdfW: colEdges[col + 1] - colEdges[col],
        pdfH: rowEdges[row + 1] - rowEdges[row],
        texts: [],
        fontSizes: [],
      });
    }
    const cellEntry = byCell.get(key);
    cellEntry.texts.push(str);
    for (const it of seg.items) {
      const pt = Number(it.h) || 12;
      if (pt > 0) cellEntry.fontSizes.push(pt);
    }
  }

  return Array.from(byCell.values()).sort((a, b) => (a.row !== b.row ? a.row - b.row : a.col - b.col));
}

/**
 * Build one grid from the template; assign each text segment to the cell that contains it;
 * output exactly one box per cell with the cell's exact bounds. So every box aligns with
 * the template (all four sides on grid lines), no gaps, no overlaps. Order: top-to-bottom,
 * left-to-right (Shipper, Pages, Shipper's Reference, Bill of Lading Number, ...).
 */
function contentToBoxes(pageContent, pageInfo) {
  const items = (pageContent || []).filter((item) => (item.str || '').trim().length > 0);
  if (items.length === 0) return [];

  const pageWidth = pageInfo?.width || 595;
  const pageHeight = pageInfo?.height || 842;
  const scaleX = EDITOR_CANVAS_WIDTH / pageWidth;
  const scaleY = EDITOR_CANVAS_HEIGHT / pageHeight;

  const withTop = items.map((item) => ({ item, topY: itemTopY(item), x: Number(item.x) ?? 0, w: Number(item.width) || 50, h: Number(item.height) || 12 }));
  withTop.sort((a, b) => (Math.abs(a.topY - b.topY) <= LINE_Y_TOLERANCE_PT ? a.x - b.x : a.topY - b.topY));

  const lines = [];
  let currentLine = [withTop[0]];
  let lineTopY = withTop[0].topY;
  for (let i = 1; i < withTop.length; i++) {
    const curr = withTop[i];
    if (Math.abs(curr.topY - lineTopY) <= LINE_Y_TOLERANCE_PT) {
      currentLine.push(curr);
    } else {
      lines.push(currentLine);
      currentLine = [curr];
      lineTopY = curr.topY;
    }
  }
  if (currentLine.length) lines.push(currentLine);

  const segments = [];
  for (const line of lines) {
    let seg = { items: [line[0]], minX: line[0].x, maxX: line[0].x + line[0].w, minTopY: line[0].topY, maxBottomY: line[0].topY + line[0].h };
    for (let i = 1; i < line.length; i++) {
      const curr = line[i];
      const gap = curr.x - seg.maxX;
      if (gap <= LINE_X_GAP_MERGE_PT) {
        seg.items.push(curr);
        seg.maxX = curr.x + curr.w;
        seg.minTopY = Math.min(seg.minTopY, curr.topY);
        seg.maxBottomY = Math.max(seg.maxBottomY, curr.topY + curr.h);
      } else {
        segments.push(seg);
        seg = { items: [curr], minX: curr.x, maxX: curr.x + curr.w, minTopY: curr.topY, maxBottomY: curr.topY + curr.h };
      }
    }
    segments.push(seg);
  }

  const { colEdges, rowEdges } = buildTemplateGrid(segments, pageWidth, pageHeight, withTop);
  const cells = segmentsToGridCells(segments, colEdges, rowEdges, pageWidth, pageHeight);

  if (cells.length === 0) {
    return buildBoxesFromSegments(segments, scaleX, scaleY);
  }

  const boxes = [];
  let rank = 1;
  const ts = Date.now();
  const usedFieldNames = new Set();

  for (const cell of cells) {
    const labelName = (cell.texts || []).join(' ').trim();
    const shortLabel = labelName.length > 40 ? labelName.slice(0, 37) + '...' : labelName;
    const editorX = Math.round(cell.pdfX * scaleX);
    const editorY = Math.round(cell.pdfTopY * scaleY);
    const editorW = Math.round(Math.max(MIN_BOX_WIDTH, cell.pdfW * scaleX));
    const editorH = Math.round(Math.max(MIN_BOX_HEIGHT, cell.pdfH * scaleY));

    let fieldName = labelToFieldName(labelName) || `field_${rank}`;
    if (usedFieldNames.has(fieldName)) {
      let n = 2;
      while (usedFieldNames.has(`${fieldName}_${n}`)) n++;
      fieldName = `${fieldName}_${n}`;
    }
    usedFieldNames.add(fieldName);

    const actualFontSizes = (cell.fontSizes || []).filter((s) => s > 0);
    const hasMeaningfulLabel = labelName.length > 0;
    const extractedFontSizePt = actualFontSizes.length
      ? Math.round(Math.max(MIN_FONT_SIZE_PT, Math.min(MAX_FONT_SIZE_PT, Math.max(...actualFontSizes))))
      : (!hasMeaningfulLabel ? DEFAULT_FONT_SIZE_EMPTY_CELL_PT : (cell.pdfH && cell.pdfH > 0 ? Math.round(Math.max(MIN_FONT_SIZE_PT, Math.min(MAX_FONT_SIZE_PT, cell.pdfH * 0.9))) : DEFAULT_FONT_SIZE_EMPTY_CELL_PT));
    boxes.push({
      id: `box_${ts}_${rank}`,
      type: 'text',
      rank,
      position: { x: Math.max(0, editorX), y: Math.max(0, editorY) },
      size: { width: editorW, height: editorH },
      labelName: shortLabel,
      content: `{{${fieldName}}}`,
      fieldName,
      properties: {
        fontSize: extractedFontSizePt,
        fontFamily: 'Arial',
        fontWeight: 'normal',
        fontColor: '#000000',
        backgroundColor: 'transparent',
        alignment: 'left',
        contentPosition: { x: 0, y: 0 },
        border: true,
      },
    });
    rank += 1;
  }

  return boxes.sort((a, b) => (a.position.y !== b.position.y ? a.position.y - b.position.y : a.position.x - b.position.x));
}

function buildBoxesFromSegments(segments, scaleX, scaleY) {
  const boxes = [];
  let rank = 1;
  const ts = Date.now();
  const usedFieldNames = new Set();
  for (const seg of segments) {
    const str = seg.items.map((o) => o.item.str).join('').replace(/\s+/g, ' ').trim();
    if (!str) continue;
    const editorX = Math.round(seg.minX * scaleX);
    const editorY = Math.round(seg.minTopY * scaleY);
    const editorW = Math.round(Math.max(MIN_BOX_WIDTH, (seg.maxX - seg.minX) * scaleX));
    const editorH = Math.round(Math.max(MIN_BOX_HEIGHT, (seg.maxBottomY - seg.minTopY) * scaleY));
    const segHeights = (seg.items || []).map((o) => Number(o.h) || 12).filter((h) => h > 0);
    const extractedFontSizePt = segHeights.length
      ? Math.round(Math.max(MIN_FONT_SIZE_PT, Math.min(MAX_FONT_SIZE_PT, Math.max(...segHeights))))
      : 12;
    const labelName = str.length > 40 ? str.slice(0, 37) + '...' : str;
    let fieldName = labelToFieldName(str) || `field_${rank}`;
    if (usedFieldNames.has(fieldName)) {
      let n = 2;
      while (usedFieldNames.has(`${fieldName}_${n}`)) n++;
      fieldName = `${fieldName}_${n}`;
    }
    usedFieldNames.add(fieldName);
    boxes.push({
      id: `box_${ts}_${rank}`,
      type: 'text',
      rank,
      position: { x: Math.max(0, editorX), y: Math.max(0, editorY) },
      size: { width: editorW, height: editorH },
      labelName,
      content: `{{${fieldName}}}`,
      fieldName,
      properties: {
        fontSize: extractedFontSizePt,
        fontFamily: 'Arial',
        fontWeight: 'normal',
        fontColor: '#000000',
        backgroundColor: 'transparent',
        alignment: 'left',
        contentPosition: { x: 0, y: 0 },
        border: true,
      },
    });
    rank += 1;
  }
  return boxes.sort((a, b) => (a.position.y !== b.position.y ? a.position.y - b.position.y : a.position.x - b.position.x));
}

/**
 * @param {string} filePath - path to uploaded PDF
 * @returns {Promise<{ boxes: Array<object>, templateName?: string, pageSize?: string, orientation?: string }>}
 */
async function pdfFlatToTemplate(filePath) {
  const data = await extractFlatPdf(filePath);
  const pages = data?.pages || [];
  if (pages.length === 0) {
    return { boxes: [], templateName: 'Imported from PDF', message: 'No content could be extracted from the PDF.' };
  }

  const page = pages[0];
  const pageInfo = page?.pageInfo || {};
  const content = page?.content || [];
  const boxes = contentToBoxes(content, pageInfo);
  normalizeFontSizes(boxes);

  const pageWidth = pageInfo.width || 595;
  const pageHeight = pageInfo.height || 842;
  const templateName = data?.meta?.metadata?.['dc:title'] || data?.meta?.info?.Title || 'Imported from PDF';

  return {
    boxes,
    templateName: (templateName && String(templateName).trim()) || 'Imported from PDF',
    pageSize: 'A4',
    orientation: pageWidth > pageHeight ? 'landscape' : 'portrait',
  };
}

module.exports = { pdfFlatToTemplate, extractFlatPdf, contentToBoxes, normalizeFontSizes };
