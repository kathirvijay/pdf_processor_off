const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

/** Replace {{key}} placeholders with values from data. Missing keys render as empty, not as literal {{key}}. */
const replacePlaceholders = (content, data) => {
  if (!content) return '';
  const dataObj = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  return String(content).replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (match, key) => {
    const k = String(key).trim();
    const val = dataObj[k];
    return (val !== undefined && val !== null) ? String(val) : '';
  });
};

function getContainerTableRowsFlat(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
  const containersList = Array.isArray(data.containers) ? data.containers : (Array.isArray(data.container) ? data.container : []);
  if (containersList.length === 0) return [];
  const flat = [];
  for (const container of containersList) {
    flat.push({ type: 'container', container, item: null });
    const items = Array.isArray(container && container.items) ? container.items : [];
    for (const item of items) flat.push({ type: 'item', container, item });
  }
  return flat;
}

function getDataTableCellContainerHeading(container, colIndex) {
  if (colIndex !== 0) return '';
  const cn = container && container.container_number;
  const ct = container && container.container_type;
  return (cn && ct) ? `${cn}, ${ct}` : (cn || ct || '');
}

function getDataTableCellContainerItem(item, baseKey) {
  const b = String(baseKey || '').trim().toLowerCase();
  if (b === 'marks_and_numbers') return item && item.marks_and_numbers != null ? String(item.marks_and_numbers) : '';
  if (b === 'kind_no_of_packages' || b === 'kind_&_no_of_packages') return item && item.packages != null ? String(item.packages) : '';
  if (b === 'description_of_goods') return (item && (item.description != null ? item.description : item.commodity)) || '';
  if (b === 'gross_weight_kg' || b === 'gross_weight_(kg)') return item && item.weight != null ? String(item.weight) : '';
  if (b === 'measurements_m' || b === 'measurements_m³' || b === 'measurements_(m³)') return item && item.volume != null ? String(item.volume) : '';
  return '';
}

function getDataTableRowMeta(data, columnKeys, row1) {
  const flat = getContainerTableRowsFlat(data);
  if (flat.length === 0) return undefined;
  const row = flat[row1 - 1];
  return row && row.type === 'container' ? { isContainerHeading: true } : undefined;
}

function getDataTableRowCount(data, columnKeys) {
  if (!data || !Array.isArray(columnKeys) || !columnKeys.length) return 0;
  const containerFlat = getContainerTableRowsFlat(data);
  if (containerFlat.length > 0) return Math.min(500, containerFlat.length);
  let maxN = 0;
  for (const baseKey of columnKeys) {
    const key = String(baseKey).trim();
    if (!key) continue;
    for (let i = 1; i <= 500; i++) {
      if (data[`${key}_${i}`] === undefined) break;
      maxN = Math.max(maxN, i);
    }
  }
  return maxN;
}

function getDataTableCell(data, columnKeys, rowIndex1Based, colIndex) {
  if (!data || !columnKeys || !columnKeys[colIndex]) return '';
  const base = String(columnKeys[colIndex] || '').trim();
  const containerFlat = getContainerTableRowsFlat(data);
  if (containerFlat.length > 0) {
    const row = containerFlat[rowIndex1Based - 1];
    if (row) {
      if (row.type === 'container') return getDataTableCellContainerHeading(row.container, colIndex);
      if (row.type === 'item' && row.item) return getDataTableCellContainerItem(row.item, base) || '';
    }
  }
  const key = `${base}_${rowIndex1Based}`;
  let v = data[key];
  if (v == null && (base === 'measurements_m' || base === 'measurements_m³')) {
    v = data[`measurements_m3_${rowIndex1Based}`];
  }
  return v != null ? String(v) : '';
}

/** Editor canvas dimensions in px (match frontend pageSizeDimensions). */
const EDITOR_PAGE_DIMENSIONS = {
  A4: { portrait: { width: 794, height: 1123 }, landscape: { width: 1123, height: 794 } },
  A3: { portrait: { width: 1123, height: 1587 }, landscape: { width: 1587, height: 1123 } },
  A5: { portrait: { width: 559, height: 794 }, landscape: { width: 794, height: 559 } },
};

function getEditorPageHeight(settings) {
  const orientation = settings.orientation || 'portrait';
  const pageSize = settings.pageSize || 'A4';
  const dims = EDITOR_PAGE_DIMENSIONS[pageSize] || EDITOR_PAGE_DIMENSIONS.A4;
  const d = orientation === 'portrait' ? dims.portrait : dims.landscape;
  return d.height;
}

const DATA_TABLE_HEADER_ROW_PX = 28;
const DATA_TABLE_ROW_HEIGHT_PX = 30;
/** Full-width boxed area (px) between first three table rows and remaining content. */
const DATA_TABLE_SPACER_PX = 120;
/** Height (px) of the empty gap inside the table when rowCount <= 3; full width. Kept smaller so gap to next field is 2–3px. */
/** Gap (px) between table bottom border and the next field (e.g. Total This Page); 2px only. */
const GAP_BETWEEN_TABLE_AND_NEXT_FIELD_PX = 8;
/** Gap (px) between fields above and the table top; 2px. */
const GAP_ABOVE_TABLE_PX = 2;
/** When item count exceeds this, first page shows only header + "Find details in attached list"; all rows on attachment pages. */
const DATA_TABLE_ATTACHED_LIST_THRESHOLD = 3;
/** Height (px) of the gap area inside the table when in attached list mode (header + this = first segment; message row uses this). */
const DATA_TABLE_ATTACHED_LIST_GAP_PX = 100;
/** Height (px) reserved for document title on each page; table content uses page height minus this for row-range. */
const EDITOR_TITLE_AREA_PX = 90;

function getDataTableEffectiveHeight(box, data) {
  if (!box?.tableConfig?.dynamicRowsFromData || !Array.isArray(box.tableConfig.columnKeys)) return null;
  const rowCount = getDataTableRowCount(data || {}, box.tableConfig.columnKeys);
  return DATA_TABLE_HEADER_ROW_PX + Math.max(0, rowCount) * DATA_TABLE_ROW_HEIGHT_PX;
}

/** Height of only the first segment (first N rows on page 1). When rowCount > threshold, page 1 = header + message; use at least design height so first page table matches sidebar (e.g. 450px). */
function getDataTableFirstSegmentHeight(box, data) {
  if (!box?.tableConfig?.dynamicRowsFromData || !Array.isArray(box.tableConfig?.columnKeys)) return null;
  const rowCount = getDataTableRowCount(data || {}, box.tableConfig.columnKeys);
  const rowsOnFirst = Math.max(1, Number(box?.tableConfig?.rowsOnFirstPage) || 3);
  const designHeight = Math.max(20, Number(box?.size?.height) || 20);
  const useAttachedListMode = rowCount > DATA_TABLE_ATTACHED_LIST_THRESHOLD;
  if (useAttachedListMode) return Math.max(DATA_TABLE_HEADER_ROW_PX + DATA_TABLE_ATTACHED_LIST_GAP_PX, designHeight);
  const rowsToShow = Math.min(rowsOnFirst, Math.max(0, rowCount));
  return Math.max(DATA_TABLE_HEADER_ROW_PX + rowsToShow * DATA_TABLE_ROW_HEIGHT_PX, designHeight);
}

/** Get { startRow, endRow } for a data table. When rowCount > threshold, page 0 = 0 rows (message row only); all rows on page 1, 2, ... */
function getDataTableRowRangeForPage(box, tablePageIndex, rowCount, pageHeightPx) {
  const rowsOnFirst = Math.max(1, Number(box?.tableConfig?.rowsOnFirstPage) || 3);
  const rowsOnOther = box?.tableConfig?.rowsOnOtherPages != null ? Math.max(1, Number(box.tableConfig.rowsOnOtherPages)) : null;
  const tablePage = Math.max(0, Number(tablePageIndex) || 0);
  const useAttachedListMode = rowCount > DATA_TABLE_ATTACHED_LIST_THRESHOLD;
  if (tablePage === 0) {
    if (useAttachedListMode) return { startRow: 0, endRow: 0 };
    return { startRow: 0, endRow: Math.min(rowsOnFirst, rowCount) };
  }
  if (useAttachedListMode) {
    const rowsPerPage = rowsOnOther != null ? rowsOnOther : Math.max(1, Math.floor((pageHeightPx - DATA_TABLE_HEADER_ROW_PX) / DATA_TABLE_ROW_HEIGHT_PX));
    const startRow = (tablePage - 1) * rowsPerPage;
    const endRow = Math.min(startRow + rowsPerPage, rowCount);
    return { startRow: Math.min(startRow, rowCount), endRow: Math.max(endRow, startRow) };
  }
  const afterFirst = rowsOnFirst;
  if (afterFirst >= rowCount) return { startRow: rowCount, endRow: rowCount };
  if (rowsOnOther != null) {
    const startRow = Math.min(rowCount, afterFirst + (tablePage - 1) * rowsOnOther);
    const endRow = Math.min(startRow + rowsOnOther, rowCount);
    return { startRow, endRow: Math.max(endRow, startRow) };
  }
  const rowsPerPage = Math.max(1, Math.floor((pageHeightPx - DATA_TABLE_HEADER_ROW_PX) / DATA_TABLE_ROW_HEIGHT_PX));
  const startRow = Math.min(rowCount, afterFirst + (tablePage - 1) * rowsPerPage);
  const endRow = Math.min(startRow + rowsPerPage, rowCount);
  return { startRow, endRow: Math.max(endRow, startRow) };
}

/** Total height of a data table when paginated. When rowCount > threshold, first page = header + 1 row; all data on attachment pages. */
function getDataTablePaginatedTotalHeight(box, data, pageHeightPx, tableY = 0) {
  if (!box?.tableConfig?.dynamicRowsFromData || !Array.isArray(box.tableConfig?.columnKeys)) return null;
  const rowCount = getDataTableRowCount(data || {}, box.tableConfig.columnKeys);
  if (rowCount <= 0) return DATA_TABLE_HEADER_ROW_PX;
  const firstSegmentHeight = getDataTableFirstSegmentHeight(box, data);
  if (firstSegmentHeight == null) return null;
  let totalHeight = firstSegmentHeight;
  let tablePageIndex = 1;
  while (true) {
    const range = getDataTableRowRangeForPage(box, tablePageIndex, rowCount, pageHeightPx);
    if (range.endRow <= range.startRow) break;
    totalHeight += DATA_TABLE_HEADER_ROW_PX + (range.endRow - range.startRow) * DATA_TABLE_ROW_HEIGHT_PX;
    if (range.endRow >= rowCount) break;
    tablePageIndex++;
  }
  return totalHeight;
}

/** Number of table pages needed so every row is on some page (ensures PDF has enough pages). */
function getDataTablePageCount(box, rowCount, pageHeightPx) {
  if (rowCount <= 0) return 1;
  const contentHeightPx = pageHeightPx - EDITOR_TITLE_AREA_PX;
  let count = 0;
  for (let tablePageIndex = 0; ; tablePageIndex++) {
    const range = getDataTableRowRangeForPage(box, tablePageIndex, rowCount, contentHeightPx);
    if (range.endRow > range.startRow) count++;
    if (range.endRow >= rowCount) return Math.max(1, count);
    if (tablePageIndex > 500) return Math.max(1, count);
  }
}

/**
 * @param {object} [layoutOverrides] - Optional. When provided by Puppeteer: effectiveHeightByBoxId, tablePageCountByBoxId.
 *   Use these for data tables so layout matches dynamic row heights and page count.
 */
function buildMultiPageLayout(boxes, data, editorPageHeightPx, layoutOverrides) {
  const contentHeightPx = editorPageHeightPx - EDITOR_TITLE_AREA_PX;
  const effectiveHeightByBoxId = {};
  let totalExtraHeight = 0;
  const effectiveOverrides = layoutOverrides?.effectiveHeightByBoxId;
  const tablePageCountOverrides = layoutOverrides?.tablePageCountByBoxId;
  boxes.forEach((box) => {
    const designHeight = Math.max(20, Number(box.size?.height) || 20);
    if (effectiveOverrides != null && effectiveOverrides[box.id] != null) {
      effectiveHeightByBoxId[box.id] = effectiveOverrides[box.id];
      return;
    }
    let effective;
    if (box?.tableConfig?.dynamicRowsFromData && Array.isArray(box.tableConfig?.columnKeys)) {
      effective = getDataTableFirstSegmentHeight(box, data);
      if (effective != null) {
        const rowCount = getDataTableRowCount(data || {}, box.tableConfig.columnKeys);
        const rowsOnFirst = Math.max(1, Number(box?.tableConfig?.rowsOnFirstPage) || 3);
        const useAttachedListMode = rowCount > DATA_TABLE_ATTACHED_LIST_THRESHOLD;
        /* Respect user-configured table height: use at least designHeight so PDF matches canvas */
        effective = Math.max(Number(effective), designHeight);
      }
    }
    if (effective == null) effective = getDataTableEffectiveHeight(box, data);
    if (effective == null) effective = designHeight;
    if (effective != null && box?.tableConfig?.dynamicRowsFromData && Array.isArray(box.tableConfig?.columnKeys)) {
      effective = Math.max(Number(effective), designHeight);
    }
    effectiveHeightByBoxId[box.id] = effective;
    if (effective != null && effective > designHeight) totalExtraHeight += Math.max(0, effective - designHeight);
  });
  const isEmptyBox = (b) => {
    const hasField = (b.fieldName && String(b.fieldName).trim()) || (b.labelName && String(b.labelName).trim());
    const hasContent = b.content && String(b.content).trim() && !/^\{\{\s*\}\}$/.test(String(b.content).trim());
    return !hasField && !hasContent && b.type !== 'table' && b.type !== 'logo';
  };
  boxes.forEach((t) => {
    if (!t?.tableConfig?.dynamicRowsFromData || !Array.isArray(t.tableConfig?.columnKeys)) return;
    const tEffective = effectiveHeightByBoxId[t.id];
    if (tEffective == null) return;
    const tTop = t.position?.y ?? 0;
    const firstSegmentBottom = tTop + tEffective;
    const rowCount = getDataTableRowCount(data || {}, t.tableConfig.columnKeys);
    const rowsOnFirst = Math.max(1, Number(t?.tableConfig?.rowsOnFirstPage) || 3);
    const spacerPx = GAP_BETWEEN_TABLE_AND_NEXT_FIELD_PX;
    const spacerBottom = firstSegmentBottom + spacerPx;
    boxes.forEach((b) => {
      if (b.id === t.id || b.type === 'table') return;
      const bTop = b.position?.y ?? 0;
      const bH = b.size?.height ?? 20;
      const bBottom = bTop + bH;
      const overlapsSpacer = bTop < spacerBottom && bBottom > firstSegmentBottom;
      if (spacerPx > 0 && overlapsSpacer && isEmptyBox(b)) {
        effectiveHeightByBoxId[b.id] = 0;
      }
    });
  });
  const minYBelowTable = {};
  boxes.forEach((t) => {
    if (!t?.tableConfig?.dynamicRowsFromData || !Array.isArray(t.tableConfig?.columnKeys)) return;
    const tEffective = effectiveHeightByBoxId[t.id];
    if (tEffective == null) return;
    const tTop = t.position?.y ?? 0;
    const firstSegmentBottom = tTop + tEffective;
    let minY = Infinity;
    boxes.forEach((b) => {
      if (b.id === t.id) return;
      const bEffH = effectiveHeightByBoxId[b.id] ?? (b.size?.height ?? 20);
      if (bEffH <= 0) return;
      const bTop = b.position?.y ?? 0;
      const bBottom = bTop + (b.size?.height ?? 20);
      if (bTop >= firstSegmentBottom || bBottom > firstSegmentBottom) {
        minY = Math.min(minY, bTop);
      }
    });
    minYBelowTable[t.id] = minY === Infinity ? null : minY;
  });
  const boxYOffset = {};
  boxes.forEach((b) => {
    let offset = 0;
    const bTop = b.position?.y ?? 0;
    const bHeight = effectiveHeightByBoxId[b.id] ?? (b.size?.height ?? 20);
    const bBottom = bTop + Math.max(0, bHeight);
    boxes.forEach((t) => {
      if (t.id === b.id) return;
      const tEffective = effectiveHeightByBoxId[t.id];
      const tDesign = t.size?.height ?? 20;
      const tTop = t.position?.y ?? 0;
      const isDataTable = t?.tableConfig?.dynamicRowsFromData && Array.isArray(t.tableConfig?.columnKeys);
      if (isDataTable && tEffective != null) {
        const firstSegmentBottom = tTop + tEffective;
        const rowCount = getDataTableRowCount(data || {}, t.tableConfig.columnKeys);
        const rowsOnFirst = Math.max(1, Number(t?.tableConfig?.rowsOnFirstPage) || 3);
        const spacerPx = GAP_BETWEEN_TABLE_AND_NEXT_FIELD_PX;
        const spacerBottom = firstSegmentBottom + spacerPx;
        const minY = minYBelowTable[t.id];
        if (bTop >= firstSegmentBottom) {
          offset += minY != null ? spacerBottom - minY : (tEffective + spacerPx) - tDesign;
        } else if (bBottom > firstSegmentBottom) {
          offset += Math.max(0, spacerBottom - bTop);
        } else if (bTop < firstSegmentBottom && bBottom > tTop) {
          /* Box is inside table span (e.g. placed below old design height but above effective height): push below table */
          offset += Math.max(0, spacerBottom - bTop);
        }
      } else if (tEffective != null && tEffective > tDesign && bTop >= tTop + tDesign) {
        offset += tEffective - tDesign;
      }
    });
    boxYOffset[b.id] = offset;
  });
  boxes.forEach((t) => {
    if (!t?.tableConfig?.dynamicRowsFromData || !Array.isArray(t.tableConfig?.columnKeys)) return;
    const tTop = t.position?.y ?? 0;
    let maxBottomAbove = -Infinity;
    boxes.forEach((b) => {
      if (b.id === t.id) return;
      const bH = effectiveHeightByBoxId[b.id] ?? (b.size?.height ?? 20);
      const bBottom = (b.position?.y ?? 0) + bH;
      if (bBottom <= tTop) maxBottomAbove = Math.max(maxBottomAbove, bBottom);
    });
    if (maxBottomAbove > -Infinity) {
      const gapAbove = tTop - maxBottomAbove;
      if (gapAbove > GAP_ABOVE_TABLE_PX) {
        boxYOffset[t.id] = (boxYOffset[t.id] || 0) - (gapAbove - GAP_ABOVE_TABLE_PX);
      }
    }
  });
  let totalHeight = Math.max(
    editorPageHeightPx,
    ...boxes.map((b) => {
      const top = (b.position?.y ?? 0) + (boxYOffset[b.id] || 0);
      const h = effectiveHeightByBoxId[b.id] ?? (b.size?.height ?? 20);
      return top + h;
    })
  );
  boxes.forEach((box) => {
    if (box?.tableConfig?.dynamicRowsFromData && Array.isArray(box.tableConfig?.columnKeys)) {
      const tableTop = (box.position?.y ?? 0) + (boxYOffset[box.id] || 0);
      const firstSegmentHeight = effectiveHeightByBoxId[box.id] ?? 0;
      totalHeight = Math.max(totalHeight, tableTop + firstSegmentHeight);
      if (effectiveOverrides != null && effectiveOverrides[box.id] != null) return;
      const rowCount = getDataTableRowCount(data || {}, box.tableConfig.columnKeys);
      const useAttachedListMode = rowCount > DATA_TABLE_ATTACHED_LIST_THRESHOLD;
      if (useAttachedListMode && rowCount > 0) {
        let tablePageIndex = 1;
        while (true) {
          const range = getDataTableRowRangeForPage(box, tablePageIndex, rowCount, contentHeightPx);
          if (range.endRow <= range.startRow) break;
          const segmentHeight = DATA_TABLE_HEADER_ROW_PX + (range.endRow - range.startRow) * DATA_TABLE_ROW_HEIGHT_PX;
          const endYOnPage = tablePageIndex * editorPageHeightPx + segmentHeight;
          totalHeight = Math.max(totalHeight, endYOnPage);
          if (range.endRow >= rowCount) break;
          tablePageIndex++;
        }
      } else {
        const fullTableHeight = getDataTablePaginatedTotalHeight(box, data, contentHeightPx, box.position?.y ?? 0);
        if (fullTableHeight != null) totalHeight = Math.max(totalHeight, tableTop + fullTableHeight);
      }
    }
  });
  let numPages = Math.max(1, Math.ceil(totalHeight / editorPageHeightPx));
  boxes.forEach((box) => {
    if (!box?.tableConfig?.dynamicRowsFromData || !Array.isArray(box.tableConfig?.columnKeys)) return;
    if (tablePageCountOverrides != null && tablePageCountOverrides[box.id] != null) {
      numPages = Math.max(numPages, tablePageCountOverrides[box.id]);
      return;
    }
    const rowCount = getDataTableRowCount(data || {}, box.tableConfig?.columnKeys);
    const tablePages = getDataTablePageCount(box, rowCount, editorPageHeightPx);
    numPages = Math.max(numPages, tablePages);
  });
  return { effectiveHeightByBoxId, boxYOffset, totalHeight, numPages, editorPageHeightPx };
}

/** Tolerance (pt) for considering two edges as shared (covers rounding/clipping). */
const PDF_ADJACENT_EPS = 8;

/**
 * Which edges of a box should be drawn so adjacent boxes share a single line (no double border).
 * @param {string} boxId - current box id
 * @param {number} x,y,width,height - box rect in pt
 * @param {Array<{boxId, x, y, width, height}>} otherRects - other boxes on same page (exclude current)
 */
function getPdfBoxEdgeVisibility(boxId, x, y, width, height, otherRects) {
  const left = x;
  const right = x + width;
  const top = y;
  const bottom = y + height;
  const eps = PDF_ADJACENT_EPS;
  const idA = String(boxId);
  const vertOverlap = (r) => r.top < bottom && top < r.bottom;
  const horizOverlap = (r) => r.left < right && left < r.right;
  const isTopNeighbor = (r) => String(r.boxId) !== idA && Math.abs(r.bottom - top) <= eps && horizOverlap(r);
  const isBottomNeighbor = (r) => String(r.boxId) !== idA && Math.abs(r.top - bottom) <= eps && horizOverlap(r);
  const isLeftNeighbor = (r) => String(r.boxId) !== idA && Math.abs(r.right - left) <= eps && vertOverlap(r);
  const isRightNeighbor = (r) => String(r.boxId) !== idA && Math.abs(r.left - right) <= eps && vertOverlap(r);
  const drawTop = !otherRects.some((r) => isTopNeighbor(r) && String(r.boxId) < idA);
  const drawBottom = !otherRects.some((r) => isBottomNeighbor(r) && String(r.boxId) < idA);
  const drawLeft = !otherRects.some((r) => isLeftNeighbor(r) && String(r.boxId) < idA);
  const drawRight = !otherRects.some((r) => isRightNeighbor(r) && String(r.boxId) < idA);
  return { drawTop, drawBottom, drawLeft, drawRight };
}

/** Map editor font family to PDFKit built-in font names (Helvetica, Times-Roman, Courier). */
function getPdfFontFamily(box) {
  const family = (box.properties?.fontFamily || '').trim();
  const bold = box.properties?.fontWeight === 'bold';
  const base = family.toLowerCase();
  if (base.includes('times')) return bold ? 'Times-Bold' : 'Times-Roman';
  if (base.includes('courier')) return bold ? 'Courier-Bold' : 'Courier';
  return bold ? 'Helvetica-Bold' : 'Helvetica';
}

const parseColor = (color) => {
  if (!color || color === 'transparent' || color === '' || color === 'null' || color === 'undefined') {
    return { r: 1, g: 1, b: 1 };
  }
  const colorStr = String(color).trim();
  if (!colorStr || colorStr === 'transparent') return { r: 1, g: 1, b: 1 };
  let r = 1, g = 1, b = 1;
  if (colorStr.startsWith('#')) {
    const hex = colorStr.slice(1);
    if (hex.length === 6) {
      r = parseInt(hex.slice(0, 2), 16) / 255;
      g = parseInt(hex.slice(2, 4), 16) / 255;
      b = parseInt(hex.slice(4, 6), 16) / 255;
    } else if (hex.length === 3) {
      r = parseInt(hex[0] + hex[0], 16) / 255;
      g = parseInt(hex[1] + hex[1], 16) / 255;
      b = parseInt(hex[2] + hex[2], 16) / 255;
    }
  } else {
    const lower = colorStr.toLowerCase();
    if (lower === 'black') r = g = b = 0;
    else if (lower === 'white' || lower === '#f0f0f0' || lower === 'light grey') r = g = b = 0.94;
    else if (lower === '#d0d0d0' || lower === 'grey') r = g = b = 0.82;
    else if (lower === '#808080' || lower === 'dark grey') r = g = b = 0.5;
  }
  return { r: Math.max(0, Math.min(1, r)), g: Math.max(0, Math.min(1, g)), b: Math.max(0, Math.min(1, b)) };
};

const generatePdf = async (template, data, uploadsDir) => {
  const dataObj = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  const settings = template.settings || {};
  let pages = template.pages;
  if (!Array.isArray(pages)) {
    if (pages != null && typeof pages === 'string') {
      try {
        const parsed = JSON.parse(pages);
        pages = Array.isArray(parsed) ? parsed : (parsed != null ? [parsed] : []);
      } catch (_) {
        pages = [];
      }
    } else {
      pages = pages != null ? [pages] : [];
    }
  }
  pages = pages.map((p) => (p && typeof p === 'object' ? p : { boxes: [] }));
  const orientation = String(settings.orientation || 'portrait').toLowerCase();
  const pageSizeRaw = settings.pageSize || 'A4';
  const pageSize = typeof pageSizeRaw === 'string' ? pageSizeRaw : 'A4';
  const margins = Object.assign(
    { top: 5, bottom: 5, left: 5, right: 5 },
    settings.margins && typeof settings.margins === 'object' ? settings.margins : {}
  );

  if (pages.length === 0) throw new Error('Template has no pages');

  const templateId = template.id != null ? String(template.id) : 'unknown';
  const filename = `pdf_${Date.now()}_${templateId}.pdf`;
  const filepath = path.join(uploadsDir, filename);

  let stream;
  try {
  const doc = new PDFDocument({
    size: pageSize,
    layout: orientation,
    margins: { top: margins.top, bottom: margins.bottom, left: margins.left, right: margins.right },
  });

  stream = fs.createWriteStream(filepath);
  doc.pipe(stream);

  const TITLE_TOP_GAP_PT = 19;
  const TITLE_BOTTOM_GAP_PT = 19;
  const documentTitle = settings.title || template.name || '';

  const allBoxes = pages.reduce((acc, p) => acc.concat(p.boxes || []), []);
  const sortedBoxes = allBoxes.sort((a, b) => (a.rank || 0) - (b.rank || 0));
  const editorPageHeightPx = getEditorPageHeight(settings);
  const layout = buildMultiPageLayout(sortedBoxes, dataObj, editorPageHeightPx);
  const { effectiveHeightByBoxId, boxYOffset } = layout;
  let numPages = layout.numPages;

  const editorCanvasWidth = orientation === 'portrait' ? 794 : 1123;
  /* Use actual PDF page size (A4 / A3 / A5 from template) so rows per page adapt to page size */
  const pageRef = doc.page || {};
  const A4_PT = { width: 595.28, height: 841.89 };
  const pageHeightPt = typeof pageRef.height === 'number' ? pageRef.height : (orientation === 'portrait' ? A4_PT.height : A4_PT.width);
  const pageWidthPt = typeof pageRef.width === 'number' ? pageRef.width : (orientation === 'portrait' ? A4_PT.width : A4_PT.height);
  const availableWidthFirst = pageWidthPt - margins.left - margins.right;
  const titleHeight = documentTitle ? (TITLE_TOP_GAP_PT + 18 + TITLE_BOTTOM_GAP_PT) : 0;
  const contentStartYFirst = margins.top + titleHeight;
  /* All pages draw title, so table always starts at contentStartYFirst; use same content area for every page */
  const contentHeightPtFirstPage = pageHeightPt - contentStartYFirst - margins.bottom;
  const contentHeightPtContinuation = pageHeightPt - contentStartYFirst - margins.bottom;
  const pxToPt = availableWidthFirst / editorCanvasWidth;

  /** Cache: boxId -> { rowHeightsPt, ranges } for dynamic fill-by-height table pagination (driven by page size) */
  const dynamicTableCache = new Map();
  sortedBoxes.forEach((box) => {
    if (box.type !== 'table' || !box.tableConfig?.dynamicRowsFromData || !Array.isArray(box.tableConfig?.columnKeys)) return;
    try {
      const columnKeys = box.tableConfig.columnKeys;
      const rowCount = getDataTableRowCount(dataObj, columnKeys);
      if (rowCount <= 0) return;
      const colCount = columnKeys.length;
      const widthPt = Math.max(10, (box.size?.width || 100) * pxToPt);
      const colWidths = (box.tableConfig.columnWidths && Array.isArray(box.tableConfig.columnWidths))
        ? box.tableConfig.columnWidths.map((p) => (p / 100) * widthPt)
        : Array(colCount).fill(widthPt / colCount);
      const fontSize = Math.max(8, Math.min(72, Number(box.properties?.fontSize) || 11));
      doc.fontSize(fontSize).font('Helvetica');
      const rowHeightPt = fontSize + 6;
      const minRowPt = rowHeightPt;
      const maxRowPt = rowHeightPt * 25;
      const headerHeightPt = rowHeightPt;
      const rowHeightsPt = [];
      for (let ri = 0; ri < rowCount; ri++) {
        let h = minRowPt;
        for (let ci = 0; ci < colCount; ci++) {
          const cw = colWidths[ci] || widthPt / colCount;
          const cellText = getDataTableCell(dataObj, columnKeys, ri + 1, ci);
          h = Math.max(h, Math.min(maxRowPt, doc.heightOfString(cellText || '', { width: Math.max(1, cw - 6) }) + 6));
        }
        rowHeightsPt.push(h);
      }
      const useAttachedListMode = rowCount > DATA_TABLE_ATTACHED_LIST_THRESHOLD;
      const ranges = [];
      let start = 0;
      if (useAttachedListMode) {
        ranges.push({ startRow: 0, endRow: 0 });
      }
      const tableYEditorPx = (box.position?.y ?? 0) + (boxYOffset[box.id] || 0);
      const tableLocalYPage0Px = Math.max(0, tableYEditorPx - EDITOR_TITLE_AREA_PX);
      const tableStartYFirstPagePt = contentStartYFirst + tableLocalYPage0Px * pxToPt;
      const availableForTableFirstPagePt = Math.max(0, pageHeightPt - tableStartYFirstPagePt - margins.bottom - headerHeightPt);
      /* Use 97% of available height so table fills the page (minimal gap); row heights are content-based so items per page stays variable */
      const SAFETY_MARGIN_PT = 2;
      const SAFETY_FRACTION = 0.97;
      while (start < rowCount) {
        const avail = (ranges.length === 0 && !useAttachedListMode)
          ? availableForTableFirstPagePt
          : contentHeightPtContinuation - headerHeightPt;
        let end = start;
        let accum = 0;
        const availSafe = Math.max(0, (avail * SAFETY_FRACTION) - SAFETY_MARGIN_PT);
        while (end < rowCount && accum + rowHeightsPt[end] <= availSafe) {
          accum += rowHeightsPt[end];
          end++;
        }
        if (end === start) end = Math.min(start + 1, rowCount);
        ranges.push({ startRow: start, endRow: end });
        start = end;
      }
      dynamicTableCache.set(box.id, { rowHeightsPt, ranges });
      numPages = Math.max(numPages, ranges.length);
    } catch (err) {
      console.error('Dynamic table cache for box', box.id, err.message || err);
    }
  });
  if (dynamicTableCache.size > 0) {
    let tablePages = 0;
    dynamicTableCache.forEach((cached) => {
      tablePages = Math.max(tablePages, cached.ranges.length);
    });
    numPages = tablePages;
  }

  for (let pageIndex = 0; pageIndex < numPages; pageIndex++) {
    if (pageIndex > 0) doc.addPage();
    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const availableWidth = pageWidth - margins.left - margins.right;
    const availableHeight = pageHeight - margins.top - margins.bottom;
    const titleHeight = documentTitle ? (TITLE_TOP_GAP_PT + 18 + TITLE_BOTTOM_GAP_PT) : 0;
    const contentStartY = margins.top + titleHeight;
    const pdfPageWidth = pageWidth - margins.left - margins.right;
    const pxToPt = pdfPageWidth / editorCanvasWidth;

    const pageTopEditor = pageIndex * editorPageHeightPx;
    const pageBottomEditor = (pageIndex + 1) * editorPageHeightPx;

    if (documentTitle) {
      doc.fontSize(20).font('Helvetica-Bold').fillColor(0, 0, 0)
        .text(documentTitle, margins.left, margins.top + TITLE_TOP_GAP_PT, {
          width: doc.page.width - margins.left - margins.right,
          align: 'center'
        });
      doc.moveDown(0.3);
    }

    doc.save();
    doc.rect(margins.left, contentStartY, availableWidth, availableHeight).clip();

    const pageBoxRects = [];
    sortedBoxes.forEach((box) => {
      const globalY = (box.position?.y ?? 0) + (boxYOffset[box.id] || 0);
      const boxH = effectiveHeightByBoxId[box.id] ?? box.size?.height ?? 20;
      const globalBottom = globalY + boxH;
      const isDataTable = box.type === 'table' && box.tableConfig?.dynamicRowsFromData && Array.isArray(box.tableConfig?.columnKeys);
      if (isDataTable) {
        const columnKeys = box.tableConfig?.columnKeys;
        const rowCount = getDataTableRowCount(dataObj, columnKeys);
        const range = getDataTableRowRangeForPage(box, pageIndex, rowCount, editorPageHeightPx - EDITOR_TITLE_AREA_PX);
        const showAttachedListMessage = pageIndex === 0 && rowCount > DATA_TABLE_ATTACHED_LIST_THRESHOLD;
        /* On page 0 always draw table (at least header); on later pages skip only when no rows on this page */
        if (range.endRow <= range.startRow && !showAttachedListMessage && pageIndex > 0) return;
      } else {
        if (boxH <= 0) return;
        if (globalBottom <= pageTopEditor || globalY >= pageBottomEditor) return;
      }
      const localYEditor = pageIndex === 0 ? Math.max(0, globalY - EDITOR_TITLE_AREA_PX) : globalY - pageTopEditor;
      const clipBottomEditor = pageBottomEditor - globalY;
      let rx = ((box.position?.x || 0) * pxToPt) + margins.left;
      let ry = (localYEditor * pxToPt) + contentStartY;
      let rw = Math.max(10, (box.size?.width || 100) * pxToPt);
      let rh = Math.max(10, (box.size?.height || 20) * pxToPt);
      if (boxH !== (box.size?.height ?? 20)) rh = Math.max(10, Math.min(boxH, clipBottomEditor) * pxToPt);
      if (rx + rw > pageWidth - margins.right) rw = Math.max(10, pageWidth - margins.right - rx);
      if (rx < margins.left) { const overflow = margins.left - rx; rx = margins.left; rw = Math.max(10, rw - overflow); }
      if (ry + rh > pageHeight - margins.bottom) rh = Math.max(10, pageHeight - margins.bottom - ry);
      if (ry < contentStartY) { const overflow = contentStartY - ry; ry = contentStartY; rh = Math.max(10, rh - overflow); }
      rw = Math.min(rw, availableWidth);
      rh = Math.min(rh, availableHeight - (ry - contentStartY));
      if (box.type !== 'table' || !box.tableConfig?.dynamicRowsFromData) {
        pageBoxRects.push({ boxId: box.id, x: Math.round(rx * 10) / 10, y: Math.round(ry * 10) / 10, width: Math.round(rw * 10) / 10, height: Math.round(rh * 10) / 10 });
      }
    });

    sortedBoxes.forEach((box) => {
      try {
        const globalY = (box.position?.y ?? 0) + (boxYOffset[box.id] || 0);
        const boxH = effectiveHeightByBoxId[box.id] ?? box.size?.height ?? 20;
        const globalBottom = globalY + boxH;

        const isDataTable = box.type === 'table' && box.tableConfig?.dynamicRowsFromData && Array.isArray(box.tableConfig?.columnKeys);
        if (isDataTable) {
          const columnKeys = box.tableConfig.columnKeys;
          const rowCount = getDataTableRowCount(dataObj, columnKeys);
          const range = getDataTableRowRangeForPage(box, pageIndex, rowCount, editorPageHeightPx - EDITOR_TITLE_AREA_PX);
          const showAttachedListMessage = pageIndex === 0 && rowCount > DATA_TABLE_ATTACHED_LIST_THRESHOLD;
          /* On page 0 always draw table (at least header); on later pages skip only when no rows on this page */
          if (range.endRow <= range.startRow && !showAttachedListMessage && pageIndex > 0) return;
        } else {
          if (boxH <= 0) return;
          if (globalBottom <= pageTopEditor || globalY >= pageBottomEditor) return;
        }

        const localYEditor = pageIndex === 0 ? Math.max(0, globalY - EDITOR_TITLE_AREA_PX) : globalY - pageTopEditor;
        const clipBottomEditor = pageBottomEditor - globalY;

        let x = ((box.position?.x || 0) * pxToPt) + margins.left;
        let y = (localYEditor * pxToPt) + contentStartY;
        let width = Math.max(10, (box.size?.width || 100) * pxToPt);
        let height = Math.max(10, (box.size?.height || 20) * pxToPt);
        const isDataTableBox = box.type === 'table' && box.tableConfig?.dynamicRowsFromData && Array.isArray(box.tableConfig?.columnKeys);
        /* For data tables: use exactly the sidebar height (e.g. 450px) so the table box fills that space; only cap if it would go off the page */
        if (isDataTableBox) {
          const designHeightPx = Math.max(20, Number(box.size?.height) || 20);
          height = designHeightPx * pxToPt;
        } else {
          if (boxH !== (box.size?.height ?? 20)) height = Math.max(10, Math.min(boxH, clipBottomEditor) * pxToPt);
        }
        if (x + width > pageWidth - margins.right) width = Math.max(10, pageWidth - margins.right - x);
        if (x < margins.left) { const overflow = margins.left - x; x = margins.left; width = Math.max(10, width - overflow); }
        if (y + height > pageHeight - margins.bottom) height = Math.max(10, pageHeight - margins.bottom - y);
        if (y < contentStartY) { const overflow = contentStartY - y; y = contentStartY; height = Math.max(10, height - overflow); }
        width = Math.min(width, availableWidth);
        height = Math.min(height, availableHeight - (y - contentStartY));

        if (isDataTableBox) {
          const columnKeys = box.tableConfig.columnKeys;
          const headers = box.tableConfig.headers || columnKeys.map(k => k.replace(/_/g, ' '));
          const rowCount = getDataTableRowCount(dataObj, columnKeys);
          const colCount = columnKeys.length;
          const fontSize = Math.max(8, Math.min(72, Number(box.properties?.fontSize) || 11));
          const rowHeightPt = fontSize + 6;
          const headerHeightPt = rowHeightPt;
          const colWidths = (box.tableConfig.columnWidths && Array.isArray(box.tableConfig.columnWidths))
            ? box.tableConfig.columnWidths.map(p => (p / 100) * width)
            : Array(colCount).fill(width / colCount);

          const cached = dynamicTableCache.get(box.id);
          const range = cached && cached.ranges[pageIndex]
            ? cached.ranges[pageIndex]
            : getDataTableRowRangeForPage(box, pageIndex, rowCount, editorPageHeightPx - EDITOR_TITLE_AREA_PX);
          const startRow = range.startRow;
          let drawnOnThisPage = range.endRow - range.startRow;
          const showAttachedListMessage = pageIndex === 0 && rowCount > DATA_TABLE_ATTACHED_LIST_THRESHOLD && drawnOnThisPage === 0;
          const rowHeightsPt = cached ? cached.rowHeightsPt : null;

          const tableStartY = pageIndex === 0 ? y : contentStartY;

          doc.fontSize(fontSize).font('Helvetica');
          let tableY = tableStartY;
          doc.save();
          doc.lineWidth(0.5).strokeColor(0, 0, 0);
          let colX = x;
          for (let ci = 0; ci < colCount; ci++) {
            const cw = colWidths[ci] || width / colCount;
            doc.rect(colX, tableY, cw, headerHeightPt).stroke();
            doc.save();
            doc.rect(colX, tableY, cw, headerHeightPt).clip();
            doc.fillColor(0, 0, 0).text(String(headers[ci] || ''), colX + 3, tableY + 3, { width: Math.max(1, cw - 6), align: 'left' });
            doc.restore();
            colX += cw;
          }
          tableY += headerHeightPt;
          if (showAttachedListMessage) {
            const messageRowHeightPt = DATA_TABLE_ATTACHED_LIST_GAP_PX * pxToPt;
            doc.fillColor(0.27, 0.27, 0.27).text('Find the details of elements in attached list.', x + 3, tableY + messageRowHeightPt - 14, { width: width - 6, align: 'center' });
            tableY += messageRowHeightPt;
          } else {
            const minRowPt = rowHeightPt;
            const maxRowPt = rowHeightPt * 25;
            for (let ri = startRow; ri < startRow + drawnOnThisPage; ri++) {
              const rowMeta = getDataTableRowMeta(dataObj, columnKeys, ri + 1);
              const useBold = rowMeta?.isContainerHeading;
              doc.font(useBold ? 'Helvetica-Bold' : getPdfFontFamily(box));
              let rowH = rowHeightsPt && rowHeightsPt[ri] != null ? rowHeightsPt[ri] : minRowPt;
              const cellTexts = [];
              if (rowHeightsPt == null || rowHeightsPt[ri] == null) {
                colX = x;
                for (let ci = 0; ci < colCount; ci++) {
                  const cw = colWidths[ci] || width / colCount;
                  const cellText = getDataTableCell(dataObj, columnKeys, ri + 1, ci);
                  cellTexts.push(cellText);
                  const cellH = doc.heightOfString(cellText || '', { width: Math.max(1, cw - 6) });
                  rowH = Math.max(rowH, Math.min(maxRowPt, cellH + 6));
                }
              } else {
                for (let ci = 0; ci < colCount; ci++) cellTexts.push(getDataTableCell(dataObj, columnKeys, ri + 1, ci));
              }
              colX = x;
              for (let ci = 0; ci < colCount; ci++) {
                const cw = colWidths[ci] || width / colCount;
                doc.save();
                doc.rect(colX, tableY, cw, rowH).clip();
                doc.fillColor(0, 0, 0).text(cellTexts[ci], colX + 3, tableY + 3, { width: Math.max(1, cw - 6), align: 'left' });
                doc.restore();
                colX += cw;
              }
              tableY += rowH;
            }
          }
          let outerTableHeight = tableY - tableStartY;
          /* Page 0: use design height so border extends full box. Continuation pages: border ends at last row only */
          if (pageIndex === 0) {
            const designHeightPt = designHeightPx * pxToPt;
            const maxRectHeight = Math.max(0, pageHeight - margins.bottom - tableStartY);
            outerTableHeight = Math.max(outerTableHeight, Math.min(designHeightPt, maxRectHeight));
          }
          doc.rect(x, tableStartY, width, outerTableHeight).stroke();
          doc.restore();
          return;
        }

        const padding = 4;
        const contentPosition = box.properties?.contentPosition || { x: 0, y: 0 };
        const contentXPercent = Math.max(0, Math.min(100, contentPosition.x || 0));
        const contentYPercent = Math.max(0, Math.min(100, contentPosition.y || 0));
        let availableContentWidth = width - (padding * 2);
        let availableContentHeight = height - (padding * 2);
        let textX = x + padding + (availableContentWidth * contentXPercent / 100);
        let textY = y + padding + (availableContentHeight * contentYPercent / 100);
        let textWidth = availableContentWidth;
        let textHeight = availableContentHeight;

        const rawSize = box.properties?.fontSize;
        const fontSize = Math.max(8, Math.min(72, Number(rawSize) || 12));
        const useSeparateSizes = box.properties?.labelFontSize != null || box.properties?.valueFontSize != null;
        const labelSz = Math.max(8, Math.min(72, Number(box.properties?.labelFontSize ?? rawSize) || 12));
        const valueSz = Math.max(8, Math.min(72, Number(box.properties?.valueFontSize ?? rawSize) || 12));
        const safeFontFamily = getPdfFontFamily(box);
        doc.font(safeFontFamily).fontSize(fontSize);

        const fontColor = box.properties?.fontColor || '#000000';
        let r = 0, g = 0, b = 0;
        if (fontColor.startsWith('#')) {
          const hex = fontColor.slice(1);
          if (hex.length === 6) {
            r = parseInt(hex.slice(0, 2), 16) / 255;
            g = parseInt(hex.slice(2, 4), 16) / 255;
            b = parseInt(hex.slice(4, 6), 16) / 255;
          }
        }
        doc.fillColor(r, g, b);

        const dataWithPages = { ...dataObj, pages: `${pageIndex + 1} of ${numPages}` };
        const getDisplayLabel = (b) => {
          const raw = b.labelName || (b.fieldName ? String(b.fieldName).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '');
          if (raw && String(raw).trim().endsWith('...') && b.fieldName) return String(b.fieldName).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
          return raw;
        };
        let content = '';
        let labelPart = '';
        let valuePart = '';
        const displayLabel = getDisplayLabel(box);
        const labelOnly = !!box.properties?.labelOnly;
        const valueOnly = !!box.properties?.valueOnly;
        const emptyBox = !!box.properties?.emptyBox;
        const value = box.content || `{{${box.fieldName || 'field'}}}`;
        const valueStr = replacePlaceholders(value, dataWithPages);
        if (emptyBox) {
          content = '';
        } else if (valueOnly) {
          content = valueStr != null ? String(valueStr) : '';
          if (useSeparateSizes) valuePart = content;
        } else if (labelOnly && displayLabel) {
          content = displayLabel;
          if (useSeparateSizes) labelPart = displayLabel;
        } else if (displayLabel) {
          content = valueStr && String(valueStr).trim() ? `${displayLabel}: ${valueStr}` : `${displayLabel}:`;
          if (useSeparateSizes) {
            labelPart = valueStr && String(valueStr).trim() ? `${displayLabel}: ` : `${displayLabel}:`;
            valuePart = valueStr && String(valueStr).trim() ? String(valueStr) : '';
          }
        } else if (box.content) {
          content = replacePlaceholders(box.content || '', dataWithPages);
          if (useSeparateSizes) valuePart = content;
        } else if (box.fieldName) {
          content = replacePlaceholders(`{{${box.fieldName}}}`, dataWithPages);
          if (useSeparateSizes) valuePart = content;
        }

        const bgColor = box.properties?.backgroundColor;
        if (bgColor && bgColor !== 'transparent' && bgColor !== '') {
          try {
            const bgRGB = parseColor(bgColor);
            doc.save();
            doc.fillColor(bgRGB.r, bgRGB.g, bgRGB.b);
            doc.rect(x, y, width, height).fill();
            doc.restore();
          } catch (e) { /* ignore */ }
        }

        if (box.properties?.border !== false) {
          const otherRects = pageBoxRects.filter((r) => String(r.boxId) !== String(box.id));
          const xr = Math.round(x * 10) / 10, yr = Math.round(y * 10) / 10, wr = Math.round(width * 10) / 10, hr = Math.round(height * 10) / 10;
          const edges = getPdfBoxEdgeVisibility(box.id, xr, yr, wr, hr, otherRects);
          doc.save();
          doc.lineWidth(0.5);
          doc.strokeColor(0, 0, 0);
          if (edges.drawTop) doc.moveTo(x, y).lineTo(x + width, y).stroke();
          if (edges.drawRight) doc.moveTo(x + width, y).lineTo(x + width, y + height).stroke();
          if (edges.drawBottom) doc.moveTo(x + width, y + height).lineTo(x, y + height).stroke();
          if (edges.drawLeft) doc.moveTo(x, y + height).lineTo(x, y).stroke();
          doc.restore();
        }

        if (content && content.trim()) {
          doc.save();
          const textWidthSafe = Math.max(1, textWidth);
          const lineGapPt = 1;
          const alignment = box.properties?.alignment || 'left';
          const textOpts = { width: textWidthSafe, align: alignment, lineGap: lineGapPt, ellipsis: false };
          doc.font(safeFontFamily).fillColor(r, g, b);
          if (useSeparateSizes && (labelPart || valuePart)) {
            if (labelPart && valuePart) {
              doc.fontSize(labelSz).text(labelPart, textX, textY, { ...textOpts, continued: true });
              doc.fontSize(valueSz).text(valuePart, textOpts);
            } else if (labelPart) {
              doc.fontSize(labelSz).text(labelPart, textX, textY, textOpts);
            } else {
              doc.fontSize(valueSz).text(valuePart, textX, textY, textOpts);
            }
          } else {
            doc.fontSize(fontSize).text(content, textX, textY, textOpts);
          }
          doc.restore();
        }
      } catch (boxError) {
        console.error(`Error rendering box ${box.id}:`, boxError);
      }
    });
    if (pageIndex === 0) {
      const dataTables = sortedBoxes.filter((b) => b?.tableConfig?.dynamicRowsFromData && Array.isArray(b.tableConfig?.columnKeys));
      if (dataTables.length > 0) {
        const firstDataTable = dataTables.reduce((min, b) => {
          const gy = (b.position?.y ?? 0) + (boxYOffset[b.id] || 0);
          const minGy = (min.position?.y ?? 0) + (boxYOffset[min.id] || 0);
          return gy < minGy ? b : min;
        });
        const rowCount = getDataTableRowCount(dataObj, firstDataTable.tableConfig?.columnKeys || []);
        if (rowCount <= DATA_TABLE_ATTACHED_LIST_THRESHOLD) {
          /* spacer already drawn in table branch */
        }
      }
    }
    doc.restore();
  }

  doc.end();

  await new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
    doc.on('error', reject);
  });

  const fileSize = fs.statSync(filepath).size;
  return { filename, filepath, fileSize };
  } catch (err) {
    if (stream && typeof stream.destroy === 'function') try { stream.destroy(); } catch (_) {}
    const msg = err && (err.message || String(err));
    throw new Error(`PDF generation failed: ${msg}`);
  }
};

module.exports = {
  generatePdf,
  replacePlaceholders,
  parseColor,
  buildMultiPageLayout,
  getDataTableRowCount,
  getDataTableCell,
  getDataTableRowRangeForPage,
  getEditorPageHeight,
  EDITOR_PAGE_DIMENSIONS,
  EDITOR_TITLE_AREA_PX,
  DATA_TABLE_HEADER_ROW_PX,
  DATA_TABLE_ROW_HEIGHT_PX,
  DATA_TABLE_ATTACHED_LIST_THRESHOLD,
  GAP_BETWEEN_TABLE_AND_NEXT_FIELD_PX,
};
