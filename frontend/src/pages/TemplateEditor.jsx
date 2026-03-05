import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { createPortal } from 'react-dom';
import templateService, { standardizedTemplateService, templateDesignService } from '../services/templateService';
import pdfService from '../services/pdfService';
import csvService from '../services/csvService';
import { saveToWaka } from '../services/wakaTemplateService';
import { boxesToLayoutOnly } from '../utils/designUtils';
import logger from '../utils/logger';
import DesignThumbnail from '../components/DesignThumbnail';
import { useToast } from '../contexts/ToastContext';
import { useWakaEntry } from '../contexts/WakaEntryContext';
import './TemplateEditor.css';

const PAGE_SIZES = ['A4', 'A3', 'A5'];
/** Height of the document title block (title + black line + margin). Content boxes start below this. */
const TITLE_AREA_HEIGHT = 90;
/** Font size is stored in points (pt); convert to px for screen so editor matches PDF. 1pt = 96/72 px */
const ptToPx = (pt) => Math.round((Number(pt) || 12) * (96 / 72));
/** Vertical gap between rows when compacting CSV-imported layout (0 = tightly packed, no gaps). */
const ROW_GAP = 0;
/** Max vertical distance to consider two boxes in the same row when compacting. */
const ROW_GROUP_THRESHOLD = 10;
/** Gap between page strips in multi-page preview. */
const PAGE_GAP = 16;
/** Padding on all four sides of each page (export and editor). */
const PAGE_PADDING_PX = 36;
/** Gap between pages in exported HTML (and print). */
const PAGE_GAP_BETWEEN_PX = 32;
const pageSizeDimensions = {
  A4: { portrait: { width: 794, height: 1123 }, landscape: { width: 1123, height: 794 } },
  A3: { portrait: { width: 1123, height: 1587 }, landscape: { width: 1587, height: 1123 } },
  A5: { portrait: { width: 559, height: 794 }, landscape: { width: 794, height: 559 } },
};

const sortKvByKey = (a, b) => {
  const ak = String(a?.key ?? '').trim().toLowerCase();
  const bk = String(b?.key ?? '').trim().toLowerCase();
  if (!ak && !bk) return 0;
  if (!ak) return 1;
  if (!bk) return -1;
  return ak.localeCompare(bk);
};

/**
 * Compacts boxes vertically so rows sit one under the other with minimal gap (no big spaces).
 * Groups boxes by similar Y into rows, then stacks rows with ROW_GAP.
 * @param {Array<{ position: { x, y }, size: { width, height }, ... }>} boxes
 * @param {number} startY - First row starts at this Y (e.g. TITLE_AREA_HEIGHT)
 * @returns {Array} boxes with updated position.y
 */
function compactVerticalLayout(boxes, startY) {
  if (!boxes.length) return boxes;
  const sorted = [...boxes].sort((a, b) => (a.position?.y ?? 0) - (b.position?.y ?? 0));
  const rows = [];
  let row = [sorted[0]];
  let rowMaxBottom = (sorted[0].position?.y ?? 0) + (sorted[0].size?.height ?? 0);
  for (let i = 1; i < sorted.length; i++) {
    const b = sorted[i];
    const by = b.position?.y ?? 0;
    if (by <= rowMaxBottom + ROW_GROUP_THRESHOLD) {
      row.push(b);
      rowMaxBottom = Math.max(rowMaxBottom, by + (b.size?.height ?? 0));
    } else {
      rows.push(row);
      row = [b];
      rowMaxBottom = by + (b.size?.height ?? 0);
    }
  }
  if (row.length) rows.push(row);
  let currentY = startY;
  const out = [];
  for (const r of rows) {
    const minY = Math.min(...r.map((b) => b.position?.y ?? 0));
    const rowHeight = Math.max(...r.map((b) => (b.position?.y ?? 0) + (b.size?.height ?? 0))) - minY;
    for (const b of r) {
      const relY = (b.position?.y ?? 0) - minY;
      out.push({
        ...b,
        position: { ...b.position, x: b.position?.x ?? 0, y: currentY + relY },
      });
    }
    currentY += rowHeight + ROW_GAP;
  }
  return out;
}

/**
 * Transform box positions/sizes and optional font size when canvas dimensions change
 * (page size and/or orientation). Uses proportional scaling and clamps to new canvas.
 */
function transformBoxesForNewCanvas(boxes, oldWidth, oldHeight, newWidth, newHeight) {
  if (!boxes.length || oldWidth <= 0 || oldHeight <= 0) return boxes;
  const scaleX = newWidth / oldWidth;
  const scaleY = newHeight / oldHeight;
  const scaleFont = Math.sqrt(scaleX * scaleY);
  const minSize = 16;
  const minFont = 6;
  const maxFont = 72;
  return boxes.map((b) => {
    const x = Math.round((b.position?.x ?? 0) * scaleX);
    const y = Math.round((b.position?.y ?? 0) * scaleY);
    let w = Math.round((b.size?.width ?? 100) * scaleX);
    let h = Math.round((b.size?.height ?? 20) * scaleY);
    w = Math.max(minSize, Math.min(newWidth - x, w));
    h = Math.max(minSize, Math.min(newHeight - y, h));
    const posX = Math.max(0, Math.min(newWidth - w, x));
    const posY = Math.max(0, Math.min(newHeight - h, y));
    const props = b.properties || {};
    const oldFont = Number(props.fontSize) || 12;
    const newFont = Math.round(Math.max(minFont, Math.min(maxFont, oldFont * scaleFont)));
    const next = {
      ...b,
      position: { x: posX, y: posY },
      size: { width: w, height: h },
      properties: { ...props, fontSize: newFont },
    };
    if (b.type === 'table' && b.tableConfig?.columnWidths && Array.isArray(b.tableConfig.columnWidths)) {
      next.tableConfig = { ...b.tableConfig };
    }
    return next;
  });
}

/** Extract all {{key}} placeholder names from a content string. */
function extractPlaceholderKeys(content) {
  if (!content || typeof content !== 'string') return [];
  const keys = [];
  const re = /\{\{\s*([^}\s]+)\s*\}\}/g;
  let m;
  while ((m = re.exec(content)) !== null) keys.push(m[1].trim());
  return keys;
}

/** Replace {{key}} placeholders in content with values from data (for demo/preview). Missing keys render as empty, not as literal {{key}}. */
function replacePlaceholdersInContent(content, data) {
  if (!content || typeof content !== 'string') return '';
  const dataObj = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  return content.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (match, key) => {
    const k = String(key).trim();
    const val = dataObj[k];
    return (val !== undefined && val !== null) ? String(val) : '';
  });
}

/** Resolved value for a text box (placeholder replaced). Used to hide key-value boxes when value is empty. */
function getResolvedValueForBox(box, data) {
  if (!box || box.type === 'table' || box.type === 'logo') return null;
  const raw = box.content || `{{${box.fieldName || 'field'}}}`;
  return data && typeof data === 'object' && !Array.isArray(data) ? replacePlaceholdersInContent(raw, data) : null;
}

/** True when box is a text box and its resolved value is empty (show label only, hide {{}} placeholder). */
function isBoxValueEmpty(box, data) {
  const resolved = getResolvedValueForBox(box, data);
  return resolved !== null && String(resolved).trim() === '';
}

/** Flatten containers into rows: [{ container, item }, ...] in order. Returns [] if no containers. */
function getFlattenedContainerRows(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.containers)) return [];
  const rows = [];
  for (const container of data.containers) {
    const items = container?.items;
    if (!Array.isArray(items)) continue;
    for (const item of items) rows.push({ container, item });
  }
  return rows;
}

/** Container-based table: flat list of rows. Each row is { type: 'container'|'item', container, item? }. Container = heading row (bold), then item rows below it. */
function getContainerTableRowsFlat(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
  const containersList = Array.isArray(data.containers) ? data.containers : (Array.isArray(data.container) ? data.container : []);
  if (containersList.length === 0) return [];
  const flat = [];
  for (const container of containersList) {
    flat.push({ type: 'container', container, item: null });
    const items = Array.isArray(container?.items) ? container.items : [];
    for (const item of items) flat.push({ type: 'item', container, item });
  }
  return flat;
}

/** Get row count. When data.containers exists, count = container heading rows + all item rows; else indexed keys. */
function getDataTableRowCount(data, columnKeys) {
  try {
    if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(columnKeys) || !columnKeys.length) return 0;
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
    if (maxN >= 2 && columnKeys.length) {
      const hasThird = columnKeys.some((k) => data[`${String(k).trim()}_3`] !== undefined);
      if (hasThird) maxN = Math.max(maxN, 3);
    }
    return Math.min(500, Math.max(0, maxN));
  } catch (_) {
    return 0;
  }
}

/** Cell value for a container heading row: only first column has "Container N, TYPE", others empty. */
function getDataTableCellContainerHeading(container, baseKey, colIndex) {
  if (colIndex !== 0) return '';
  const cn = container?.container_number ?? '';
  const ct = container?.container_type ?? '';
  return (cn && ct) ? `${cn}, ${ct}` : cn || ct || '';
}

/** Cell value for an item row under a container. */
function getDataTableCellContainerItem(item, baseKey) {
  const b = String(baseKey || '').trim().toLowerCase();
  if (b === 'marks_and_numbers') return item?.marks_and_numbers != null ? String(item.marks_and_numbers) : '';
  if (b === 'kind_no_of_packages' || b === 'kind_&_no_of_packages') return item?.packages != null ? String(item.packages) : '';
  if (b === 'description_of_goods') return item?.description ?? item?.commodity ?? '';
  if (b === 'gross_weight_kg' || b === 'gross_weight_(kg)') return item?.weight != null ? String(item.weight) : '';
  if (b === 'measurements_m' || b === 'measurements_m³' || b === 'measurements_(m³)') return item?.volume != null ? String(item.volume) : '';
  return '';
}

/** Returns { isContainerHeading: true } for container heading rows when using container data; else undefined. */
function getDataTableRowMeta(data, columnKeys, rowIndex1Based) {
  const flat = getContainerTableRowsFlat(data);
  if (flat.length === 0) return undefined;
  const row = flat[rowIndex1Based - 1];
  return row && row.type === 'container' ? { isContainerHeading: true } : undefined;
}

/** Get cell value for data-driven table row/col (1-based row index). When data.containers exists, uses container heading + item rows; else indexed keys. */
function getDataTableCell(data, columnKeys, rowIndex1Based, colIndex) {
  if (!data || !columnKeys || !columnKeys[colIndex]) return '';
  const base = String(columnKeys[colIndex] || '').trim();
  const containerFlat = getContainerTableRowsFlat(data);
  if (containerFlat.length > 0) {
    const row = containerFlat[rowIndex1Based - 1];
    if (row) {
      if (row.type === 'container') return getDataTableCellContainerHeading(row.container, base, colIndex);
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

/** Effective height in px for a data table box (header + data rows). Row height must fit cell padding (4px each side) so 3 rows are not clipped. */
const DATA_TABLE_HEADER_ROW_PX = 28;
const DATA_TABLE_ROW_HEIGHT_PX = 30;
/** Full-width boxed area (px) between first three table rows and remaining content; 120px height, full width. */
const DATA_TABLE_SPACER_PX = 120;
/** Height (px) of the empty gap inside the table when rowCount <= 3; full width. */
const EMPTY_BOX_BELOW_TABLE_PX = 90;
/** Gap (px) between table bottom and next field (e.g. Total This Page); 2px only. */
const GAP_BETWEEN_TABLE_AND_NEXT_FIELD_PX = 8;
/** Gap (px) between fields above and the table top; 2px. */
const GAP_ABOVE_TABLE_PX = 2;
/** When item count exceeds this, first page shows only header + "Find details in attached list"; all rows go on attachment pages. */
const DATA_TABLE_ATTACHED_LIST_THRESHOLD = 3;
/** Height (px) of the gap inside the table when in attached list mode (message row uses this). */
const DATA_TABLE_ATTACHED_LIST_GAP_PX = 100;

function getDataTableEffectiveHeight(box, data) {
  try {
    if (!box?.tableConfig || !Array.isArray(box.tableConfig.columnKeys)) return null;
    const rowCount = getDataTableRowCount(data || {}, box.tableConfig.columnKeys);
    const h = DATA_TABLE_HEADER_ROW_PX + Math.max(0, rowCount) * DATA_TABLE_ROW_HEIGHT_PX;
    return Number.isFinite(h) ? h : null;
  } catch (_) {
    return null;
  }
}

/** Height of only the first segment (first N rows on page 1). When rowCount > threshold, page 1 shows header + message; use at least design height so first page table matches sidebar (e.g. 450px). */
function getDataTableFirstSegmentHeight(box, data) {
  try {
    if (!box?.tableConfig || !Array.isArray(box.tableConfig.columnKeys)) return null;
    const rowCount = getDataTableRowCount(data || {}, box.tableConfig.columnKeys);
    const rowsOnFirst = Math.max(3, Math.max(1, Number(box?.tableConfig?.rowsOnFirstPage) || 3));
    const designHeight = Math.max(20, Number(box?.size?.height) || 20);
    const useAttachedListMode = rowCount > DATA_TABLE_ATTACHED_LIST_THRESHOLD;
    if (useAttachedListMode) return Math.max(DATA_TABLE_HEADER_ROW_PX + DATA_TABLE_ATTACHED_LIST_GAP_PX, designHeight);
    const rowsToShow = Math.min(rowsOnFirst, Math.max(0, rowCount));
    const h = Math.max(DATA_TABLE_HEADER_ROW_PX + rowsToShow * DATA_TABLE_ROW_HEIGHT_PX, designHeight);
    return Number.isFinite(h) ? h : null;
  } catch (_) {
    return null;
  }
}

/** Total height of a data table when paginated. When rowCount > threshold, first page = header + 1 row; all data rows on attachment pages. */
function getDataTablePaginatedTotalHeight(box, data, pageHeightPx, tableY = 0) {
  try {
    if (!box?.tableConfig || !Array.isArray(box.tableConfig.columnKeys)) return null;
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
    return Number.isFinite(totalHeight) ? totalHeight : null;
  } catch (_) {
    return null;
  }
}

/** Get { startRow, endRow } for a data table on a given "table page" (0 = first page of table, 1 = second, ...).
 * When rowCount <= ATTACHED_LIST_THRESHOLD: page 0 shows those rows; page 1+ shows rest.
 * When rowCount > ATTACHED_LIST_THRESHOLD: page 0 shows no data rows (header + "Find details in attached list" only); all rows go on page 1, 2, ... */
function getDataTableRowRangeForPage(box, tablePageIndex, rowCount, pageHeightPx) {
  const rowsOnFirst = Math.max(3, Math.max(1, Number(box?.tableConfig?.rowsOnFirstPage) || 3));
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
    const startRow = Math.max(afterFirst, afterFirst + (tablePage - 1) * rowsOnOther);
    const endRow = Math.min(startRow + rowsOnOther, rowCount);
    return { startRow: Math.min(startRow, rowCount), endRow: Math.max(endRow, startRow) };
  }
  const rowsPerPage = Math.max(1, Math.floor((pageHeightPx - DATA_TABLE_HEADER_ROW_PX) / DATA_TABLE_ROW_HEIGHT_PX));
  const startRow = Math.max(afterFirst, afterFirst + (tablePage - 1) * rowsPerPage);
  const endRow = Math.min(startRow + rowsPerPage, rowCount);
  return { startRow: Math.min(startRow, rowCount), endRow: Math.max(endRow, startRow) };
}

/** Get all boxes that are on the same row as the given box. Uses row alignment by Y (top within threshold) so a tall box does not pull in the whole page. Sorted by x. */
function getBoxesInSameRow(box, allBoxes, rowAlignmentThreshold = 25) {
  if (!box || !Array.isArray(allBoxes)) return [];
  const boxTop = box.position?.y ?? 0;
  const row = allBoxes.filter((b) => {
    if (b.id === box.id) return true;
    const top = b.position?.y ?? 0;
    return Math.abs(top - boxTop) <= rowAlignmentThreshold;
  });
  return row.sort((a, b) => (a.position?.x ?? 0) - (b.position?.x ?? 0));
}

const ADJACENT_EPS = 8; // px tolerance for "touching" edges so adjacent boxes share one line (no gap + double border)

/**
 * Return which edges of a box should draw a border so adjacent boxes share one line (no double/thick).
 * @param {Object} box - current box
 * @param {Array} allBoxes - all boxes to check (use same-page boxes in paginated view)
 * @param {number} eps - max gap (px) to still count as adjacent
 * @param {Object} layout - optional { boxYOffset, effectiveHeightByBoxId }
 * @param {Object} renderedRects - optional { [boxId]: { top, bottom, left, right } } so edge visibility uses exact rendered coords
 */
function getBoxEdgeVisibility(box, allBoxes, eps = ADJACENT_EPS, layout = null, renderedRects = null) {
  const idBox = String(box.id);
  const getTop = (b) => (renderedRects && renderedRects[b.id]) ? renderedRects[b.id].top : (b.position?.y ?? 0) + (layout?.boxYOffset?.[b.id] ?? 0);
  const getHeight = (b) => (layout?.effectiveHeightByBoxId?.[b.id] != null ? layout.effectiveHeightByBoxId[b.id] : (b.size?.height ?? 20));
  const getBottom = (b) => (renderedRects && renderedRects[b.id]) ? renderedRects[b.id].bottom : getTop(b) + getHeight(b);
  const getLeft = (b) => (renderedRects && renderedRects[b.id]) ? renderedRects[b.id].left : (b.position?.x ?? 0);
  const getRight = (b) => (renderedRects && renderedRects[b.id]) ? renderedRects[b.id].right : getLeft(b) + (b.size?.width ?? 0);
  const left = getLeft(box);
  const right = getRight(box);
  const top = getTop(box);
  const bottom = getBottom(box);
  const vertOverlap = (aTop, aBottom, bTop, bBottom) => aTop < bBottom && bTop < aBottom;
  const horizOverlap = (a, b) => {
    const aLeft = getLeft(a), aRight = getRight(a);
    const bLeft = getLeft(b), bRight = getRight(b);
    return aLeft < bRight && bLeft < aRight;
  };
  const isLeftNeighbor = (b) => String(b.id) !== idBox && Math.abs(getRight(b) - left) <= eps && vertOverlap(top, bottom, getTop(b), getBottom(b));
  const isRightNeighbor = (b) => String(b.id) !== idBox && Math.abs(getLeft(b) - right) <= eps && vertOverlap(top, bottom, getTop(b), getBottom(b));
  const isTopNeighbor = (b) => String(b.id) !== idBox && Math.abs(getBottom(b) - top) <= eps && horizOverlap(box, b);
  const isBottomNeighbor = (b) => String(b.id) !== idBox && Math.abs(getTop(b) - bottom) <= eps && horizOverlap(box, b);
  const drawLeft = !allBoxes.some((b) => isLeftNeighbor(b) && String(b.id) < idBox);
  const drawRight = !allBoxes.some((b) => isRightNeighbor(b) && String(b.id) < idBox);
  const drawTop = !allBoxes.some((b) => isTopNeighbor(b) && String(b.id) < idBox);
  const drawBottom = !allBoxes.some((b) => isBottomNeighbor(b) && String(b.id) < idBox);
  return { left: drawLeft, right: drawRight, top: drawTop, bottom: drawBottom };
}

const TemplateEditor = () => {
  const [templateCount, setTemplateCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pageSize, setPageSize] = useState('A4');
  const [orientation, setOrientation] = useState('portrait');
  const [documentTitle, setDocumentTitle] = useState('PDF Document');
  const [templateName, setTemplateName] = useState('Untitled');
  const [selectedBox, setSelectedBox] = useState(null);
  const [selectedBoxIds, setSelectedBoxIds] = useState([]);
  const setSelection = (ids) => {
    const idList = Array.isArray(ids) ? ids : (ids == null ? [] : [ids]);
    setSelectedBoxIds(idList);
    setSelectedBox(idList[0] ?? null);
  };
  const [boxes, setBoxes] = useState([]);
  const [marquee, setMarquee] = useState(null);
  const marqueeRef = useRef(null);
  marqueeRef.current = marquee;
  const [nextRank, setNextRank] = useState(1);
  const [currentTemplateId, setCurrentTemplateId] = useState(null);
  const [draggingBox, setDraggingBox] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0, startX: 0, startY: 0, boxStartX: 0, boxStartY: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [overlappingBox, setOverlappingBox] = useState(null);
  const [boxLibrary, setBoxLibrary] = useState([]);
  const [draggingFromLibrary, setDraggingFromLibrary] = useState(null);
  const [resizingBox, setResizingBox] = useState(null);
  const [resizeHandle, setResizeHandleName] = useState(null);
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0, left: 0, top: 0 });
  const [expandedSections, setExpandedSections] = useState({
    global: true,
    demoData: true,
    csvImport: false,
    pdfImport: false,
    boxLibrary: false,
    templateSettings: false,
    properties: true,
  });
  const [demoDataJson, setDemoDataJson] = useState('');
  const [demoData, setDemoData] = useState(null);
  const [demoDataParseError, setDemoDataParseError] = useState('');
  const [globalFontSize, setGlobalFontSize] = useState(10);
  const [globalFontFamily, setGlobalFontFamily] = useState('Arial');
  const [templateOutlineMode, setTemplateOutlineMode] = useState('none');
  const [canvasBackgroundImage, setCanvasBackgroundImage] = useState(null);
  const [tableMode, setTableMode] = useState('static');
  const [maxDynamicColumns, setMaxDynamicColumns] = useState(10);
  const [showTableConfig, setShowTableConfig] = useState(false);
  const [tableConfig, setTableConfig] = useState({
    rows: 3,
    columns: 3,
    headers: ['Header 1', 'Header 2', 'Header 3'],
    fieldNames: ['field1', 'field2', 'field3'],
    contentFields: ['field1', 'field2', 'field3'],
    columnWidths: [33.33, 33.33, 33.33],
  });
  const [showSaveTemplateModal, setShowSaveTemplateModal] = useState(false);
  const [saveModalTemplateName, setSaveModalTemplateName] = useState('');
  const [saveModalDocumentName, setSaveModalDocumentName] = useState('');
  const [saveModalKeyValues, setSaveModalKeyValues] = useState([]);
  const [editorMode, setEditorMode] = useState('normal');
  const [standardizedTemplatesList, setStandardizedTemplatesList] = useState([]);
  const [selectedStandardizedId, setSelectedStandardizedId] = useState(null);
  const [standardizedKeyValuePairs, setStandardizedKeyValuePairs] = useState([]);
  const [draggingStandardizedKey, setDraggingStandardizedKey] = useState(null);
  const [templateDesignsList, setTemplateDesignsList] = useState([]);
  const [selectedDesignId, setSelectedDesignId] = useState(null);
  const [showSaveDesignModal, setShowSaveDesignModal] = useState(false);
  const [saveDesignName, setSaveDesignName] = useState('');
  const [savingDesign, setSavingDesign] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showExportVariablesModal, setShowExportVariablesModal] = useState(false);
  const [exportVariablesJson, setExportVariablesJson] = useState('');
  const [lastSavedDesignSnapshot, setLastSavedDesignSnapshot] = useState(null);

  const toast = useToast();
  const { token: wakaToken } = useWakaEntry();

  const getDesignSnapshot = (boxesData, docTitle, name, pSize, orient, outlineMode, tMode, maxCols) =>
    JSON.stringify({
      boxes: boxesData !== undefined ? boxesData : boxes,
      documentTitle: docTitle !== undefined ? docTitle : documentTitle,
      templateName: name !== undefined ? name : templateName,
      pageSize: pSize !== undefined ? pSize : pageSize,
      orientation: orient !== undefined ? orient : orientation,
      templateOutlineMode: outlineMode !== undefined ? outlineMode : templateOutlineMode,
      tableMode: tMode !== undefined ? tMode : tableMode,
      maxDynamicColumns: maxCols !== undefined ? maxCols : maxDynamicColumns,
    });
  const currentDesignSnapshot = getDesignSnapshot(boxes, documentTitle, templateName, pageSize, orientation, templateOutlineMode, tableMode, maxDynamicColumns);
  const hasUnsavedChanges = Boolean(currentTemplateId && lastSavedDesignSnapshot != null && currentDesignSnapshot !== lastSavedDesignSnapshot);

  const getCanvasDimensions = () => {
    const dimensions = pageSizeDimensions[pageSize] || pageSizeDimensions.A4;
    return orientation === 'portrait' ? dimensions.portrait : dimensions.landscape;
  };

  const dataTableLayout = useMemo(() => {
    try {
      const data = demoData && typeof demoData === 'object' && !Array.isArray(demoData) ? demoData : {};
      const dims = pageSizeDimensions[pageSize] || pageSizeDimensions.A4;
      const pageHeight = Math.max(100, orientation === 'portrait' ? (dims.portrait?.height ?? 1123) : (dims.landscape?.height ?? 794));
      const effectiveHeightByBoxId = {};
      let totalExtraHeight = 0;
      boxes.forEach((box) => {
        const designHeight = Math.max(20, Number(box.size?.height) || 20);
        let effective = null;
        if (box.type === 'table' && box.tableConfig?.dynamicRowsFromData && Array.isArray(box.tableConfig.columnKeys)) {
          effective = getDataTableFirstSegmentHeight(box, data);
          if (effective != null) {
            const rowCount = getDataTableRowCount(data || {}, box.tableConfig.columnKeys);
            const rowsOnFirst = Math.max(3, Math.max(1, Number(box?.tableConfig?.rowsOnFirstPage) || 3));
            const useAttachedListMode = rowCount > DATA_TABLE_ATTACHED_LIST_THRESHOLD;
            if (!useAttachedListMode && rowCount <= rowsOnFirst) effective += EMPTY_BOX_BELOW_TABLE_PX;
            effective = Math.max(20, Math.min(8000, Math.max(Number(effective), designHeight)));
          }
        }
        const h = effective != null ? Math.max(effective, designHeight) : designHeight;
        effectiveHeightByBoxId[box.id] = h;
        if (effective != null) totalExtraHeight += Math.max(0, effective - designHeight);
      });
      const isEmptyBox = (b) => {
        const hasField = (b.fieldName && String(b.fieldName).trim()) || (b.labelName && String(b.labelName).trim());
        const hasContent = b.content && String(b.content).trim() && !/^\{\{\s*\}\}$/.test(String(b.content).trim());
        return !hasField && !hasContent && b.type !== 'table' && b.type !== 'logo';
      };
      const dataTablesForLayout = boxes.filter((b) => b.type === 'table' && b.tableConfig?.dynamicRowsFromData && Array.isArray(b.tableConfig?.columnKeys));
      dataTablesForLayout.forEach((t) => {
        const tEffective = effectiveHeightByBoxId[t.id];
        if (tEffective == null) return;
        const tTop = t.position?.y ?? 0;
        const firstSegmentBottom = tTop + tEffective;
        const rowCount = getDataTableRowCount(data || {}, t.tableConfig.columnKeys);
        const rowsOnFirst = Math.max(3, Math.max(1, Number(t?.tableConfig?.rowsOnFirstPage) || 3));
        const tableIncludesGap = rowCount <= DATA_TABLE_ATTACHED_LIST_THRESHOLD && rowCount <= rowsOnFirst;
        const spacerPx = rowCount > DATA_TABLE_ATTACHED_LIST_THRESHOLD ? GAP_BETWEEN_TABLE_AND_NEXT_FIELD_PX : (tableIncludesGap ? GAP_BETWEEN_TABLE_AND_NEXT_FIELD_PX : (EMPTY_BOX_BELOW_TABLE_PX + GAP_BETWEEN_TABLE_AND_NEXT_FIELD_PX));
        const spacerBottom = firstSegmentBottom + spacerPx;
        boxes.forEach((b) => {
          if (b.id === t.id || b.type === 'table') return;
          const bTop = b.position?.y ?? 0;
          const bH = Math.max(20, Number(b.size?.height) || 20);
          const bBottom = bTop + bH;
          const overlapsSpacer = bTop < spacerBottom && bBottom > firstSegmentBottom;
          if (spacerPx > 0 && overlapsSpacer && isEmptyBox(b)) {
            effectiveHeightByBoxId[b.id] = 0;
          }
        });
      });
      const minYBelowTable = {};
      boxes.forEach((t) => {
        if (t.type !== 'table' || !t.tableConfig?.dynamicRowsFromData || !Array.isArray(t.tableConfig?.columnKeys)) return;
        const tEffective = effectiveHeightByBoxId[t.id];
        if (tEffective == null) return;
        const tTop = t.position?.y ?? 0;
        const firstSegmentBottom = tTop + tEffective;
        let minY = Infinity;
        boxes.forEach((b) => {
          if (b.id === t.id) return;
          const bEffectiveH = effectiveHeightByBoxId[b.id] ?? Math.max(20, Number(b.size?.height) || 20);
          if (bEffectiveH <= 0) return;
          const bTop = b.position?.y ?? 0;
          const bBottom = bTop + (Math.max(20, Number(b.size?.height) || 20));
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
        const bHeight = effectiveHeightByBoxId[b.id] ?? Math.max(20, Number(b.size?.height) || 20);
        const bBottom = bTop + Math.max(0, bHeight);
        boxes.forEach((t) => {
          if (t.id === b.id) return;
          const tEffective = effectiveHeightByBoxId[t.id];
          const tDesign = Math.max(20, Number(t.size?.height) || 20);
          const tTop = t.position?.y ?? 0;
          const isDataTable = t.type === 'table' && t.tableConfig?.dynamicRowsFromData && Array.isArray(t.tableConfig?.columnKeys);
          if (isDataTable && tEffective != null) {
            const firstSegmentBottom = tTop + tEffective;
            const rowCount = getDataTableRowCount(data || {}, t.tableConfig.columnKeys);
            const rowsOnFirst = Math.max(3, Math.max(1, Number(t?.tableConfig?.rowsOnFirstPage) || 3));
            const tableIncludesGap = rowCount <= DATA_TABLE_ATTACHED_LIST_THRESHOLD && rowCount <= rowsOnFirst;
            const spacerPx = rowCount > DATA_TABLE_ATTACHED_LIST_THRESHOLD ? GAP_BETWEEN_TABLE_AND_NEXT_FIELD_PX : (tableIncludesGap ? GAP_BETWEEN_TABLE_AND_NEXT_FIELD_PX : (EMPTY_BOX_BELOW_TABLE_PX + GAP_BETWEEN_TABLE_AND_NEXT_FIELD_PX));
            const spacerBottom = firstSegmentBottom + spacerPx;
            const minY = minYBelowTable[t.id];
            if (bTop >= firstSegmentBottom) {
              offset += minY != null ? spacerBottom - minY : (tEffective + spacerPx) - tDesign;
            } else if (bBottom > firstSegmentBottom) {
              offset += Math.max(0, spacerBottom - bTop);
            } else if (bTop < firstSegmentBottom && bBottom > tTop) {
              /* Box is inside table span: push below table */
              offset += Math.max(0, spacerBottom - bTop);
            }
          } else if (tEffective != null && tEffective > tDesign && bTop >= tTop + tDesign) {
            offset += tEffective - tDesign;
          }
        });
        boxYOffset[b.id] = offset;
      });
      boxes.forEach((t) => {
        if (t.type !== 'table' || !t.tableConfig?.dynamicRowsFromData || !Array.isArray(t.tableConfig?.columnKeys)) return;
        const tTop = t.position?.y ?? 0;
        let maxBottomAbove = -Infinity;
        boxes.forEach((b) => {
          if (b.id === t.id) return;
          const bH = effectiveHeightByBoxId[b.id] ?? Math.max(20, Number(b.size?.height) || 20);
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
        pageHeight,
        ...boxes.map((b) => {
          const top = (b.position?.y ?? 0) + (boxYOffset[b.id] || 0);
          const h = effectiveHeightByBoxId[b.id] ?? Math.max(20, Number(b.size?.height) || 20);
          return top + h;
        })
      );
      boxes.forEach((box) => {
        if (box.type === 'table' && box.tableConfig?.dynamicRowsFromData && Array.isArray(box.tableConfig.columnKeys)) {
          const contentHeightPerPage = pageHeight - TITLE_AREA_HEIGHT;
          const tableTop = (box.position?.y ?? 0) + (boxYOffset[box.id] || 0);
          const firstSegmentHeight = effectiveHeightByBoxId[box.id] ?? 0;
          const rowCount = getDataTableRowCount(data || {}, box.tableConfig.columnKeys);
          const useAttachedListMode = rowCount > DATA_TABLE_ATTACHED_LIST_THRESHOLD;
          totalHeight = Math.max(totalHeight, tableTop + firstSegmentHeight);
          if (useAttachedListMode && rowCount > 0) {
            let tablePageIndex = 1;
            while (true) {
              const range = getDataTableRowRangeForPage(box, tablePageIndex, rowCount, contentHeightPerPage);
              if (range.endRow <= range.startRow) break;
              const segmentHeight = DATA_TABLE_HEADER_ROW_PX + (range.endRow - range.startRow) * DATA_TABLE_ROW_HEIGHT_PX;
              const endYOnPage = tablePageIndex * pageHeight + segmentHeight;
              totalHeight = Math.max(totalHeight, endYOnPage);
              if (range.endRow >= rowCount) break;
              tablePageIndex++;
            }
          } else {
            const fullTableHeight = getDataTablePaginatedTotalHeight(box, data, contentHeightPerPage, box.position?.y ?? 0);
            if (fullTableHeight != null) totalHeight = Math.max(totalHeight, tableTop + fullTableHeight);
          }
        }
      });
      const numPages = Math.min(100, Math.max(1, Math.ceil(totalHeight / pageHeight) || 1));
      let dataTableSpacerTop = null;
      let dataTableSpacerLeft = 0;
      let dataTableSpacerWidth = null;
      let dataTableIncludesGapOnFirstPage = false;
      const dataTables = boxes.filter((b) => b.type === 'table' && b.tableConfig?.dynamicRowsFromData && Array.isArray(b.tableConfig?.columnKeys));
      if (dataTables.length > 0) {
        const firstDataTable = dataTables.reduce((min, b) => {
          const gy = (b.position?.y ?? 0) + (boxYOffset[b.id] || 0);
          const minGy = (min.position?.y ?? 0) + (boxYOffset[min.id] || 0);
          return gy < minGy ? b : min;
        });
        const tableGlobalY = (firstDataTable.position?.y ?? 0) + (boxYOffset[firstDataTable.id] || 0);
        const firstSegH = effectiveHeightByBoxId[firstDataTable.id] ?? firstDataTable.size?.height ?? 20;
        dataTableSpacerTop = tableGlobalY + firstSegH;
        dataTableSpacerLeft = firstDataTable.position?.x ?? 0;
        dataTableSpacerWidth = firstDataTable.size?.width ?? null;
        const rowCount = getDataTableRowCount(data || {}, firstDataTable.tableConfig?.columnKeys || []);
        const rowsOnFirst = Math.max(3, Math.max(1, Number(firstDataTable?.tableConfig?.rowsOnFirstPage) || 3));
        dataTableIncludesGapOnFirstPage = rowCount <= DATA_TABLE_ATTACHED_LIST_THRESHOLD && rowCount <= rowsOnFirst;
      }
      return { effectiveHeightByBoxId, boxYOffset, totalExtraHeight: Math.max(0, totalExtraHeight), numPages, pageHeight, dataTableSpacerTop, dataTableSpacerLeft, dataTableSpacerWidth, dataTableIncludesGapOnFirstPage };
    } catch (err) {
      console.error('dataTableLayout computation error:', err);
      const dims = pageSizeDimensions[pageSize] || pageSizeDimensions.A4;
      const pageHeight = Math.max(100, orientation === 'portrait' ? (dims.portrait?.height ?? 1123) : (dims.landscape?.height ?? 794));
      const fallback = {};
      boxes.forEach((b) => {
        fallback[b.id] = b.size?.height ?? 20;
      });
      const emptyOffset = {};
      boxes.forEach((b) => { emptyOffset[b.id] = 0; });
      return { effectiveHeightByBoxId: fallback, boxYOffset: emptyOffset, totalExtraHeight: 0, numPages: 1, pageHeight, dataTableSpacerTop: null, dataTableSpacerLeft: 0, dataTableSpacerWidth: null, dataTableIncludesGapOnFirstPage: false };
    }
  }, [boxes, demoData, pageSize, orientation]);

  // Box IDs that are in the "sequence/ending" section (below table+spacer on page 1) — show only on page 1
  const sequenceSectionBoxIds = useMemo(() => {
    let spacerBottom = Infinity;
    if (dataTableLayout.dataTableSpacerTop != null) {
      const includesGap = dataTableLayout.dataTableIncludesGapOnFirstPage;
      const dataTables = boxes.filter((b) => b.type === 'table' && b.tableConfig?.dynamicRowsFromData && Array.isArray(b.tableConfig?.columnKeys));
      const firstDataTable = dataTables.length > 0 ? dataTables.reduce((min, b) => ((b.position?.y ?? 0) + (dataTableLayout.boxYOffset[b.id] || 0)) < ((min.position?.y ?? 0) + (dataTableLayout.boxYOffset[min.id] || 0)) ? b : min) : null;
      const rowCount = firstDataTable ? getDataTableRowCount(demoData && typeof demoData === 'object' && !Array.isArray(demoData) ? demoData : {}, firstDataTable.tableConfig?.columnKeys || []) : 0;
      const spacerPx = rowCount > DATA_TABLE_ATTACHED_LIST_THRESHOLD ? GAP_BETWEEN_TABLE_AND_NEXT_FIELD_PX : (includesGap ? GAP_BETWEEN_TABLE_AND_NEXT_FIELD_PX : (EMPTY_BOX_BELOW_TABLE_PX + GAP_BETWEEN_TABLE_AND_NEXT_FIELD_PX));
      spacerBottom = dataTableLayout.dataTableSpacerTop + spacerPx;
    }
    return boxes
      .filter((b) => {
        if (b.type === 'table') return false;
        const globalTop = (b.position?.y ?? 0) + (dataTableLayout.boxYOffset[b.id] || 0);
        return globalTop >= spacerBottom;
      })
      .map((b) => b.id);
  }, [boxes, dataTableLayout, demoData]);

  const handlePageSizeChange = (newPageSize) => {
    const oldDims = getCanvasDimensions();
    const dims = pageSizeDimensions[newPageSize] || pageSizeDimensions.A4;
    const newDims = orientation === 'portrait' ? dims.portrait : dims.landscape;
    setBoxes((prev) => transformBoxesForNewCanvas(prev, oldDims.width, oldDims.height, newDims.width, newDims.height));
    setPageSize(newPageSize);
  };

  const handleOrientationChange = (newOrientation) => {
    const oldDims = getCanvasDimensions();
    const dims = pageSizeDimensions[pageSize] || pageSizeDimensions.A4;
    const newDims = newOrientation === 'portrait' ? dims.portrait : dims.landscape;
    setBoxes((prev) => transformBoxesForNewCanvas(prev, oldDims.width, oldDims.height, newDims.width, newDims.height));
    setOrientation(newOrientation);
  };

  const fetchTemplateCount = async () => {
    try {
      const res = await templateService.getTemplates();
      setTemplateCount(Array.isArray(res.data) ? res.data.length : 0);
    } catch (_) {
      setTemplateCount(0);
    }
  };

  const { id: templateIdFromUrl } = useParams();

  useEffect(() => {
    fetchTemplateCount();
  }, []);

  useEffect(() => {
    if (templateIdFromUrl) {
      handleLoadTemplate(templateIdFromUrl);
    }
  }, [templateIdFromUrl]);

  useEffect(() => {
    if (editorMode === 'standardized') {
      standardizedTemplateService.list()
        .then((r) => setStandardizedTemplatesList(Array.isArray(r.data) ? r.data : []))
        .catch(() => setStandardizedTemplatesList([]));
    }
  }, [editorMode]);

  useEffect(() => {
    if (!selectedStandardizedId) {
      setStandardizedKeyValuePairs([]);
      return;
    }
    standardizedTemplateService.getById(selectedStandardizedId)
      .then((r) => setStandardizedKeyValuePairs(Array.isArray(r.data?.keyValuePairs) ? r.data.keyValuePairs : []))
      .catch(() => setStandardizedKeyValuePairs([]));
  }, [selectedStandardizedId]);

  useEffect(() => {
    templateDesignService.list()
      .then((r) => setTemplateDesignsList(Array.isArray(r.data) ? r.data : []))
      .catch(() => setTemplateDesignsList([]));
  }, [editorMode, showSaveDesignModal]);

  const handleSectionToggle = (sectionName) => {
    setExpandedSections((prev) => {
      const next = { global: false, demoData: false, csvImport: false, pdfImport: false, boxLibrary: false, templateSettings: false, properties: false };
      next[sectionName] = !prev[sectionName];
      return next;
    });
  };

  useEffect(() => {
    const s = (demoDataJson || '').trim();
    if (!s) {
      setDemoData(null);
      setDemoDataParseError('');
      return;
    }
    try {
      const parsed = JSON.parse(s);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        setDemoData(parsed);
        setDemoDataParseError('');
      } else {
        setDemoData(null);
        setDemoDataParseError('JSON must be an object (key-value pairs).');
      }
    } catch (e) {
      setDemoDataParseError(e.message || 'Invalid JSON');
    }
  }, [demoDataJson]);

  const applyGlobalFontToAllBoxes = () => {
    const size = Math.max(6, Math.min(72, parseInt(globalFontSize, 10) || 10));
    const family = globalFontFamily || 'Arial';
    setBoxes((prev) =>
      prev.map((b) => ({
        ...b,
        properties: {
          ...b.properties,
          fontSize: size,
          fontFamily: family,
        },
      }))
    );
  };

  useEffect(() => {
    if (selectedBox) setExpandedSections((p) => ({ ...p, properties: true }));
  }, [selectedBox]);

  const handleTableConfigChange = (field, value) => {
    if (field === 'rows' || field === 'columns') {
      const num = parseInt(value) || 1;
      setTableConfig((prev) => {
        const next = { ...prev, [field]: num };
        if (field === 'columns') {
          next.headers = Array.from({ length: num }, (_, i) => prev.headers[i] || `Header ${i + 1}`);
          next.fieldNames = Array.from({ length: num }, (_, i) => prev.fieldNames[i] || `field${i + 1}`);
          next.contentFields = Array.from({ length: num }, (_, i) => prev.contentFields[i] || next.fieldNames[i]);
          next.columnWidths = Array.from({ length: num }, () => 100 / num);
        }
        return next;
      });
    } else if (field.startsWith('header_')) {
      const i = parseInt(field.split('_')[1]);
      setTableConfig((p) => ({ ...p, headers: p.headers.map((h, j) => (j === i ? value : h)) }));
    } else if (field.startsWith('fieldName_')) {
      const i = parseInt(field.split('_')[1]);
      setTableConfig((p) => ({ ...p, fieldNames: p.fieldNames.map((f, j) => (j === i ? value : f)) }));
    } else if (field.startsWith('width_')) {
      const i = parseInt(field.split('_')[1]);
      setTableConfig((p) => ({ ...p, columnWidths: p.columnWidths.map((w, j) => (j === i ? parseFloat(value) || 0 : w)) }));
    }
  };

  const handleCreateTable = () => {
    const tableHeight = Math.max(100, tableConfig.rows * 30 + 40);
    const newBox = {
      id: `library_box_${Date.now()}`,
      type: 'table',
      size: { width: 600, height: tableHeight },
      labelName: '',
      fieldName: '',
      content: '',
      tableConfig: {
        rows: tableConfig.rows,
        columns: tableConfig.columns,
        headers: [...tableConfig.headers],
        fieldNames: [...tableConfig.fieldNames],
        contentFields: [...tableConfig.contentFields],
        columnWidths: [...tableConfig.columnWidths],
        mode: tableMode,
        maxDynamicColumns: maxDynamicColumns,
      },
      properties: {
        fontSize: 12,
        fontFamily: 'Arial',
        fontWeight: 'normal',
        fontColor: '#000000',
        backgroundColor: 'transparent',
        alignment: 'left',
        contentPosition: { x: 0, y: 0 },
        border: true,
      },
    };
    setBoxLibrary((p) => [...p, newBox]);
    setShowTableConfig(false);
    setTableConfig({ rows: 3, columns: 3, headers: ['Header 1', 'Header 2', 'Header 3'], fieldNames: ['field1', 'field2', 'field3'], contentFields: ['field1', 'field2', 'field3'], columnWidths: [33.33, 33.33, 33.33] });
  };

  const DATA_TABLE_DEFAULT_COLUMNS = [
    { header: 'Marks and Numbers', key: 'marks_and_numbers' },
    { header: 'Kind & No of Packages', key: 'kind_no_of_packages' },
    { header: 'Description of Goods', key: 'description_of_goods' },
    { header: 'Gross Weight (kg)', key: 'gross_weight_kg' },
    { header: 'Measurements (m³)', key: 'measurements_m3' },
  ];

  const handleAddDataTable = () => {
    const colCount = DATA_TABLE_DEFAULT_COLUMNS.length;
    const tableHeight = 280;
    const newBox = {
      id: `library_box_${Date.now()}`,
      type: 'table',
      size: { width: 700, height: tableHeight },
      labelName: '',
      fieldName: '',
      content: '',
      tableConfig: {
        rows: 1,
        columns: colCount,
        headers: DATA_TABLE_DEFAULT_COLUMNS.map((c) => c.header),
        fieldNames: DATA_TABLE_DEFAULT_COLUMNS.map((c) => c.key),
        contentFields: DATA_TABLE_DEFAULT_COLUMNS.map((c) => c.key),
        columnWidths: Array(colCount).fill(100 / colCount),
        dynamicRowsFromData: true,
        columnKeys: DATA_TABLE_DEFAULT_COLUMNS.map((c) => c.key),
        rowsOnFirstPage: 3,
        rowsOnOtherPages: null,
      },
      properties: {
        fontSize: 11,
        fontFamily: 'Arial',
        fontWeight: 'normal',
        fontColor: '#000000',
        backgroundColor: 'transparent',
        alignment: 'left',
        contentPosition: { x: 0, y: 0 },
        border: true,
      },
    };
    setBoxLibrary((p) => [...p, newBox]);
  };

  const checkBoxOverlap = (box1, box2) => {
    if (box1.id === box2.id) return false;
    return !(
      box1.position.x + box1.size.width <= box2.position.x ||
      box2.position.x + box2.size.width <= box1.position.x ||
      box1.position.y + box1.size.height <= box2.position.y ||
      box2.position.y + box2.size.height <= box1.position.y
    );
  };

  const findAvailableSpace = (desiredWidth, desiredHeight) => {
    const canvasDims = getCanvasDimensions();
    const margin = 20;
    const titleHeight = 80;
    if (boxes.length === 0) return { x: margin, y: titleHeight + margin, width: desiredWidth, height: desiredHeight };
    const calculateAvailable = (startX, startY) => {
      let maxW = canvasDims.width - startX - margin;
      let maxH = canvasDims.height - startY - margin;
      for (const box of boxes) {
        const br = box.position.x + box.size.width, bb = box.position.y + box.size.height;
        if (box.position.x > startX && box.position.y < startY + maxH && bb > startY) maxW = Math.min(maxW, box.position.x - startX - 5);
        if (box.position.y > startY && box.position.x < startX + maxW && br > startX) maxH = Math.min(maxH, box.position.y - startY - 5);
        if (box.position.x < startX + maxW && br > startX && box.position.y < startY + maxH && bb > startY) return { maxWidth: 0, maxHeight: 0 };
      }
      return { maxWidth: Math.max(50, maxW), maxHeight: Math.max(20, maxH) };
    };
    const positions = [
      ...boxes.map((b) => ({ x: b.position.x + b.size.width + 10, y: b.position.y })),
      ...boxes.map((b) => ({ x: b.position.x, y: b.position.y + b.size.height + 10 })),
      { x: margin, y: titleHeight + margin },
    ];
    for (const pos of positions) {
      if (pos.x < margin || pos.y < titleHeight + margin) continue;
      const avail = calculateAvailable(pos.x, pos.y);
      if (avail.maxWidth >= 50 && avail.maxHeight >= 20) {
        const w = Math.min(desiredWidth, avail.maxWidth);
        const h = Math.min(desiredHeight, avail.maxHeight);
        const test = { id: 'test', position: { x: pos.x, y: pos.y }, size: { width: w, height: h } };
        if (!boxes.some((b) => checkBoxOverlap(test, b))) return { x: pos.x, y: pos.y, width: w, height: h };
      }
    }
    const maxY = Math.max(...boxes.map((b) => b.position.y + b.size.height), titleHeight + margin);
    const avail = calculateAvailable(margin, maxY + 20);
    return { x: margin, y: maxY + 20, width: Math.min(desiredWidth, avail.maxWidth), height: Math.min(desiredHeight, avail.maxHeight) };
  };

  const isTemplateFullyOccupied = (w, h) => {
    const space = findAvailableSpace(w, h);
    return space.width < 50 || space.height < 20;
  };

  const addBoxToLibrary = (type, width, height) => {
    const isLogo = type === 'logo';
    const newBox = {
      id: `library_box_${Date.now()}`,
      type: type || 'text',
      size: { width, height },
      labelName: isLogo ? 'Logo' : '',
      fieldName: isLogo ? 'logo' : '',
      content: isLogo ? '{{logo}}' : '',
      properties: {
        fontSize: 12,
        fontFamily: 'Arial',
        fontWeight: 'normal',
        fontColor: '#000000',
        backgroundColor: 'transparent',
        alignment: 'left',
        contentPosition: { x: 0, y: 0 },
        border: true,
      },
    };
    setBoxLibrary((p) => [...p, newBox]);
  };

  const handleConvertRowToDataTable = () => {
    if (!boxes.length) {
      toast.error('No boxes on the template to convert.');
      return;
    }
    const ids = selectedBoxIds && selectedBoxIds.length > 0 ? selectedBoxIds : (selectedBox ? [selectedBox] : []);
    if (ids.length === 0) {
      toast.error('Select one or more boxes first, then click Convert row to Data Table (loop).');
      return;
    }
    let rowBoxes;
    if (ids.length > 1) {
      rowBoxes = boxes.filter((b) => ids.includes(b.id) && b.type !== 'table');
      rowBoxes = rowBoxes.sort((a, b) => (a.position?.x ?? 0) - (b.position?.x ?? 0));
    } else {
      const selected = boxes.find((b) => b.id === ids[0]);
      if (!selected) {
        toast.error('Selected box not found.');
        return;
      }
      rowBoxes = getBoxesInSameRow(selected, boxes).filter((b) => b.type !== 'table');
    }
    if (!rowBoxes.length) {
      toast.error('No convertible boxes in selection. Select text or field boxes (not tables), then try again.');
      return;
    }
    if (rowBoxes.length >= boxes.length) {
      toast.error('Could not detect a single row: too many boxes in the same band. Drag to select columns or select one box in the row you want to convert.');
      return;
    }
    const selected = rowBoxes[0];
    const columnKeys = rowBoxes.map((b) => (b.fieldName && String(b.fieldName).trim()) || (b.labelName ? labelToKey(b.labelName) : '') || `col_${rowBoxes.indexOf(b)}`);
    const headers = rowBoxes.map((b) => b.labelName || (b.fieldName ? String(b.fieldName).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '') || '');
    const minX = Math.min(...rowBoxes.map((b) => b.position?.x ?? 0));
    const minY = Math.min(...rowBoxes.map((b) => b.position?.y ?? 0));
    const maxRight = Math.max(...rowBoxes.map((b) => (b.position?.x ?? 0) + (b.size?.width ?? 0)));
    const maxBottom = Math.max(...rowBoxes.map((b) => (b.position?.y ?? 0) + (b.size?.height ?? 0)));
    const width = Math.max(200, maxRight - minX);
    const height = Math.max(120, maxBottom - minY);
    const rowIds = new Set(rowBoxes.map((b) => b.id));
    const newBox = {
      id: `box_${Date.now()}`,
      type: 'table',
      rank: nextRank,
      position: { x: minX, y: minY },
      size: { width, height },
      labelName: '',
      fieldName: '',
      content: '',
      tableConfig: {
        rows: 1,
        columns: columnKeys.length,
        headers,
        fieldNames: [...columnKeys],
        contentFields: [...columnKeys],
        columnWidths: columnKeys.map(() => 100 / columnKeys.length),
        dynamicRowsFromData: true,
        columnKeys: [...columnKeys],
        rowsOnFirstPage: 3,
        rowsOnOtherPages: null,
      },
      properties: {
        fontSize: selected?.properties?.fontSize ?? 11,
        fontFamily: selected?.properties?.fontFamily || 'Arial',
        fontWeight: selected?.properties?.fontWeight || 'normal',
        fontColor: selected?.properties?.fontColor || '#000000',
        backgroundColor: 'transparent',
        alignment: 'left',
        contentPosition: { x: 0, y: 0 },
        border: true,
      },
    };
    setBoxes((prev) => [...prev.filter((b) => !rowIds.has(b.id)), newBox]);
    setNextRank((n) => n + 1);
    setSelection([newBox.id]);
    toast.success('Converted to Data Table (loop) successfully.');
  };

  const addBoxToCanvas = (libraryBox, dropPosition) => {
    if (isTemplateFullyOccupied(libraryBox.size.width, libraryBox.size.height)) {
      toast.error('No space for new boxes.');
      return;
    }
    const canvasDims = getCanvasDimensions();
    const margin = 20;
    const titleHeight = 80;
    let finalPosition;
    if (dropPosition?.x != null && dropPosition?.y != null) {
      let x = Math.max(margin, Math.min(dropPosition.x, canvasDims.width - libraryBox.size.width - margin));
      let y = Math.max(titleHeight + margin, Math.min(dropPosition.y, canvasDims.height - libraryBox.size.height - margin));
      const test = { id: 'test', position: { x, y }, size: libraryBox.size };
      if (!boxes.some((b) => checkBoxOverlap(test, b))) finalPosition = { x, y, width: libraryBox.size.width, height: libraryBox.size.height };
      else finalPosition = findAvailableSpace(libraryBox.size.width, libraryBox.size.height);
    } else {
      finalPosition = findAvailableSpace(libraryBox.size.width, libraryBox.size.height);
    }
    if (finalPosition.width < 50 || finalPosition.height < 20) return;
    const newBox = {
      ...libraryBox,
      id: `box_${Date.now()}`,
      rank: nextRank,
      position: { x: finalPosition.x, y: finalPosition.y },
      size: { width: finalPosition.width, height: finalPosition.height },
      properties: { ...libraryBox.properties, contentPosition: { x: 0, y: 0 } },
    };
    setBoxes((p) => [...p, newBox]);
    setNextRank((p) => p + 1);
    setSelection([newBox.id]);
  };

  const addBoxFromStandardizedKey = (keyItem, dropPosition) => {
    const key = keyItem?.key || '';
    const label = keyItem?.label || key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const isLogo = key === 'logo';
    const width = isLogo ? 120 : 180;
    const height = isLogo ? 60 : 22;
    if (isTemplateFullyOccupied(width, height)) {
      toast.error('No space for new boxes.');
      return;
    }
    const canvasDims = getCanvasDimensions();
    const margin = 20;
    const titleHeight = 80;
    let finalPosition;
    if (dropPosition?.x != null && dropPosition?.y != null) {
      const x = Math.max(margin, Math.min(dropPosition.x, canvasDims.width - width - margin));
      const y = Math.max(titleHeight + margin, Math.min(dropPosition.y, canvasDims.height - height - margin));
      const test = { id: 'test', position: { x, y }, size: { width, height } };
      if (!boxes.some((b) => checkBoxOverlap(test, b))) finalPosition = { x, y, width, height };
      else finalPosition = findAvailableSpace(width, height);
    } else {
      finalPosition = findAvailableSpace(width, height);
    }
    if (finalPosition.width < 50 || finalPosition.height < 20) return;
    const newBox = {
      id: `box_${Date.now()}`,
      type: isLogo ? 'logo' : 'text',
      rank: nextRank,
      position: { x: finalPosition.x, y: finalPosition.y },
      size: { width: finalPosition.width, height: finalPosition.height },
      labelName: label,
      fieldName: key,
      content: isLogo ? '{{logo}}' : `{{${key}}}`,
      properties: {
        fontSize: globalFontSize,
        fontFamily: globalFontFamily,
        fontWeight: 'normal',
        fontColor: '#000000',
        backgroundColor: 'transparent',
        alignment: 'left',
        contentPosition: { x: 0, y: 0 },
        border: true,
      },
    };
    setBoxes((p) => [...p, newBox]);
    setNextRank((p) => p + 1);
    setSelection([newBox.id]);
  };

  const updateBox = (boxId, updates) => {
    setBoxes((p) => p.map((b) => (b.id === boxId ? { ...b, ...updates } : b)));
  };

  const deleteBox = (boxId) => {
    setBoxes((p) => p.filter((b) => b.id !== boxId));
    setSelection(selectedBoxIds.filter((id) => id !== boxId));
  };

  const wouldOverlap = (boxId, newX, newY, w, h, allBoxes) => {
    const test = { id: boxId, position: { x: newX, y: newY }, size: { width: w, height: h } };
    return allBoxes.some((b) => b.id !== boxId && checkBoxOverlap(test, b));
  };

  const handleResizeStart = (e, boxId, handle) => {
    e.preventDefault();
    e.stopPropagation();
    const box = boxes.find((b) => b.id === boxId);
    if (!box) return;
    const canvas = e.currentTarget.closest('.canvas');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    setResizingBox(boxId);
    setResizeHandleName(handle);
    setResizeStart({
      x: e.clientX,
      y: e.clientY,
      width: box.size.width,
      height: box.size.height,
      left: box.position.x,
      top: box.position.y,
      canvasLeft: rect.left,
      canvasTop: rect.top,
    });
    setSelection([boxId]);
  };

  const handleMouseDown = (e, boxId) => {
    if (e.target.classList.contains('resize-handle')) return;
    e.preventDefault();
    e.stopPropagation();
    const box = boxes.find((b) => b.id === boxId);
    if (!box) return;
    const canvas = e.currentTarget.closest('.canvas');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const offsetX = e.clientX - (rect.left + box.position.x);
    const offsetY = e.clientY - (rect.top + box.position.y);
    setDraggingBox(boxId);
    setDragOffset({ x: offsetX, y: offsetY, startX: e.clientX, startY: e.clientY, boxStartX: box.position.x, boxStartY: box.position.y });
    setSelection([boxId]);
  };

  /** Double-click: expand/snap this box to adjacent boxes so borders merge (no gap). */
  const SNAP_GAP_PX = 24;
  const handleBoxDoubleClick = (e, box) => {
    e.preventDefault();
    e.stopPropagation();
    if (box.type === 'table' && box.tableConfig?.dynamicRowsFromData) return; // skip data tables
    const layout = dataTableLayout;
    const getTop = (b) => (b.position?.y ?? 0) + (layout?.boxYOffset?.[b.id] ?? 0);
    const getHeight = (b) => (layout?.effectiveHeightByBoxId?.[b.id] != null ? layout.effectiveHeightByBoxId[b.id] : (b.size?.height ?? 20));
    const getBottom = (b) => getTop(b) + getHeight(b);
    const getLeft = (b) => b.position?.x ?? 0;
    const getRight = (b) => getLeft(b) + (b.size?.width ?? 0);
    const myTop = getTop(box);
    const myBottom = getBottom(box);
    const myLeft = getLeft(box);
    const myRight = getRight(box);
    let newTop = myTop;
    let newBottom = myBottom;
    let newLeft = myLeft;
    let newRight = myRight;
    boxes.forEach((b) => {
      if (b.id === box.id) return;
      const t = getTop(b);
      const bot = getBottom(b);
      const l = getLeft(b);
      const r = getRight(b);
      const vertOverlap = myTop < bot && myBottom > t;
      const horizOverlap = myLeft < r && myRight > l;
      // Left neighbor (their right close to our left): expand our left to touch
      if (vertOverlap && r < myLeft && myLeft - r <= SNAP_GAP_PX) newLeft = Math.min(newLeft, r);
      // Right neighbor (their left close to our right): expand our right to touch
      if (vertOverlap && l > myRight && l - myRight <= SNAP_GAP_PX) newRight = Math.max(newRight, l);
      // Top neighbor (their bottom close to our top): expand our top to touch
      if (horizOverlap && bot < myTop && myTop - bot <= SNAP_GAP_PX) newTop = Math.min(newTop, bot);
      // Bottom neighbor (their top close to our bottom): expand our bottom to touch
      if (horizOverlap && t > myBottom && t - myBottom <= SNAP_GAP_PX) newBottom = Math.max(newBottom, t);
    });
    const minSize = 8;
    const newHeight = Math.max(minSize, newBottom - newTop);
    const newWidth = Math.max(minSize, newRight - newLeft);
    const offsetY = layout?.boxYOffset?.[box.id] ?? 0;
    const newPosY = newTop - offsetY;
    const newPosX = newLeft;
    setBoxes((prev) => prev.map((b) => (b.id === box.id ? { ...b, position: { ...b.position, x: newPosX, y: newPosY }, size: { ...b.size, width: newWidth, height: newHeight } } : b)));
  };

  useEffect(() => {
    if (!resizingBox || !resizeHandle) return;
    const handleMove = (e) => {
      const canvas = document.querySelector('.canvas');
      if (!canvas) return;
      const deltaX = e.clientX - resizeStart.x;
      const deltaY = e.clientY - resizeStart.y;
      const dims = getCanvasDimensions();
      const effectiveCanvasHeight = dims.height + (dataTableLayout?.totalExtraHeight ?? 0);
      const minSize = 20;
      const gap = 2;
      setBoxes((prev) => {
        const box = prev.find((b) => b.id === resizingBox);
        if (!box) return prev;
        let { width, height, left, top } = { width: resizeStart.width, height: resizeStart.height, left: resizeStart.left, top: resizeStart.top };
        if (['e', 'ne', 'se'].includes(resizeHandle)) width = Math.max(minSize, resizeStart.width + deltaX);
        if (['w', 'nw', 'sw'].includes(resizeHandle)) {
          width = Math.max(minSize, resizeStart.width - deltaX);
          left = resizeStart.left + (resizeStart.width - width);
        }
        if (['s', 'sw', 'se'].includes(resizeHandle)) height = Math.max(minSize, resizeStart.height + deltaY);
        if (['n', 'nw', 'ne'].includes(resizeHandle)) {
          height = Math.max(minSize, resizeStart.height - deltaY);
          top = resizeStart.top + (resizeStart.height - height);
        }
        // Clamp to canvas (use effective height so boxes below first page can still resize)
        let maxW = dims.width - left;
        let maxH = Math.max(minSize, effectiveCanvasHeight - top);
        let minLeft = 0;
        let minTop = 0;
        // Only constrain when expanding toward another box (so shrink/fill-gap works; avoid forcing shrink when already adjacent)
        const myRight0 = resizeStart.left + resizeStart.width;
        const myBottom0 = resizeStart.top + resizeStart.height;
        prev.forEach((b) => {
          if (b.id === resizingBox) return;
          const or = b.position.x + b.size.width;
          const ob = b.position.y + b.size.height;
          const verticalOverlap = !(top + height <= b.position.y - gap || b.position.y + b.size.height <= top - gap);
          const horizontalOverlap = !(left + width <= b.position.x - gap || b.position.x + b.size.width <= left - gap);
          if (['e', 'ne', 'se'].includes(resizeHandle) && b.position.x > myRight0 && verticalOverlap) maxW = Math.min(maxW, b.position.x - left - gap);
          if (['w', 'nw', 'sw'].includes(resizeHandle) && or < resizeStart.left && verticalOverlap) minLeft = Math.max(minLeft, b.position.x + b.size.width + gap);
          if (['s', 'sw', 'se'].includes(resizeHandle) && b.position.y > myBottom0 && horizontalOverlap) maxH = Math.min(maxH, b.position.y - top - gap);
          if (['n', 'nw', 'ne'].includes(resizeHandle) && ob < resizeStart.top && horizontalOverlap) minTop = Math.max(minTop, b.position.y + b.size.height + gap);
        });
        if (['w', 'nw', 'sw'].includes(resizeHandle) && minLeft > 0) left = Math.max(left, minLeft);
        if (['w', 'nw', 'sw'].includes(resizeHandle)) width = resizeStart.left + resizeStart.width - left;
        if (['n', 'nw', 'ne'].includes(resizeHandle) && minTop > 0) top = Math.max(top, minTop);
        if (['n', 'nw', 'ne'].includes(resizeHandle)) height = resizeStart.top + resizeStart.height - top;
        width = Math.max(minSize, Math.min(maxW, width));
        height = Math.max(minSize, Math.min(maxH, height));
        if (['w', 'nw', 'sw'].includes(resizeHandle)) left = resizeStart.left + resizeStart.width - width;
        if (['n', 'nw', 'ne'].includes(resizeHandle)) top = resizeStart.top + resizeStart.height - height;
        return prev.map((b) =>
          b.id === resizingBox ? { ...b, position: { x: left, y: top }, size: { width, height } } : b
        );
      });
    };
    const handleUp = () => {
      setResizingBox(null);
      setResizeHandleName(null);
      setResizeStart({ x: 0, y: 0, width: 0, height: 0, left: 0, top: 0 });
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
  }, [resizingBox, resizeHandle, resizeStart, dataTableLayout]);

  useEffect(() => {
    if (!draggingBox) return;
    const handleMove = (e) => {
      const mouseDeltaX = Math.abs(e.clientX - dragOffset.startX);
      const mouseDeltaY = Math.abs(e.clientY - dragOffset.startY);
      if (mouseDeltaX < 15 && mouseDeltaY < 15) return;
      if (!isDragging) {
        setIsDragging(true);
        document.body.style.cursor = 'grabbing';
      }
      const canvas = document.querySelector('.canvas');
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      setBoxes((prev) => {
        const box = prev.find((b) => b.id === draggingBox);
        if (!box) return prev;
        const newX = e.clientX - rect.left - dragOffset.x;
        const newY = e.clientY - rect.top - dragOffset.y;
        const constrainedX = Math.max(0, Math.min(newX, rect.width - box.size.width));
        const constrainedY = Math.max(0, Math.min(newY, rect.height - box.size.height));
        if (wouldOverlap(draggingBox, constrainedX, constrainedY, box.size.width, box.size.height, prev)) {
          setOverlappingBox(prev.find((b) => b.id !== draggingBox && checkBoxOverlap({ id: draggingBox, position: { x: constrainedX, y: constrainedY }, size: box.size }, b))?.id ?? null);
          return prev;
        }
        setOverlappingBox(null);
        return prev.map((b) => (b.id === draggingBox ? { ...b, position: { x: constrainedX, y: constrainedY } } : b));
      });
    };
    const handleUp = () => {
      setIsDragging(false);
      setDraggingBox(null);
      setDragOffset({ x: 0, y: 0, startX: 0, startY: 0, boxStartX: 0, boxStartY: 0 });
      setOverlappingBox(null);
      document.body.style.cursor = '';
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      document.body.style.cursor = '';
    };
  }, [draggingBox, dragOffset, isDragging]);

  useEffect(() => {
    if (!marquee) return;
    const canvasEl = document.querySelector('.canvas');
    const handleMove = (e) => {
      if (!canvasEl) return;
      const rect = canvasEl.getBoundingClientRect();
      setMarquee((prev) => prev && { ...prev, end: { x: e.clientX - rect.left, y: e.clientY - rect.top } });
    };
    const handleUp = () => {
      const current = marqueeRef.current;
      if (!canvasEl || !current) return;
      const left = Math.min(current.start.x, current.end.x);
      const top = Math.min(current.start.y, current.end.y);
      const right = Math.max(current.start.x, current.end.x);
      const bottom = Math.max(current.start.y, current.end.y);
      const ids = boxes
        .filter((box) => {
          const oy = dataTableLayout.boxYOffset[box.id] || 0;
          const boxTop = (box.position?.y ?? 0) + oy;
          const boxH = dataTableLayout.effectiveHeightByBoxId[box.id] ?? box.size?.height ?? 20;
          const boxLeft = box.position?.x ?? 0;
          const boxRight = boxLeft + (box.size?.width ?? 0);
          const boxBottom = boxTop + boxH;
          return !(boxRight < left || boxLeft > right || boxBottom < top || boxTop > bottom);
        })
        .map((b) => b.id);
      setSelection(ids);
      setMarquee(null);
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
  }, [marquee, boxes, dataTableLayout]);

  const handleCreateNewTemplate = () => {
    setCurrentTemplateId(null);
    setTemplateName('Untitled');
    setDocumentTitle('PDF Document');
    setBoxes([]);
    setNextRank(1);
    setSelection([]);
    setBoxLibrary([]);
    setCanvasBackgroundImage(null);
  };

  const handleConfirmDeleteTemplate = async () => {
    if (!currentTemplateId || deleting) return;
    setDeleting(true);
    try {
      await templateService.deleteTemplate(currentTemplateId);
      const res = await templateService.getTemplates();
      setTemplatesList(Array.isArray(res.data) ? res.data : []);
      setTemplateCount(Array.isArray(res.data) ? res.data.length : 0);
      handleCreateNewTemplate();
      setShowDeleteConfirm(false);
      toast.success('Template deleted.');
    } catch (err) {
      console.error('Delete template failed:', err);
      toast.error(err.response?.data?.message || 'Failed to delete template');
    } finally {
      setDeleting(false);
    }
  };

  const handleExportToHtml = () => {
    const dims = getCanvasDimensions();
    const w = dims.width;
    const h = dims.height;
    const data = demoData && typeof demoData === 'object' && !Array.isArray(demoData) ? demoData : {};
    const singlePageHeight = h;
    const effectiveHeightByBoxId = {};
    let totalExtraHeight = 0;
    boxes.forEach((box) => {
      const designHeight = box.size?.height ?? 20;
      let effective = null;
      if (box.type === 'table' && box.tableConfig && Array.isArray(box.tableConfig.columnKeys)) {
        effective = getDataTableFirstSegmentHeight(box, data);
        if (effective != null) {
          const rowCount = getDataTableRowCount(data || {}, box.tableConfig.columnKeys);
          const rowsOnFirst = Math.max(3, Math.max(1, Number(box?.tableConfig?.rowsOnFirstPage) || 3));
          const useAttachedListMode = rowCount > DATA_TABLE_ATTACHED_LIST_THRESHOLD;
          if (!useAttachedListMode && rowCount <= rowsOnFirst) effective += EMPTY_BOX_BELOW_TABLE_PX;
          effective = Math.max(Number(effective), designHeight);
        }
      }
      const heightVal = effective != null ? Math.max(effective, designHeight) : designHeight;
      effectiveHeightByBoxId[box.id] = heightVal;
      if (effective != null) totalExtraHeight += Math.max(0, effective - designHeight);
    });
    const isEmptyBoxExport = (b) => {
      const hasField = (b.fieldName && String(b.fieldName).trim()) || (b.labelName && String(b.labelName).trim());
      const hasContent = b.content && String(b.content).trim() && !/^\{\{\s*\}\}$/.test(String(b.content).trim());
      return !hasField && !hasContent && b.type !== 'table' && b.type !== 'logo';
    };
    boxes.forEach((t) => {
      if (t.type !== 'table' || !t.tableConfig || !Array.isArray(t.tableConfig.columnKeys)) return;
      const tEffective = effectiveHeightByBoxId[t.id];
      if (tEffective == null) return;
      const tTop = t.position?.y ?? 0;
      const firstSegmentBottom = tTop + tEffective;
      const rowCount = getDataTableRowCount(data, t.tableConfig.columnKeys);
      const rowsOnFirst = Math.max(3, Math.max(1, Number(t?.tableConfig?.rowsOnFirstPage) || 3));
      const tableIncludesGapExport = rowCount <= DATA_TABLE_ATTACHED_LIST_THRESHOLD && rowCount <= rowsOnFirst;
      const spacerPx = rowCount > DATA_TABLE_ATTACHED_LIST_THRESHOLD ? GAP_BETWEEN_TABLE_AND_NEXT_FIELD_PX : (tableIncludesGapExport ? GAP_BETWEEN_TABLE_AND_NEXT_FIELD_PX : (EMPTY_BOX_BELOW_TABLE_PX + GAP_BETWEEN_TABLE_AND_NEXT_FIELD_PX));
      const spacerBottom = firstSegmentBottom + spacerPx;
      boxes.forEach((b) => {
        if (b.id === t.id || b.type === 'table') return;
        const bTop = b.position?.y ?? 0;
        const bH = b.size?.height ?? 20;
        const bBottom = bTop + bH;
        const overlapsSpacer = bTop < spacerBottom && bBottom > firstSegmentBottom;
        if (spacerPx > 0 && overlapsSpacer && isEmptyBoxExport(b)) {
          effectiveHeightByBoxId[b.id] = 0;
        }
      });
    });
    const minYBelowTableExport = {};
    boxes.forEach((t) => {
if (t.type !== 'table' || !t.tableConfig || !Array.isArray(t.tableConfig.columnKeys)) return;
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
        minYBelowTableExport[t.id] = minY === Infinity ? null : minY;
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
        const isDataTable = t.type === 'table' && t.tableConfig && Array.isArray(t.tableConfig?.columnKeys);
        if (isDataTable && tEffective != null) {
          const firstSegmentBottom = tTop + tEffective;
          const rowCount = getDataTableRowCount(data, t.tableConfig.columnKeys);
          const rowsOnFirst = Math.max(3, Math.max(1, Number(t?.tableConfig?.rowsOnFirstPage) || 3));
          const tableIncludesGapExport = rowCount <= DATA_TABLE_ATTACHED_LIST_THRESHOLD && rowCount <= rowsOnFirst;
          const spacerPx = rowCount > DATA_TABLE_ATTACHED_LIST_THRESHOLD ? GAP_BETWEEN_TABLE_AND_NEXT_FIELD_PX : (tableIncludesGapExport ? GAP_BETWEEN_TABLE_AND_NEXT_FIELD_PX : (EMPTY_BOX_BELOW_TABLE_PX + GAP_BETWEEN_TABLE_AND_NEXT_FIELD_PX));
          const spacerBottom = firstSegmentBottom + spacerPx;
          const minY = minYBelowTableExport[t.id];
          if (bTop >= firstSegmentBottom) {
            offset += minY != null ? spacerBottom - minY : (tEffective + spacerPx) - tDesign;
          } else if (bBottom > firstSegmentBottom) {
            offset += Math.max(0, spacerBottom - bTop);
          } else if (bTop < firstSegmentBottom && bBottom > tTop) {
            offset += Math.max(0, spacerBottom - bTop);
          }
        } else if (tEffective != null && tEffective > tDesign && bTop >= tTop + tDesign) {
          offset += tEffective - tDesign;
        }
      });
      boxYOffset[b.id] = offset;
    });
    let totalContentHeight = Math.max(
      h,
      ...boxes.map((b) => {
        const top = (b.position?.y ?? 0) + (boxYOffset[b.id] || 0);
        const boxH = effectiveHeightByBoxId[b.id] ?? (b.size?.height ?? 20);
        return top + boxH;
      })
    );
    boxes.forEach((box) => {
      if (box.type === 'table' && box.tableConfig && Array.isArray(box.tableConfig.columnKeys)) {
        const contentHeight = singlePageHeight - TITLE_AREA_HEIGHT;
        const tableTop = (box.position?.y ?? 0) + (boxYOffset[box.id] || 0);
        const firstSegmentHeight = effectiveHeightByBoxId[box.id] ?? 0;
        const rowCount = getDataTableRowCount(data, box.tableConfig.columnKeys);
        const useAttachedListMode = rowCount > DATA_TABLE_ATTACHED_LIST_THRESHOLD;
        totalContentHeight = Math.max(totalContentHeight, tableTop + firstSegmentHeight);
        if (useAttachedListMode && rowCount > 0) {
          let tablePageIndex = 1;
          while (true) {
            const range = getDataTableRowRangeForPage(box, tablePageIndex, rowCount, contentHeight);
            if (range.endRow <= range.startRow) break;
            const segmentHeight = DATA_TABLE_HEADER_ROW_PX + (range.endRow - range.startRow) * DATA_TABLE_ROW_HEIGHT_PX;
            const endYOnPage = tablePageIndex * singlePageHeight + segmentHeight;
            totalContentHeight = Math.max(totalContentHeight, endYOnPage);
            if (range.endRow >= rowCount) break;
            tablePageIndex++;
          }
        } else {
          const fullTableHeight = getDataTablePaginatedTotalHeight(box, data, contentHeight, box.position?.y ?? 0);
          if (fullTableHeight != null) totalContentHeight = Math.max(totalContentHeight, tableTop + fullTableHeight);
        }
      }
    });
    const numPages = Math.max(1, Math.ceil(totalContentHeight / singlePageHeight));
    let dataTableSpacerTop = null;
    let dataTableSpacerLeft = 0;
    let dataTableSpacerWidth = null;
    let exportAttachedListMode = false;
    let dataTableIncludesGapOnFirstPage = false;
    const dataTablesForExport = boxes.filter((b) => b.type === 'table' && b.tableConfig && Array.isArray(b.tableConfig?.columnKeys));
    if (dataTablesForExport.length > 0) {
      const firstDataTable = dataTablesForExport.reduce((min, b) => {
        const gy = (b.position?.y ?? 0) + (boxYOffset[b.id] || 0);
        const minGy = (min.position?.y ?? 0) + (boxYOffset[min.id] || 0);
        return gy < minGy ? b : min;
      });
      dataTableSpacerTop = (firstDataTable.position?.y ?? 0) + (boxYOffset[firstDataTable.id] || 0) + (effectiveHeightByBoxId[firstDataTable.id] ?? firstDataTable.size?.height ?? 20);
      dataTableSpacerLeft = firstDataTable.position?.x ?? 0;
      dataTableSpacerWidth = firstDataTable.size?.width ?? null;
      const rowCountExport = getDataTableRowCount(data, firstDataTable.tableConfig?.columnKeys || []);
      exportAttachedListMode = rowCountExport > DATA_TABLE_ATTACHED_LIST_THRESHOLD;
      const rowsOnFirstExport = Math.max(3, Math.max(1, Number(firstDataTable?.tableConfig?.rowsOnFirstPage) || 3));
      dataTableIncludesGapOnFirstPage = rowCountExport <= DATA_TABLE_ATTACHED_LIST_THRESHOLD && rowCountExport <= rowsOnFirstExport;
    }
    const escape = (s) => String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    const headerRowPx = 28;
    const rowHeightPx = 22;
    const renderBoxHtml = (box, top, width, height, tableRowRange, pageIndex, totalPages) => {
      if (box.type === 'table' && box.tableConfig && Array.isArray(box.tableConfig.columnKeys)) {
        const columnKeys = box.tableConfig.columnKeys;
        const rowCount = getDataTableRowCount(data, columnKeys);
        const colCount = columnKeys.length;
        const colWidths = (box.tableConfig.columnWidths && Array.isArray(box.tableConfig.columnWidths) && box.tableConfig.columnWidths.length === colCount)
          ? box.tableConfig.columnWidths
          : Array.from({ length: colCount }, () => 100 / colCount);
        const cellWrap = 'word-break:break-word;overflow-wrap:break-word;white-space:normal;';
        const cellWrapPreLine = 'word-break:break-word;overflow-wrap:break-word;white-space:pre-line;';
        const colgroup = colWidths.map((pct) => `<col style="width:${Math.max(1, Math.min(100, Number(pct) || 100 / colCount))}%">`).join('');
        const headers = (box.tableConfig.headers || []).map((hd) => `<th style="border:1px solid #000;padding:4px;text-align:left;background:#f0f0f0;${cellWrap}">${escape(hd || '')}</th>`).join('');
        const range = tableRowRange || { startRow: 0, endRow: rowCount };
        let bodyRows = '';
        if (rowCount === 0) {
          bodyRows = `<tr><td colspan="${columnKeys.length}" style="border:none;padding:8px;">No data rows</td></tr>`;
        } else if (rowCount > DATA_TABLE_ATTACHED_LIST_THRESHOLD && range.endRow === range.startRow) {
          bodyRows = `<tr style="height:${DATA_TABLE_ATTACHED_LIST_GAP_PX}px"><td colspan="${columnKeys.length}" style="border:none;padding:8px;font-style:italic;text-align:center;vertical-align:bottom;height:${DATA_TABLE_ATTACHED_LIST_GAP_PX}px;">Find the details of elements in attached list.</td></tr>`;
        } else {
          bodyRows = Array.from({ length: range.endRow - range.startRow }).map((_, i) => {
            const ri = range.startRow + i;
            const meta = getDataTableRowMeta(data, columnKeys, ri + 1);
            const trStyle = meta?.isContainerHeading ? 'font-weight:bold;' : '';
            const cells = columnKeys.map((_, ci) => {
              const cell = escape(getDataTableCell(data, columnKeys, ri + 1, ci));
              const cellBold = meta?.isContainerHeading && ci === 0 ? 'font-weight:bold;' : '';
              return `<td style="border:none;padding:4px;${cellBold}${cellWrapPreLine}">${cell}</td>`;
            }).join('');
            return `<tr style="${trStyle}">${cells}</tr>`;
          }).join('');
        }
        const rowsOnFirst = Math.max(3, Math.max(1, Number(box.tableConfig?.rowsOnFirstPage) || 3));
        const includeGapInside = rowCount <= DATA_TABLE_ATTACHED_LIST_THRESHOLD && rowCount <= rowsOnFirst;
        const tableBorderStyle = includeGapInside ? 'border:none;' : '';
        const tableHtml = `<table style="width:100%;border-collapse:collapse;table-layout:fixed;font-size:${box.properties?.fontSize ?? 11}px;${tableBorderStyle}"><colgroup>${colgroup}</colgroup><thead><tr>${headers}</tr></thead><tbody>${bodyRows}</tbody></table>`;
        const gapBlock = includeGapInside ? `<div class="data-table-gap-inside" style="width:100%;height:${EMPTY_BOX_BELOW_TABLE_PX}px;flex-shrink:0;"></div>` : '';
        const wrapperExtra = includeGapInside ? 'display:flex;flex-direction:column;' : '';
        return `<div class="template-box template-box-table" style="position:absolute;left:${box.position?.x ?? 0}px;top:${top}px;width:${width}px;height:${height}px;padding:4px;box-sizing:border-box;overflow:visible;border:1px solid #000;${wrapperExtra}">${tableHtml}${gapBlock}</div>`;
      }
      const rawLabel = box.labelName || (box.fieldName ? String(box.fieldName).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '');
      const label = (rawLabel && String(rawLabel).trim().endsWith('...') && box.fieldName) ? String(box.fieldName).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : rawLabel;
      const labelOnly = !!box.properties?.labelOnly;
      const valueOnly = !!box.properties?.valueOnly;
      const emptyBox = !!box.properties?.emptyBox;
      const rawPlaceholder = box.content || `{{${box.fieldName || 'field'}}}`;
      const dataWithPages = { ...(data && typeof data === 'object' ? data : {}), pages: `${(pageIndex ?? 0) + 1} of ${totalPages ?? 1}` };
      const displayValue = replacePlaceholdersInContent(rawPlaceholder, dataWithPages);
      const valueEmpty = String(displayValue).trim() === '';
      const showPlaceholderWhenEmpty = rawPlaceholder && /\{\{/.test(rawPlaceholder);
      const valueToShow = valueEmpty && showPlaceholderWhenEmpty ? rawPlaceholder : displayValue;
      const valueToShowEmpty = String(valueToShow).trim() === '';
      const content = emptyBox ? '' : (valueOnly ? (valueToShowEmpty ? '' : escape(valueToShow)) : (labelOnly && label ? escape(label) : (label ? (valueToShowEmpty ? `${escape(label)}:` : `${escape(label)}: ${escape(valueToShow)}`) : (valueToShowEmpty ? '' : escape(valueToShow)))));
      const exportLayout = { boxYOffset, effectiveHeightByBoxId };
      const edges = getBoxEdgeVisibility(box, boxes, ADJACENT_EPS, exportLayout);
      const borderLeft = edges.left ? '1px solid #000' : 'none';
      const borderRight = edges.right ? '1px solid #000' : 'none';
      const borderTop = edges.top ? '1px solid #000' : 'none';
      const borderBottom = edges.bottom ? '1px solid #000' : 'none';
      return `<div class="template-box" style="position:absolute;left:${box.position?.x ?? 0}px;top:${top}px;width:${width}px;height:${height}px;font-size:${box.properties?.fontSize ?? 10}px;font-family:${escape(box.properties?.fontFamily || 'Arial')};color:${escape(box.properties?.fontColor || '#000')};border-left:${borderLeft};border-right:${borderRight};border-top:${borderTop};border-bottom:${borderBottom};padding:4px;box-sizing:border-box;white-space:normal;word-break:break-word;overflow-wrap:break-word;">${content}</div>`;
    };

    const sortedBoxes = [...boxes].sort((a, b) => (a.rank || 0) - (b.rank || 0));
    const pageDivs = Array.from({ length: numPages }).map((_, pageIndex) => {
      const pageTop = pageIndex * singlePageHeight;
      const pageBottom = (pageIndex + 1) * singlePageHeight;
      const boxDivsForPage = sortedBoxes
        .filter((box) => {
          if (box.type === 'table' && box.tableConfig && Array.isArray(box.tableConfig.columnKeys)) {
            const rowCount = getDataTableRowCount(data, box.tableConfig.columnKeys);
            const range = getDataTableRowRangeForPage(box, pageIndex, rowCount, singlePageHeight - TITLE_AREA_HEIGHT);
            if (range.endRow > range.startRow) return true;
            if (pageIndex === 0 && rowCount > DATA_TABLE_ATTACHED_LIST_THRESHOLD) return true;
            if (pageIndex === 0 && rowCount === 0) return true;
            return false;
          }
          const globalTop = (box.position?.y ?? 0) + (boxYOffset[box.id] || 0);
          const boxH = effectiveHeightByBoxId[box.id] ?? box.size?.height ?? 20;
          const globalBottom = globalTop + boxH;
          if (boxH <= 0) return false;
          return globalBottom > pageTop && globalTop < pageBottom;
        })
        .map((box) => {
          const globalTop = (box.position?.y ?? 0) + (boxYOffset[box.id] || 0);
          const width = box.size?.width ?? (box.type === 'table' ? 600 : 60);
          const fullHeight = effectiveHeightByBoxId[box.id] ?? box.size?.height ?? (box.type === 'table' ? 200 : 20);
          const clipBottom = pageBottom - globalTop;
          let height = Math.min(fullHeight, clipBottom);
          let tableRowRange = null;
          let localTop = Math.max(0, globalTop - pageTop);
          if (box.type === 'table' && box.tableConfig && Array.isArray(box.tableConfig.columnKeys)) {
            const rowCount = getDataTableRowCount(data, box.tableConfig.columnKeys);
            const tablePageIndex = pageIndex;
            const rowsOnFirst = Math.max(3, Math.max(1, Number(box.tableConfig?.rowsOnFirstPage) || 3));
            const tableIncludesGap = pageIndex === 0 && rowCount <= DATA_TABLE_ATTACHED_LIST_THRESHOLD && rowCount <= rowsOnFirst;
            if (rowCount > 0) {
              const range = getDataTableRowRangeForPage(box, tablePageIndex, rowCount, singlePageHeight - TITLE_AREA_HEIGHT);
              if (range.endRow > range.startRow) {
                tableRowRange = { startRow: range.startRow, endRow: range.endRow };
                height = tableIncludesGap ? Math.min(fullHeight, clipBottom) : (headerRowPx + (range.endRow - range.startRow) * rowHeightPx);
                if (pageIndex > 0 || range.startRow > 0) localTop = 0;
              } else if (pageIndex === 0 && rowCount > DATA_TABLE_ATTACHED_LIST_THRESHOLD) {
                tableRowRange = { startRow: 0, endRow: 0 };
                height = headerRowPx + DATA_TABLE_ATTACHED_LIST_GAP_PX;
              }
            }
          }
          if (globalTop < pageTop && !tableRowRange) height = Math.min(fullHeight, singlePageHeight);
          return renderBoxHtml(box, localTop, width, height, tableRowRange, pageIndex, numPages);
        })
        .join('\n');
      const spacerHeight = (dataTableIncludesGapOnFirstPage ? 0 : (dataTableSpacerTop != null && !exportAttachedListMode ? Math.min(EMPTY_BOX_BELOW_TABLE_PX, singlePageHeight - dataTableSpacerTop) : 0));
      const spacerLeft = dataTableSpacerLeft ?? 0;
      const spacerWidth = dataTableSpacerWidth != null ? dataTableSpacerWidth : w;
      const spacerBlock = pageIndex === 0 && dataTableSpacerTop != null && spacerHeight > 0
        ? `<div class="template-box data-table-spacer-box" style="position:absolute;left:${spacerLeft}px;top:${dataTableSpacerTop}px;width:${spacerWidth}px;height:${spacerHeight}px;border:1px solid #000;background:#fff;box-sizing:border-box;"></div>\n`
        : '';
      const titleBlock = `<div class="template-title">${escape(documentTitle)}</div>`;
      const contentW = w - 2 * PAGE_PADDING_PX;
      const contentH = singlePageHeight - 2 * PAGE_PADDING_PX;
      const scaleX = contentW / w;
      const scaleY = contentH / singlePageHeight;
      return `<div class="template-page" style="page-break-after: always; width: ${w}px; height: ${singlePageHeight}px; padding: ${PAGE_PADDING_PX}px; box-sizing: border-box; margin: 20px auto ${PAGE_GAP_BETWEEN_PX}px auto; position: relative; background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,0.1); ${canvasBackgroundImage ? `background-image:url(${canvasBackgroundImage}); background-size:${w}px ${singlePageHeight}px; background-repeat: no-repeat; background-position: top left;` : ''}"><div class="template-page-inner" style="position: absolute; left: ${PAGE_PADDING_PX}px; top: ${PAGE_PADDING_PX}px; width: ${contentW}px; height: ${contentH}px; overflow: hidden;"><div class="template-page-content" style="width: ${w}px; height: ${singlePageHeight}px; transform: scale(${scaleX}, ${scaleY}); transform-origin: 0 0;">${titleBlock}\n${spacerBlock}${boxDivsForPage}</div></div></div>`;
    }).join('\n');

    const templateConfig = {
      boxes: boxes.map((b) => ({
        id: b.id,
        type: b.type,
        position: b.position,
        size: b.size,
        tableConfig: b.tableConfig,
        labelName: b.labelName,
        fieldName: b.fieldName,
        content: b.content,
        properties: b.properties,
        rank: b.rank,
      })),
      w,
      h: singlePageHeight,
      singlePageHeight,
      documentTitle: documentTitle || '',
      TITLE_AREA_HEIGHT,
      PAGE_PADDING_PX,
      PAGE_GAP_BETWEEN_PX,
      DATA_TABLE_HEADER_ROW_PX,
      DATA_TABLE_ROW_HEIGHT_PX,
      DATA_TABLE_SPACER_PX: EMPTY_BOX_BELOW_TABLE_PX,
      GAP_BETWEEN_TABLE_AND_NEXT_FIELD_PX,
      DATA_TABLE_ATTACHED_LIST_THRESHOLD,
      DATA_TABLE_ATTACHED_LIST_GAP_PX,
      headerRowPx: 28,
      rowHeightPx: 22,
      initialData: data,
      contentW: w - 2 * PAGE_PADDING_PX,
      contentH: singlePageHeight - 2 * PAGE_PADDING_PX,
      scaleX: (w - 2 * PAGE_PADDING_PX) / w,
      scaleY: (singlePageHeight - 2 * PAGE_PADDING_PX) / singlePageHeight,
    };
    const templateConfigJson = JSON.stringify(templateConfig).replace(/<\/script/gi, '<\\/script');
    const templateDataJson = JSON.stringify(data).replace(/<\/script/gi, '<\\/script');

    const embeddedScript = `
(function() {
  // Data-driven template: set window.templateData = { ... } then call window.applyTemplateData()
  // to re-render with your data (same rules: <=3 items on first page, >3 use attached list, heading on every page).
  var configEl = document.getElementById('template-config');
  if (!configEl) return;
  var c = JSON.parse(configEl.textContent);
  var boxes = c.boxes;
  var TITLE_AREA = c.TITLE_AREA_HEIGHT;
  var PAGE_PAD = c.PAGE_PADDING_PX;
  var PAGE_GAP = c.PAGE_GAP_BETWEEN_PX;
  var HEADER_PX = c.DATA_TABLE_HEADER_ROW_PX;
  var ROW_PX = c.DATA_TABLE_ROW_HEIGHT_PX;
  var SPACER_PX = c.DATA_TABLE_SPACER_PX;
  var GAP_BETWEEN_PX = c.GAP_BETWEEN_TABLE_AND_NEXT_FIELD_PX != null ? c.GAP_BETWEEN_TABLE_AND_NEXT_FIELD_PX : 8;
  var THRESH = c.DATA_TABLE_ATTACHED_LIST_THRESHOLD;
  var GAP_PX = c.DATA_TABLE_ATTACHED_LIST_GAP_PX;
  var headerRowPx = c.headerRowPx;
  var rowHeightPx = c.rowHeightPx;
  var singlePageHeight = c.singlePageHeight;
  var contentH = c.contentH;
  var w = c.w;

  function getContainerTableRowsFlat(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
    var containersList = Array.isArray(data.containers) ? data.containers : (Array.isArray(data.container) ? data.container : []);
    if (containersList.length === 0) return [];
    var flat = [];
    for (var c = 0; c < containersList.length; c++) {
      var container = containersList[c];
      flat.push({ type: 'container', container: container, item: null });
      var items = Array.isArray(container && container.items) ? container.items : [];
      for (var j = 0; j < items.length; j++) flat.push({ type: 'item', container: container, item: items[j] });
    }
    return flat;
  }
  function getDataTableCellContainerHeading(container, colIndex) {
    if (colIndex !== 0) return '';
    var cn = container && container.container_number;
    var ct = container && container.container_type;
    return (cn && ct) ? cn + ', ' + ct : (cn || ct || '');
  }
  function getDataTableCellContainerItem(item, baseKey) {
    var b = String(baseKey || '').trim().toLowerCase();
    if (b === 'marks_and_numbers') return item && item.marks_and_numbers != null ? String(item.marks_and_numbers) : '';
    if (b === 'kind_no_of_packages' || b === 'kind_&_no_of_packages') return item && item.packages != null ? String(item.packages) : '';
    if (b === 'description_of_goods') return (item && (item.description != null ? item.description : item.commodity)) || '';
    if (b === 'gross_weight_kg' || b === 'gross_weight_(kg)') return item && item.weight != null ? String(item.weight) : '';
    if (b === 'measurements_m' || b === 'measurements_m³' || b === 'measurements_(m³)') return item && item.volume != null ? String(item.volume) : '';
    return '';
  }
  function getDataTableRowMeta(data, columnKeys, row1) {
    var flat = getContainerTableRowsFlat(data);
    if (flat.length === 0) return undefined;
    var row = flat[row1 - 1];
    return row && row.type === 'container' ? { isContainerHeading: true } : undefined;
  }
  function getDataTableRowCount(data, columnKeys) {
    if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(columnKeys) || !columnKeys.length) return 0;
    var containerFlat = getContainerTableRowsFlat(data);
    if (containerFlat.length > 0) return Math.min(500, containerFlat.length);
    var maxN = 0;
    for (var bi = 0; bi < columnKeys.length; bi++) {
      var base = String(columnKeys[bi]).trim();
      if (!base) continue;
      for (var i = 1; i <= 500; i++) {
        if (data[base + '_' + i] === undefined) break;
        maxN = Math.max(maxN, i);
      }
    }
    return Math.min(500, Math.max(0, maxN));
  }
  function getDataTableCell(data, columnKeys, row1, colIndex) {
    if (!data || !columnKeys || !columnKeys[colIndex]) return '';
    var base = String(columnKeys[colIndex] || '').trim();
    var containerFlat = getContainerTableRowsFlat(data);
    if (containerFlat.length > 0) {
      var row = containerFlat[row1 - 1];
      if (row) {
        if (row.type === 'container') return getDataTableCellContainerHeading(row.container, colIndex);
        if (row.type === 'item' && row.item) return getDataTableCellContainerItem(row.item, base) || '';
      }
    }
    var key = base + '_' + row1;
    var v = data[key];
    if (v == null && (base === 'measurements_m' || base === 'measurements_m³')) v = data['measurements_m3_' + row1];
    return v != null ? String(v) : '';
  }
  function getDataTableRowRangeForPage(box, tablePageIndex, rowCount, pageHeightPx) {
    var rowsOnFirst = Math.max(3, Math.max(1, Number(box.tableConfig && box.tableConfig.rowsOnFirstPage) || 3));
    var rowsOnOther = box.tableConfig && box.tableConfig.rowsOnOtherPages != null ? Math.max(1, Number(box.tableConfig.rowsOnOtherPages)) : null;
    var tablePage = Math.max(0, parseInt(tablePageIndex, 10) || 0);
    var useAttached = rowCount > THRESH;
    if (tablePage === 0) {
      if (useAttached) return { startRow: 0, endRow: 0 };
      return { startRow: 0, endRow: Math.min(rowsOnFirst, rowCount) };
    }
    if (useAttached) {
      var rowsPerPage = rowsOnOther != null ? rowsOnOther : Math.max(1, Math.floor((pageHeightPx - HEADER_PX) / ROW_PX));
      var startRow = (tablePage - 1) * rowsPerPage;
      var endRow = Math.min(startRow + rowsPerPage, rowCount);
      return { startRow: Math.min(startRow, rowCount), endRow: Math.max(endRow, startRow) };
    }
    var afterFirst = rowsOnFirst;
    if (afterFirst >= rowCount) return { startRow: rowCount, endRow: rowCount };
    var rpp = rowsOnOther != null ? rowsOnOther : Math.max(1, Math.floor((pageHeightPx - HEADER_PX) / ROW_PX));
    var s = Math.min(rowCount, afterFirst + (tablePage - 1) * rpp);
    var e = Math.min(s + rpp, rowCount);
    return { startRow: s, endRow: Math.max(e, s) };
  }
  function getDataTableFirstSegmentHeight(box, data) {
    if (!box.tableConfig || !Array.isArray(box.tableConfig.columnKeys)) return null;
    var rowCount = getDataTableRowCount(data, box.tableConfig.columnKeys);
    var rowsOnFirst = Math.max(3, Math.max(1, Number(box.tableConfig.rowsOnFirstPage) || 3));
    if (rowCount > THRESH) return HEADER_PX + GAP_PX;
    var rowsToShow = Math.min(rowsOnFirst, Math.max(0, rowCount));
    return HEADER_PX + rowsToShow * ROW_PX;
  }
  function buildLayout(data) {
    data = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    var effectiveHeightByBoxId = {};
    var boxYOffset = {};
    var i, b, t, tEff, tTop, firstBottom, spacerPx, rowCount, minY, offset, bTop, bHeight, bBottom, isDataTable, spacerBottom, minYVal, totalHeight;
    for (i = 0; i < boxes.length; i++) {
      b = boxes[i];
      var designH = Math.max(20, b.size && b.size.height != null ? b.size.height : 20);
      var eff = getDataTableFirstSegmentHeight(b, data);
      effectiveHeightByBoxId[b.id] = eff != null ? Math.max(eff, designH) : designH;
      if (eff != null && b.type === 'table' && b.tableConfig && Array.isArray(b.tableConfig.columnKeys)) {
        rowCount = getDataTableRowCount(data, b.tableConfig.columnKeys);
        var rowsOnFirstB = Math.max(3, Math.max(1, Number(b.tableConfig.rowsOnFirstPage) || 3));
        if (rowCount <= THRESH && rowCount <= rowsOnFirstB) effectiveHeightByBoxId[b.id] += SPACER_PX;
        effectiveHeightByBoxId[b.id] = Math.max(effectiveHeightByBoxId[b.id], designH);
      }
    }
    var isEmpty = function(b) {
      var hasF = (b.fieldName && String(b.fieldName).trim()) || (b.labelName && String(b.labelName).trim());
      var hasC = b.content && String(b.content).trim() && !/^\\{\\{\\s*\\}\\}$/.test(String(b.content).trim());
      return !hasF && !hasC && b.type !== 'table' && b.type !== 'logo';
    };
    for (i = 0; i < boxes.length; i++) {
      t = boxes[i];
      if (t.type !== 'table' || !t.tableConfig || !Array.isArray(t.tableConfig.columnKeys)) continue;
      tEff = effectiveHeightByBoxId[t.id];
      if (tEff == null) continue;
      tTop = (t.position && t.position.y) != null ? t.position.y : 0;
      firstBottom = tTop + tEff;
      rowCount = getDataTableRowCount(data, t.tableConfig.columnKeys);
      var rowsOnFirstT = Math.max(3, Math.max(1, Number(t.tableConfig.rowsOnFirstPage) || 3));
      var tableIncludesGap = rowCount <= THRESH && rowCount <= rowsOnFirstT;
      spacerPx = rowCount > THRESH ? 0 : (tableIncludesGap ? GAP_BETWEEN_PX : SPACER_PX + GAP_BETWEEN_PX);
      for (var j = 0; j < boxes.length; j++) {
        b = boxes[j];
        if (b.id === t.id || b.type === 'table') continue;
        var bTop0 = (b.position && b.position.y) != null ? b.position.y : 0;
        var bH0 = b.size && b.size.height != null ? b.size.height : 20;
        if (spacerPx > 0 && bTop0 < firstBottom + spacerPx && bTop0 + bH0 > firstBottom && isEmpty(b)) effectiveHeightByBoxId[b.id] = 0;
      }
    }
    var minYBelow = {};
    for (i = 0; i < boxes.length; i++) {
      t = boxes[i];
      if (t.type !== 'table' || !t.tableConfig || !Array.isArray(t.tableConfig.columnKeys)) continue;
      tEff = effectiveHeightByBoxId[t.id];
      if (tEff == null) continue;
      tTop = (t.position && t.position.y) != null ? t.position.y : 0;
      firstBottom = tTop + tEff;
      minY = Infinity;
      for (j = 0; j < boxes.length; j++) {
        b = boxes[j];
        if (b.id === t.id) continue;
        var beff = effectiveHeightByBoxId[b.id] != null ? effectiveHeightByBoxId[b.id] : (b.size && b.size.height != null ? b.size.height : 20);
        if (beff <= 0) continue;
        bTop0 = (b.position && b.position.y) != null ? b.position.y : 0;
        var bBottom0 = bTop0 + (b.size && b.size.height != null ? b.size.height : 20);
        if (bTop0 >= firstBottom || bBottom0 > firstBottom) minY = Math.min(minY, bTop0);
      }
      minYBelow[t.id] = minY === Infinity ? null : minY;
    }
    for (i = 0; i < boxes.length; i++) {
      b = boxes[i];
      offset = 0;
      bTop = (b.position && b.position.y) != null ? b.position.y : 0;
      bHeight = effectiveHeightByBoxId[b.id] != null ? effectiveHeightByBoxId[b.id] : (b.size && b.size.height != null ? b.size.height : 20);
      bBottom = bTop + Math.max(0, bHeight);
      for (j = 0; j < boxes.length; j++) {
        t = boxes[j];
        if (t.id === b.id) continue;
        tEff = effectiveHeightByBoxId[t.id];
        var tDesign = (t.size && t.size.height != null) ? t.size.height : 20;
        tTop = (t.position && t.position.y) != null ? t.position.y : 0;
        isDataTable = t.type === 'table' && t.tableConfig && Array.isArray(t.tableConfig.columnKeys);
        if (isDataTable && tEff != null) {
          firstBottom = tTop + tEff;
          rowCount = getDataTableRowCount(data, t.tableConfig.columnKeys);
          rowsOnFirstT = Math.max(3, Math.max(1, Number(t.tableConfig.rowsOnFirstPage) || 3));
          tableIncludesGap = rowCount <= THRESH && rowCount <= rowsOnFirstT;
          spacerPx = rowCount > THRESH ? 0 : (tableIncludesGap ? GAP_BETWEEN_PX : SPACER_PX + GAP_BETWEEN_PX);
          spacerBottom = firstBottom + spacerPx;
          minYVal = minYBelow[t.id];
          if (bTop >= firstBottom) offset += minYVal != null ? spacerBottom - minYVal : (tEff + spacerPx) - tDesign;
          else if (bBottom > firstBottom) offset += Math.max(0, spacerBottom - bTop);
          else if (bTop < firstBottom && bBottom > tTop) offset += Math.max(0, spacerBottom - bTop);
        } else if (tEff != null && tEff > tDesign && bTop >= tTop + tDesign) offset += tEff - tDesign;
      }
      boxYOffset[b.id] = offset;
    }
    totalHeight = singlePageHeight;
    for (i = 0; i < boxes.length; i++) {
      b = boxes[i];
      var top = ((b.position && b.position.y) != null ? b.position.y : 0) + (boxYOffset[b.id] || 0);
      var h = effectiveHeightByBoxId[b.id] != null ? effectiveHeightByBoxId[b.id] : (b.size && b.size.height != null ? b.size.height : 20);
      totalHeight = Math.max(totalHeight, top + h);
    }
    for (i = 0; i < boxes.length; i++) {
      b = boxes[i];
      if (b.type !== 'table' || !b.tableConfig || !Array.isArray(b.tableConfig.columnKeys)) continue;
      var tableTop = ((b.position && b.position.y) != null ? b.position.y : 0) + (boxYOffset[b.id] || 0);
      var firstSeg = effectiveHeightByBoxId[b.id] || 0;
      rowCount = getDataTableRowCount(data, b.tableConfig.columnKeys);
      var useAtt = rowCount > THRESH;
      totalHeight = Math.max(totalHeight, tableTop + firstSeg);
      if (useAtt && rowCount > 0) {
        var tp = 1;
        while (true) {
          var r = getDataTableRowRangeForPage(b, tp, rowCount, contentH);
          if (r.endRow <= r.startRow) break;
          totalHeight = Math.max(totalHeight, tp * singlePageHeight + HEADER_PX + (r.endRow - r.startRow) * ROW_PX);
          if (r.endRow >= rowCount) break;
          tp++;
        }
      }
    }
    var numPages = Math.max(1, Math.ceil(totalHeight / singlePageHeight));
    var dataTableSpacerTop = null, dataTableSpacerLeft = 0, dataTableSpacerWidth = null, exportAttached = false, dataTableIncludesGapOnFirstPage = false;
    var dataTables = boxes.filter(function(x) { return x.type === 'table' && x.tableConfig && Array.isArray(x.tableConfig.columnKeys); });
    if (dataTables.length > 0) {
      var first = dataTables[0];
      for (var di = 1; di < dataTables.length; di++) {
        var gy = (dataTables[di].position && dataTables[di].position.y != null ? dataTables[di].position.y : 0) + (boxYOffset[dataTables[di].id] || 0);
        var firstGy = (first.position && first.position.y != null ? first.position.y : 0) + (boxYOffset[first.id] || 0);
        if (gy < firstGy) first = dataTables[di];
      }
      dataTableSpacerTop = (first.position && first.position.y != null ? first.position.y : 0) + (boxYOffset[first.id] || 0) + (effectiveHeightByBoxId[first.id] != null ? effectiveHeightByBoxId[first.id] : (first.size && first.size.height != null ? first.size.height : 20));
      dataTableSpacerLeft = (first.position && first.position.x != null) ? first.position.x : 0;
      dataTableSpacerWidth = first.size && first.size.width != null ? first.size.width : null;
      rowCount = getDataTableRowCount(data, first.tableConfig.columnKeys || []);
      exportAttached = rowCount > THRESH;
      dataTableIncludesGapOnFirstPage = rowCount <= THRESH && rowCount <= Math.max(3, Math.max(1, Number(first.tableConfig && first.tableConfig.rowsOnFirstPage) || 3));
    }
    return { boxYOffset: boxYOffset, effectiveHeightByBoxId: effectiveHeightByBoxId, numPages: numPages, dataTableSpacerTop: dataTableSpacerTop, dataTableSpacerLeft: dataTableSpacerLeft, dataTableSpacerWidth: dataTableSpacerWidth, exportAttachedListMode: exportAttached, dataTableIncludesGapOnFirstPage: dataTableIncludesGapOnFirstPage };
  }
  function escapeHtml(s) {
    s = String(s == null ? '' : s);
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function findDataValue(data, key) {
    if (data[key] !== undefined && data[key] !== null) return data[key];
    var keyLower = key.toLowerCase();
    for (var dk in data) { if (Object.prototype.hasOwnProperty.call(data, dk) && dk.toLowerCase() === keyLower) return data[dk]; }
    return undefined;
  }
  function replacePlaceholders(content, data) {
    if (!content || typeof content !== 'string') return '';
    data = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    return content.replace(/\\{\\{([^}]+)\\}\\}/g, function(match, key) {
      var k = key.trim();
      var val = findDataValue(data, k);
      return val !== undefined && val !== null ? String(val) : '';
    });
  }
  function render(data) {
    data = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    var layout = buildLayout(data);
    var boxYOffset = layout.boxYOffset;
    var effectiveHeightByBoxId = layout.effectiveHeightByBoxId;
    var numPages = layout.numPages;
    var dataTableSpacerTop = layout.dataTableSpacerTop;
    var dataTableSpacerLeft = layout.dataTableSpacerLeft;
    var dataTableSpacerWidth = layout.dataTableSpacerWidth;
    var exportAttached = layout.exportAttachedListMode;
    var includesGapOnFirstPage = layout.dataTableIncludesGapOnFirstPage === true;
    var sorted = boxes.slice().sort(function(a, b) { return (a.rank || 0) - (b.rank || 0); });
    var contentW = c.w - 2 * PAGE_PAD;
    var scaleX = contentW / c.w;
    var scaleY = contentH / singlePageHeight;
    var out = [];
    for (var pageIndex = 0; pageIndex < numPages; pageIndex++) {
      var pageTop = pageIndex * singlePageHeight;
      var pageBottom = (pageIndex + 1) * singlePageHeight;
      var titleBlock = '<div class="template-title">' + escapeHtml(c.documentTitle) + '</div>';
      var spacerHeight = includesGapOnFirstPage ? 0 : (dataTableSpacerTop != null && !exportAttached ? Math.min(SPACER_PX, singlePageHeight - dataTableSpacerTop) : 0);
      var spacerBlock = (pageIndex === 0 && dataTableSpacerTop != null && spacerHeight > 0) ? '<div class="template-box data-table-spacer-box" style="position:absolute;left:' + dataTableSpacerLeft + 'px;top:' + dataTableSpacerTop + 'px;width:' + (dataTableSpacerWidth != null ? dataTableSpacerWidth : w) + 'px;height:' + spacerHeight + 'px;border:1px solid #000;background:#fff;box-sizing:border-box;"></div>\\n' : '';
      var boxDivs = [];
      for (var bi = 0; bi < sorted.length; bi++) {
        var box = sorted[bi];
        var globalTop = ((box.position && box.position.y) != null ? box.position.y : 0) + (boxYOffset[box.id] || 0);
        if (box.type === 'table' && box.tableConfig && Array.isArray(box.tableConfig.columnKeys)) {
          var rc = getDataTableRowCount(data, box.tableConfig.columnKeys);
          var range = getDataTableRowRangeForPage(box, pageIndex, rc, contentH);
          if (range.endRow <= range.startRow && !(pageIndex === 0 && rc > THRESH) && !(pageIndex === 0 && rc === 0)) continue;
        } else {
          var boxH = effectiveHeightByBoxId[box.id] != null ? effectiveHeightByBoxId[box.id] : (box.size && box.size.height != null ? box.size.height : 20);
          if (boxH <= 0) continue;
          if (globalTop + boxH <= pageTop || globalTop >= pageBottom) continue;
        }
        var width = (box.size && box.size.width != null) ? box.size.width : (box.type === 'table' ? 600 : 60);
        var fullHeight = effectiveHeightByBoxId[box.id] != null ? effectiveHeightByBoxId[box.id] : (box.size && box.size.height != null ? box.size.height : 20);
        var clipBottom = pageBottom - globalTop;
        var height = Math.min(fullHeight, clipBottom);
        var tableRowRange = null;
        var localTop = Math.max(0, globalTop - pageTop);
        if (box.type === 'table' && box.tableConfig && Array.isArray(box.tableConfig.columnKeys)) {
          rc = getDataTableRowCount(data, box.tableConfig.columnKeys);
          if (rc > 0) {
            range = getDataTableRowRangeForPage(box, pageIndex, rc, contentH);
            var rowsOnFirstBox = Math.max(3, Math.max(1, Number(box.tableConfig && box.tableConfig.rowsOnFirstPage) || 3));
            var tableIncludesGapEmbed = pageIndex === 0 && rc <= THRESH && rc <= rowsOnFirstBox;
            if (range.endRow > range.startRow) {
              tableRowRange = range;
              height = tableIncludesGapEmbed ? Math.min(fullHeight, clipBottom) : (headerRowPx + (range.endRow - range.startRow) * rowHeightPx);
              if (pageIndex > 0 || range.startRow > 0) localTop = 0;
            } else if (pageIndex === 0 && rc > THRESH) {
              tableRowRange = { startRow: 0, endRow: 0 };
              height = headerRowPx + GAP_PX;
            }
          }
        }
        if (globalTop < pageTop && !tableRowRange) height = Math.min(fullHeight, singlePageHeight);
        var left = (box.position && box.position.x != null) ? box.position.x : 0;
        if (box.type === 'table' && box.tableConfig && Array.isArray(box.tableConfig.columnKeys)) {
          var columnKeys = box.tableConfig.columnKeys;
          var rowCount = getDataTableRowCount(data, columnKeys);
          var colCount = columnKeys.length;
          var colWidths = (box.tableConfig.columnWidths && Array.isArray(box.tableConfig.columnWidths) && box.tableConfig.columnWidths.length === colCount) ? box.tableConfig.columnWidths : Array.from({ length: colCount }, function() { return 100 / colCount; });
          var cellWrap = 'word-break:break-word;overflow-wrap:break-word;white-space:normal;';
          var cellWrapPreLine = 'word-break:break-word;overflow-wrap:break-word;white-space:pre-line;';
          var colgroup = colWidths.map(function(pct) { return '<col style="width:' + Math.max(1, Math.min(100, Number(pct) || 100 / colCount)) + '%">'; }).join('');
          var headers = (box.tableConfig.headers || []).map(function(hd) { return '<th style="border:1px solid #000;padding:4px;text-align:left;background:#f0f0f0;' + cellWrap + '">' + escapeHtml(hd || '') + '</th>'; }).join('');
          var r = tableRowRange || { startRow: 0, endRow: rowCount };
          var bodyRows = '';
          if (rowCount === 0) bodyRows = '<tr><td colspan="' + columnKeys.length + '" style="border:none;padding:8px;">No data rows</td></tr>';
          else if (rowCount > THRESH && r.endRow === r.startRow) bodyRows = '<tr style="height:' + GAP_PX + 'px"><td colspan="' + columnKeys.length + '" style="border:none;padding:8px;font-style:italic;text-align:center;vertical-align:bottom;height:' + GAP_PX + 'px;">Find the details of elements in attached list.</td></tr>';
          else {
            for (var ri = r.startRow; ri < r.endRow; ri++) {
              var rowMeta = getDataTableRowMeta(data, columnKeys, ri + 1);
              var trStyle = rowMeta && rowMeta.isContainerHeading ? 'font-weight:bold;' : '';
              var cells = [];
              for (var ci = 0; ci < columnKeys.length; ci++) {
                var cellBold = rowMeta && rowMeta.isContainerHeading && ci === 0 ? 'font-weight:bold;' : '';
                cells.push('<td style="border:none;padding:4px;' + cellBold + cellWrapPreLine + '">' + escapeHtml(getDataTableCell(data, columnKeys, ri + 1, ci)) + '</td>');
              }
              bodyRows += '<tr style="' + trStyle + '">' + cells.join('') + '</tr>';
            }
          }
          var tableBorderEmbed = tableIncludesGapEmbed ? 'border:none;' : '';
          var tableHtml = '<table style="width:100%;border-collapse:collapse;table-layout:fixed;font-size:' + (box.properties && box.properties.fontSize != null ? box.properties.fontSize : 11) + 'px;' + tableBorderEmbed + '"><colgroup>' + colgroup + '</colgroup><thead><tr>' + headers + '</tr></thead><tbody>' + bodyRows + '</tbody></table>';
          var gapBlockEmbed = tableIncludesGapEmbed ? ('<div class="data-table-gap-inside" style="width:100%;height:' + SPACER_PX + 'px;flex-shrink:0;"></div>') : '';
          boxDivs.push('<div class="template-box template-box-table" style="position:absolute;left:' + left + 'px;top:' + localTop + 'px;width:' + width + 'px;height:' + height + 'px;padding:4px;box-sizing:border-box;overflow:visible;border:1px solid #000;display:flex;flex-direction:column;">' + tableHtml + gapBlockEmbed + '</div>');
        } else {
          var rawLabel = box.labelName || (box.fieldName ? String(box.fieldName).replace(/_/g, ' ').replace(/\\b\\w/g, function(ch) { return ch.toUpperCase(); }) : '');
          var label = (rawLabel && String(rawLabel).trim().slice(-3) === '...' && box.fieldName) ? String(box.fieldName).replace(/_/g, ' ').replace(/\\b\\w/g, function(ch) { return ch.toUpperCase(); }) : rawLabel;
          var labelOnly = !!(box.properties && box.properties.labelOnly);
          var valueOnly = !!(box.properties && box.properties.valueOnly);
          var emptyBox = !!(box.properties && box.properties.emptyBox);
          var rawPlaceholder = box.content || '{{' + (box.fieldName || 'field') + '}}';
          var dataWithPages = {};
          for (var dk in data) { if (Object.prototype.hasOwnProperty.call(data, dk)) dataWithPages[dk] = data[dk]; }
          dataWithPages.pages = (pageIndex + 1) + ' of ' + numPages;
          var displayValue = replacePlaceholders(rawPlaceholder, dataWithPages);
          var valueEmpty = String(displayValue).trim() === '';
          var showPlaceholderWhenEmpty = rawPlaceholder && /\\{\\{/.test(rawPlaceholder);
          var valueToShow = valueEmpty && showPlaceholderWhenEmpty ? rawPlaceholder : displayValue;
          var valueToShowEmpty = String(valueToShow).trim() === '';
          var content = emptyBox ? '' : (valueOnly ? (valueToShowEmpty ? '' : escapeHtml(valueToShow)) : (labelOnly && label ? escapeHtml(label) : (label ? (valueToShowEmpty ? escapeHtml(label) + ':' : escapeHtml(label) + ': ' + escapeHtml(valueToShow)) : (valueToShowEmpty ? '' : escapeHtml(valueToShow)))));
          var border = '1px solid #000';
          boxDivs.push('<div class="template-box" style="position:absolute;left:' + left + 'px;top:' + localTop + 'px;width:' + width + 'px;height:' + height + 'px;font-size:' + (box.properties && box.properties.fontSize != null ? box.properties.fontSize : 10) + 'px;font-family:' + escapeHtml(box.properties && box.properties.fontFamily || 'Arial') + ';color:' + escapeHtml(box.properties && box.properties.fontColor || '#000') + ';border-left:' + border + ';border-right:' + border + ';border-top:' + border + ';border-bottom:' + border + ';padding:4px;box-sizing:border-box;white-space:normal;word-break:break-word;overflow-wrap:break-word;overflow:visible;text-overflow:clip;">' + content + '</div>');
        }
      }
      out.push('<div class="template-page" style="page-break-after:always;width:' + w + 'px;height:' + singlePageHeight + 'px;padding:' + PAGE_PAD + 'px;box-sizing:border-box;margin:20px auto ' + PAGE_GAP + 'px auto;position:relative;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,0.1);"><div class="template-page-inner" style="position:absolute;left:' + PAGE_PAD + 'px;top:' + PAGE_PAD + 'px;width:' + contentW + 'px;height:' + contentH + 'px;overflow:hidden;"><div class="template-page-content" style="width:' + w + 'px;height:' + singlePageHeight + 'px;transform:scale(' + scaleX + ',' + scaleY + ');transform-origin:0 0;">' + titleBlock + '\\n' + spacerBlock + boxDivs.join('\\n') + '</div></div></div>');
    }
    return out.join('');
  }
  function getDataToRender() {
    if (window.templateData !== undefined && window.templateData !== null) return window.templateData;
    var dataEl = document.getElementById('template-data');
    if (dataEl && dataEl.textContent) {
      try { return JSON.parse(dataEl.textContent); } catch (e) {}
    }
    return c.initialData || {};
  }
  var root = document.getElementById('template-root');
  if (root) root.innerHTML = render(getDataToRender());
  window.applyTemplateData = function() {
    var r = document.getElementById('template-root');
    if (r) r.innerHTML = render(getDataToRender());
  };
  window.loadTemplateDataFromJson = function(jsonStr) {
    try {
      window.templateData = JSON.parse(jsonStr);
      window.applyTemplateData();
      return true;
    } catch (e) {
      console.error('Invalid JSON:', e);
      return false;
    }
  };
})();
`.replace(/\n/g, '\n    ');

    const bgStyle = canvasBackgroundImage
      ? `background-image:url(${canvasBackgroundImage});background-size:100% 100%;background-repeat:no-repeat;background-position:top left;`
      : '';
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escape(templateName || documentTitle || 'Template')}</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; }
    .template-page { position: relative; }
    .template-title { position: absolute; top: 0; left: 0; right: 0; font-weight: bold; text-align: center; padding: 10px 0; }
    .template-box { overflow: visible; white-space: normal; word-break: break-word; overflow-wrap: break-word; text-overflow: clip; }
    .template-box-table { overflow: visible; }
    @media print {
      .template-page { page-break-after: always; margin-bottom: 0 !important; }
      .template-page:last-child { page-break-after: auto; }
      .template-page:not(:first-child) { padding-top: ${PAGE_GAP_BETWEEN_PX}px !important; }
    }
  </style>
</head>
<body>
  <!--
  EXPORT HTML - Data injection supported for use in other modules.
  Supported: multiple data table rows (e.g. marks_and_numbers_1..N), Label only / Value only per box, placeholders {{key}}, pages.
  HOW TO LOAD / PASS DATA:
  Option 1 - Use the "Load custom data" panel below: paste JSON and click Apply data (no console needed).
  Option 2 - Data is in the script tag id="template-data". Replace that JSON in the file to change default data.
  Option 3 - In console: window.loadTemplateDataFromJson('{"port_of_loading":"NY","marks_and_numbers_1":"1-UP",...}'); or set window.templateData then window.applyTemplateData();
  -->
  <!-- Load custom data / Apply data section commented out - export shows template only
  <div id="template-data-panel" style="max-width:900px;margin:10px auto;padding:12px;background:#f5f5f5;border:1px solid #ccc;border-radius:6px;font-family:Arial,sans-serif;">
    <button type="button" id="template-data-toggle" style="padding:8px 14px;cursor:pointer;background:#333;color:#fff;border:none;border-radius:4px;font-size:14px;">Load custom data (paste JSON)</button>
    <div id="template-data-form" style="display:none;margin-top:12px;">
      <textarea id="template-data-json" placeholder='Paste your JSON here, e.g. {"port_of_loading":"New York","marks_and_numbers_1":"1-UP",...}' style="width:100%;min-height:120px;padding:8px;box-sizing:border-box;font-family:monospace;font-size:12px;"></textarea>
      <button type="button" id="template-data-apply" style="margin-top:8px;padding:8px 16px;cursor:pointer;background:#0a7;color:#fff;border:none;border-radius:4px;font-size:14px;">Apply data</button>
      <span id="template-data-msg" style="margin-left:10px;font-size:13px;"></span>
    </div>
  </div>
  -->
  <div id="template-root">${pageDivs}</div>
  <script type="application/json" id="template-data">${templateDataJson}</script>
  <script type="application/json" id="template-config">${templateConfigJson}</script>
  <script>${embeddedScript}</script>
  <!-- Apply data / Load custom data panel script commented out - export shows template only
  <script>
    (function(){
      var toggle = document.getElementById('template-data-toggle');
      var form = document.getElementById('template-data-form');
      var ta = document.getElementById('template-data-json');
      var applyBtn = document.getElementById('template-data-apply');
      var msg = document.getElementById('template-data-msg');
      if (toggle && form) toggle.addEventListener('click', function(){
        form.style.display = form.style.display === 'none' ? 'block' : 'none';
        if (ta && !ta.value) {
          var dataEl = document.getElementById('template-data');
          if (dataEl && dataEl.textContent) ta.value = dataEl.textContent.trim();
        }
      });
      if (applyBtn && ta && msg) applyBtn.addEventListener('click', function(){
        msg.textContent = '';
        try {
          var data = JSON.parse(ta.value);
          window.templateData = data;
          if (typeof window.applyTemplateData === 'function') window.applyTemplateData();
          msg.textContent = 'Data applied.';
          msg.style.color = '#0a7';
        } catch (e) {
          msg.textContent = 'Invalid JSON: ' + e.message;
          msg.style.color = '#c00';
        }
      });
    })();
  </script>
  -->
</body>
</html>`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(templateName || 'template').replace(/[^a-zA-Z0-9_-]/g, '_')}.html`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('HTML exported successfully.');
  };

  /** Collect only variable names that are actually present in this template (from boxes on canvas). No demo-data or other extra fields. */
  const handleExportVariables = () => {
    const data = demoData && typeof demoData === 'object' && !Array.isArray(demoData) ? demoData : {};
    const nameSet = new Set();
    const nameToLabel = {};
    boxes.forEach((box) => {
      if (box.type === 'table' && box.tableConfig && Array.isArray(box.tableConfig.columnKeys)) {
        (box.tableConfig.columnKeys || []).forEach((baseKey) => {
          const k = String(baseKey || '').trim();
          if (k) {
            nameSet.add(k);
            const header = (box.tableConfig.headers && box.tableConfig.headers[box.tableConfig.columnKeys.indexOf(baseKey)]) || k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
            if (!nameToLabel[k]) nameToLabel[k] = header;
          }
        });
      } else if (box.type === 'logo' || box.type === 'text') {
        const hasExplicitField = box.fieldName && String(box.fieldName).trim();
        const content = box.content || (hasExplicitField ? `{{${box.fieldName}}}` : '');
        const placeholderKeys = extractPlaceholderKeys(content);
        placeholderKeys.forEach((key) => {
          const isDefaultPlaceholder = key === 'field' && !hasExplicitField;
          if (!isDefaultPlaceholder && key) {
            nameSet.add(key);
            const label = box.labelName || key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
            if (!nameToLabel[key]) nameToLabel[key] = label;
          }
        });
        if (hasExplicitField) {
          const k = box.fieldName.trim();
          nameSet.add(k);
          if (!nameToLabel[k]) nameToLabel[k] = box.labelName || box.fieldName.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
        }
      }
    });
    const humanize = (name) => nameToLabel[name] || name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const variables = Array.from(nameSet)
      .sort((a, b) => a.localeCompare(b))
      .map((name) => {
        let example = data[name];
        if (example == null && data[`${name}_1`] != null) example = data[`${name}_1`];
        const item = { name, required: false, description: humanize(name) };
        if (example != null && String(example).trim() !== '') item.example = String(example).trim();
        return item;
      });
    const json = JSON.stringify(variables, null, 2);
    setExportVariablesJson(json);
    setShowExportVariablesModal(true);
  };

  const handleCopyExportVariables = async () => {
    try {
      await navigator.clipboard.writeText(exportVariablesJson);
      toast.success('Variables copied to clipboard.');
    } catch (e) {
      toast.error('Copy failed.');
    }
  };

  const handleCsvStructureImport = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      setLoading(true);
      const response = await csvService.importStructure(file);
      const { boxes: importedBoxes, templateName: importedTemplateName } = response.data;
      // Place all boxes below the document title / black line (no overlap with template name)
      const list = importedBoxes || [];
      const minY = list.length ? Math.min(...list.map((b) => b.position?.y ?? 0)) : 0;
      const offsetY = minY < TITLE_AREA_HEIGHT ? TITLE_AREA_HEIGHT - minY : 0;
      const offsetBoxes = offsetY > 0
        ? list.map((b) => ({
            ...b,
            position: { ...b.position, x: b.position?.x ?? 0, y: (b.position?.y ?? 0) + offsetY },
          }))
        : list;
      // Remove big vertical gaps: compact rows so they sit one under the other with minimal gap
      const compactedBoxes = compactVerticalLayout(offsetBoxes, TITLE_AREA_HEIGHT);
      setBoxes(compactedBoxes);
      const maxRank = Math.max(...compactedBoxes.map((b) => b.rank || 0), 0);
      setNextRank(maxRank + 1);
      if (importedTemplateName) {
        setDocumentTitle(importedTemplateName);
        setTemplateName(importedTemplateName);
      }
      toast.success(`Imported ${compactedBoxes.length} boxes from CSV. Save to create or update the template.`);
    } catch (err) {
      console.error('CSV import error:', err);
      const msg = err.response?.data?.message || err.response?.data?.error || err.message || 'Failed to import CSV structure';
      toast.error(msg);
    } finally {
      setLoading(false);
      event.target.value = '';
    }
  };

  const handlePdfTemplateImport = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      setLoading(true);
      const response = await pdfService.importTemplate(file);
      const { boxes: importedBoxes, templateName: importedTemplateName, pageSize: importedPageSize, orientation: importedOrientation, message } = response;
      if (message && (!importedBoxes || importedBoxes.length === 0)) {
        toast.info(message);
        setLoading(false);
        event.target.value = '';
        return;
      }
      const list = importedBoxes || [];
      setCanvasBackgroundImage(''); // No template background—show only the field boxes
      const minY = list.length ? Math.min(...list.map((b) => b.position?.y ?? 0)) : 0;
      const offsetY = minY < TITLE_AREA_HEIGHT ? TITLE_AREA_HEIGHT - minY : 0;
      const boxesToUse = offsetY > 0
        ? list.map((b) => ({
            ...b,
            position: { ...b.position, x: b.position?.x ?? 0, y: (b.position?.y ?? 0) + offsetY },
          }))
        : list;
      setBoxes(boxesToUse);
      setNextRank(Math.max(...boxesToUse.map((b) => b.rank || 0), 0) + 1);
      const firstBox = boxesToUse[0];
      if (firstBox?.properties?.fontSize != null) {
        setGlobalFontSize(Math.max(6, Math.min(72, firstBox.properties.fontSize)));
      }
      if (firstBox?.properties?.fontFamily) {
        setGlobalFontFamily(firstBox.properties.fontFamily);
      }
      if (importedTemplateName) {
        setDocumentTitle(importedTemplateName);
        setTemplateName(importedTemplateName);
      }
      if (importedPageSize) setPageSize(importedPageSize);
      if (importedOrientation) setOrientation(importedOrientation);
      toast.success(`Imported ${boxesToUse.length} fields from PDF. Save to create or update the template.`);
    } catch (err) {
      console.error('PDF import error:', err);
      const msg = err.response?.data?.message || err.response?.data?.error || err.message || 'Failed to import PDF template';
      toast.error(msg);
    } finally {
      setLoading(false);
      event.target.value = '';
    }
  };

  const handleLoadTemplate = async (id) => {
    try {
      setLoading(true);
      setCanvasBackgroundImage(null);
      const res = await templateService.getTemplate(id);
      const t = res.data;
      setTemplateName(t.name);
      setDocumentTitle(t.settings?.title || t.name);
      setPageSize(t.settings?.pageSize || 'A4');
      setOrientation(t.settings?.orientation || 'portrait');
      setTemplateOutlineMode(t.settings?.outlineMode || 'none');
      setTableMode(t.settings?.tableMode || 'static');
      setMaxDynamicColumns(t.settings?.maxDynamicColumns ?? 10);
      let designBoxes = [];
      if (t.pages?.[0]?.boxes) {
        designBoxes = t.pages[0].boxes.map((b) => {
          const base = { ...b, properties: { ...b.properties, contentPosition: { x: 0, y: 0 } } };
          if (b.type === 'table' && b.tableConfig?.dynamicRowsFromData && b.tableConfig) {
            base.tableConfig = { ...b.tableConfig, rowsOnFirstPage: b.tableConfig.rowsOnFirstPage ?? 3 };
          }
          return base;
        });
        setBoxes(designBoxes);
        setNextRank(Math.max(...designBoxes.map((b) => b.rank || 0), 0) + 1);
      } else setBoxes([]);
      setSelection([]);
      setCurrentTemplateId(t.id);
      setLastSavedDesignSnapshot(JSON.stringify({
        boxes: designBoxes,
        documentTitle: t.settings?.title ?? t.name,
        templateName: t.name,
        pageSize: t.settings?.pageSize ?? 'A4',
        orientation: t.settings?.orientation ?? 'portrait',
        templateOutlineMode: t.settings?.outlineMode ?? 'none',
        tableMode: t.settings?.tableMode ?? 'static',
        maxDynamicColumns: t.settings?.maxDynamicColumns ?? 10,
      }));
      if (t.standardizedTemplateId) {
        setEditorMode('standardized');
        setSelectedStandardizedId(t.standardizedTemplateId);
      }
      toast.success('Template loaded.');
    } catch (err) {
      logger.error('Load template failed', err);
      toast.error('Failed to load template');
    } finally {
      setLoading(false);
    }
  };

  const handleLoadDesign = async (id) => {
    try {
      setLoading(true);
      const res = await templateDesignService.getById(id);
      const d = res.data;
      if (d?.design?.pages?.[0]?.boxes) {
        const defaultProps = { fontSize: 12, fontFamily: 'Arial', fontWeight: 'normal', fontColor: '#000000', backgroundColor: 'transparent', alignment: 'left', contentPosition: { x: 0, y: 0 }, border: true };
        const designBoxes = d.design.pages[0].boxes.map((b) => ({
          id: b.id || `box_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          position: b.position || { x: 0, y: 0 },
          size: b.size || { width: 120, height: 20 },
          type: b.type || 'text',
          rank: b.rank ?? 0,
          ...(b.type === 'table' && b.tableConfig ? { tableConfig: { ...b.tableConfig, rowsOnFirstPage: b.tableConfig.rowsOnFirstPage ?? 3 } } : {}),
          fieldName: '',
          labelName: '',
          content: '',
          properties: { ...defaultProps, contentPosition: { x: 0, y: 0 } },
        }));
        setBoxes(designBoxes);
        setNextRank(Math.max(...designBoxes.map((b) => b.rank || 0), 0) + 1);
        setSelection([]);
        setSelectedDesignId(id);
        toast.success('Design loaded.');
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to load design');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveDesignModalSave = async () => {
    const name = saveDesignName.trim() || 'Untitled design';
    try {
      setSavingDesign(true);
      const layoutOnly = boxesToLayoutOnly(boxes);
      await templateDesignService.create({
        name,
        standardizedTemplateId: selectedStandardizedId || null,
        design: { pages: [{ pageNumber: 1, boxes: layoutOnly }] },
        settings: { pageSize, orientation },
      });
      setShowSaveDesignModal(false);
      setSaveDesignName('');
      toast.success('Design saved successfully.');
      templateDesignService.list().then((r) => setTemplateDesignsList(Array.isArray(r.data) ? r.data : [])).catch(() => {});
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Failed to save design');
    } finally {
      setSavingDesign(false);
    }
  };

  const buildPayload = (name, documentNameVal, boxesData) => ({
    name: name || templateName,
    documentName: documentNameVal != null ? documentNameVal : documentTitle,
    description: '',
    standardizedTemplateId: selectedStandardizedId || null,
    settings: {
      orientation,
      pageSize,
      margins: { top: 5, bottom: 5, left: 5, right: 5 },
      title: documentNameVal != null ? documentNameVal : documentTitle,
      outlineMode: templateOutlineMode,
      tableMode: tableMode,
      maxDynamicColumns: maxDynamicColumns,
    },
    pages: [{ pageNumber: 1, boxes: boxesData || boxes }],
  });

  const handleSave = async () => {
    try {
      setSaving(true);
      const payload = buildPayload(templateName, documentTitle, boxes);
      if (currentTemplateId) {
        await templateService.updateTemplate(currentTemplateId, payload);
        toast.success('Template updated.');
      } else {
        const res = await templateService.createTemplate(payload);
        setCurrentTemplateId(res.data.id);
        toast.success('Template saved.');
      }
      if (wakaToken) {
        const wakaRes = await saveToWaka(wakaToken, { ...payload, template_name: payload.name, template_code: payload.documentName ? String(payload.documentName).trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') : undefined });
        if (wakaRes.success) toast.success('Template also saved to Waka.');
        else if (wakaRes.error) toast.error(`Waka: ${wakaRes.error}`);
      }
      setLastSavedDesignSnapshot(currentDesignSnapshot);
      fetchTemplateCount();
    } catch (err) {
      logger.error('Save template failed', err);
      let msg = err.response?.data?.message || err.message || 'Failed to save';
      if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
        msg = 'Request timed out. Ensure the backend is running (npm run dev in the backend folder).';
      } else if (err.message === 'Network Error' || err.code === 'ERR_NETWORK') {
        msg = 'Cannot reach backend. Ensure the backend is running (npm run dev in the backend folder).';
      }
      const invalidKeys = err.response?.data?.invalidKeys;
      toast.error(invalidKeys?.length ? `${msg} Invalid keys: ${invalidKeys.join(', ')}` : msg);
    } finally {
      setSaving(false);
    }
  };

  const labelToKey = (label) => {
    if (!label || typeof label !== 'string') return '';
    return String(label)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '') || '';
  };

  const openSaveTemplateModal = () => {
    setSaveModalTemplateName(templateName);
    setSaveModalDocumentName(documentTitle);
    const kv = boxes.map((b, index) => {
      const key =
        (b.fieldName && String(b.fieldName).trim()) ||
        (b.labelName ? labelToKey(b.labelName) : '') ||
        `field_${b.rank ?? index + 1}`;
      const value =
        b.content != null && String(b.content).trim() !== ''
          ? b.content
          : `{{${(b.fieldName && String(b.fieldName).trim()) || key}}}`;
      return { boxId: b.id, key, value };
    });
    setSaveModalKeyValues(kv.length > 0 ? kv : [{ boxId: null, key: '', value: '{{}}' }]);
    setShowSaveTemplateModal(true);
  };

  const updateSaveModalKeyValue = (index, field, val) => {
    setSaveModalKeyValues((prev) => {
      const next = [...prev];
      if (!next[index]) next[index] = { boxId: null, key: '', value: '{{}}' };
      next[index] = { ...next[index], [field]: val };
      return next;
    });
  };

  const removeSaveModalRow = (index) => {
    setSaveModalKeyValues((prev) => {
      const next = prev.filter((_, i) => i !== index);
      return next.length ? next : [{ boxId: null, key: '', value: '{{}}' }];
    });
  };

  const addSaveModalRow = () => {
    setSaveModalKeyValues((prev) => [...prev, { boxId: null, key: '', value: '{{}}' }]);
  };

  const getUpdatedBoxesFromModalKeyValues = (currentBoxes, keyValues) => {
    const byBoxId = new Map(keyValues.filter((kv) => kv.boxId).map((kv) => [kv.boxId, kv]));
    const updatedExisting = currentBoxes
      .filter((b) => byBoxId.has(b.id))
      .map((b) => {
        const kv = byBoxId.get(b.id);
        const newKey = (kv.key && String(kv.key).trim()) || b.fieldName || '';
        const newValue = kv.value != null ? String(kv.value) : b.content;
        return { ...b, fieldName: newKey, content: newValue };
      });
    const maxRank = Math.max(...updatedExisting.map((b) => b.rank || 0), 0);
    const newRows = keyValues.filter((kv) => !kv.boxId && (kv.key && String(kv.key).trim()));
    const canvasDims = getCanvasDimensions();
    const TITLE_AREA = 90;
    let nextY = TITLE_AREA + 20;
    const newBoxes = newRows.map((kv, i) => {
      const key = String(kv.key).trim();
      const value = kv.value != null && String(kv.value).trim() !== '' ? kv.value : `{{${key}}}`;
      const newBox = {
        id: `box_new_${Date.now()}_${i}`,
        type: 'text',
        rank: maxRank + i + 1,
        position: { x: 20, y: nextY },
        size: { width: 200, height: 20 },
        labelName: key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        content: value,
        fieldName: key,
        properties: {
          fontSize: globalFontSize,
          fontFamily: globalFontFamily,
          fontWeight: 'normal',
          fontColor: '#000000',
          backgroundColor: 'transparent',
          alignment: 'left',
          contentPosition: { x: 0, y: 0 },
          border: true,
        },
      };
      nextY += 28;
      return newBox;
    });
    return [...updatedExisting, ...newBoxes];
  };

  const handleSaveTemplateModalSave = async () => {
    const name = saveModalTemplateName.trim() || templateName;
    const docName = saveModalDocumentName.trim() || documentTitle;
    const updatedBoxes = getUpdatedBoxesFromModalKeyValues(boxes, saveModalKeyValues);
    setTemplateName(name);
    setDocumentTitle(docName);
    setBoxes(updatedBoxes);
    setNextRank(Math.max(...updatedBoxes.map((b) => b.rank || 0), 0) + 1);
    setShowSaveTemplateModal(false);
    try {
      setSaving(true);
      const payload = buildPayload(name, docName, updatedBoxes);
      const nameChanged = name.toLowerCase() !== (templateName || '').trim().toLowerCase();
      const shouldCreateNew = !currentTemplateId || nameChanged;
      if (shouldCreateNew) {
        const res = await templateService.createTemplate(payload);
        setCurrentTemplateId(res.data.id);
        toast.success('Template saved.');
      } else {
        await templateService.updateTemplate(currentTemplateId, payload);
        toast.success('Template updated.');
      }
      if (wakaToken) {
        const wakaRes = await saveToWaka(wakaToken, { ...payload, template_name: payload.name, template_code: payload.documentName ? String(payload.documentName).trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') : undefined });
        if (wakaRes.success) toast.success('Template also saved to Waka.');
        else if (wakaRes.error) toast.error(`Waka: ${wakaRes.error}`);
      }
      setLastSavedDesignSnapshot(getDesignSnapshot(updatedBoxes, docName, name, pageSize, orientation, templateOutlineMode, tableMode, maxDynamicColumns));
      fetchTemplateCount();
    } catch (err) {
      logger.error('Save template modal failed', err);
      let msg = err.response?.data?.message || err.message || 'Failed to save';
      if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
        msg = 'Request timed out. Ensure the backend is running (npm run dev in the backend folder).';
      } else if (err.message === 'Network Error' || err.code === 'ERR_NETWORK') {
        msg = 'Cannot reach backend. Ensure the backend is running (npm run dev in the backend folder).';
      }
      const invalidKeys = err.response?.data?.invalidKeys;
      toast.error(invalidKeys?.length ? `${msg} Invalid keys: ${invalidKeys.join(', ')}` : msg);
    } finally {
      setSaving(false);
    }
  };

  const handleGenerate = async () => {
    if (!currentTemplateId) {
      toast.error('Save the template first.');
      return;
    }
    try {
      setLoading(true);
      const data = demoData && typeof demoData === 'object' ? demoData : {};
      const response = await pdfService.generate(currentTemplateId, data);
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${documentTitle}_${Date.now()}.pdf`;
      a.click();
      window.URL.revokeObjectURL(url);
      toast.success('PDF generated successfully.');
    } catch (err) {
      console.error('PDF generate error:', err);
      let message = 'Failed to generate PDF';
      if (err.response?.data != null) {
        try {
          const data = err.response.data;
          const text = typeof data.text === 'function' ? await data.text() : (typeof data === 'string' ? data : '');
          if (text) {
            const parsed = JSON.parse(text);
            message = parsed.error || parsed.message || message;
            if (parsed.stack) console.error('Server stack:', parsed.stack);
          }
        } catch (_) {
          console.error('Could not parse error response:', err.response.data);
        }
      } else if (err.message) {
        message = err.message;
      }
      console.error('PDF error message:', message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const [templatesList, setTemplatesList] = useState([]);
  useEffect(() => {
    templateService.getTemplates().then((r) => setTemplatesList(Array.isArray(r.data) ? r.data : [])).catch(() => setTemplatesList([]));
  }, [templateCount]);

  const selectedBoxData = boxes.find((b) => b.id === selectedBox);
  const canvasDims = getCanvasDimensions();

  const sortedTemplateDesigns = useMemo(() => {
    const byName = (a, b) => (a.name || '').localeCompare(b.name || '');
    if (!selectedStandardizedId) return [...templateDesignsList].sort(byName);
    const selectedId = (selectedStandardizedId ?? '').toString().toLowerCase();
    const recommended = templateDesignsList.filter((d) => ((d.standardizedTemplateId ?? d.standardized_template_id) ?? '').toString().toLowerCase() === selectedId);
    const other = templateDesignsList.filter((d) => ((d.standardizedTemplateId ?? d.standardized_template_id) ?? '').toString().toLowerCase() !== selectedId);
    return [...recommended.sort(byName), ...other.sort(byName)];
  }, [templateDesignsList, selectedStandardizedId]);

  const recommendedDesigns = useMemo(() => {
    if (!selectedStandardizedId) return [];
    const id = String(selectedStandardizedId);
    return templateDesignsList.filter((d) => String(d.standardizedTemplateId || d.standardized_template_id || '') === id);
  }, [templateDesignsList, selectedStandardizedId]);
  const otherDesigns = useMemo(() => {
    if (!selectedStandardizedId) return templateDesignsList;
    const id = String(selectedStandardizedId);
    return templateDesignsList.filter((d) => String(d.standardizedTemplateId || d.standardized_template_id || '') !== id);
  }, [templateDesignsList, selectedStandardizedId]);

  const [toolbarSlot, setToolbarSlot] = useState(null);
  useEffect(() => {
    setToolbarSlot(document.getElementById('app-header-toolbar'));
  }, []);

  const toolbarContent = (
    <div className="editor-toolbar-in-header">
      <span className="saved-count">Saved: {templateCount}</span>
      <div className="editor-mode-toggle">
        <button
          type="button"
          className={`toolbar-button ${editorMode === 'normal' ? 'create-new-btn' : 'toolbar-button-secondary'}`}
          onClick={() => { setEditorMode('normal'); setSelectedStandardizedId(null); setStandardizedKeyValuePairs([]); }}
        >
          Normal
        </button>
        <button
          type="button"
          className={`toolbar-button ${editorMode === 'standardized' ? 'create-new-btn' : 'toolbar-button-secondary'}`}
          onClick={() => setEditorMode('standardized')}
        >
          Standardized Template
        </button>
      </div>
      <button type="button" className="toolbar-button create-new-btn" onClick={handleCreateNewTemplate}>
        + Create New
      </button>
      <div className="editor-toolbar-template-area">
        {templatesList.length > 0 && (
          <>
            <select
              key="template-select"
              className="template-select"
              value={currentTemplateId || ''}
              onChange={(e) => {
                const id = e.target.value;
                if (id) handleLoadTemplate(id);
              }}
            >
              <option value="">Open template...</option>
              {[...templatesList].sort((a, b) => (a.name || '').localeCompare(b.name || '')).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            {currentTemplateId && (
              <button
                key="delete-template-btn"
                type="button"
                className="toolbar-button delete-template-btn"
                onClick={() => setShowDeleteConfirm(true)}
                disabled={deleting}
                title="Delete this template"
              >
                🗑 Delete
              </button>
            )}
          </>
        )}
        <label className="template-name-label">Name:</label>
        <input
          type="text"
          value={templateName}
          onChange={(e) => setTemplateName(e.target.value)}
          className="template-name-input-toolbar"
          placeholder="Name"
        />
      </div>
      <select value={pageSize} onChange={(e) => handlePageSizeChange(e.target.value)} className="page-size-select">
        {PAGE_SIZES.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
      <select value={orientation} onChange={(e) => handleOrientationChange(e.target.value)} className="orientation-select">
        <option value="portrait">Portrait</option>
        <option value="landscape">Landscape</option>
      </select>
      <button type="button" className="toolbar-button save-template-button" onClick={openSaveTemplateModal} disabled={saving}>
        📋 Save Template
      </button>
      <button type="button" className="toolbar-button save-button" onClick={handleSave} disabled={saving}>
        💾 Save
      </button>
      <button type="button" className="toolbar-button generate-button" onClick={handleGenerate} disabled={loading || !currentTemplateId || hasUnsavedChanges} title={hasUnsavedChanges ? 'Save the template first so PDF reflects your changes.' : ''}>
        📄 Create PDF
      </button>
      <button type="button" className="toolbar-button export-html-btn" onClick={handleExportToHtml} disabled={!boxes.length} title="Export as HTML">
        🌐 Export HTML
      </button>
      <button type="button" className="toolbar-button export-variables-btn" onClick={handleExportVariables} disabled={!boxes.length} title="Export template variables (JSON for application)">
        📤 Export Variables
      </button>
    </div>
  );

  if (loading && !boxes.length && currentTemplateId) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <div className="editor-container">
      {toolbarSlot && createPortal(toolbarContent, toolbarSlot)}
      {!toolbarSlot && (
        <header key="editor-header-fallback" className="editor-header editor-header-fallback">
          {toolbarContent}
        </header>
      )}
      <div key="editor-content" className="editor-content">
        <aside className="editor-sidebar">
          <div className="sidebar-section title-section">
            <label className="title-label">Document Title:</label>
            <input
              type="text"
              value={documentTitle}
              onChange={(e) => setDocumentTitle(e.target.value)}
              className="document-title-input"
              placeholder="Document Title"
            />
          </div>

          {editorMode === 'standardized' && (
            <div className="sidebar-section standardized-keys-section">
              <h3 className="section-header">Standardized keys</h3>
              <p className="save-template-section-hint">Select a format, then drag keys onto the canvas. Only these keys are allowed.</p>
              <select
                className="template-select"
                value={selectedStandardizedId || ''}
                onChange={(e) => setSelectedStandardizedId(e.target.value || null)}
                style={{ width: '100%', marginBottom: 8 }}
              >
                <option value="">Select format...</option>
                {[...standardizedTemplatesList].sort((a, b) => (a.name || '').localeCompare(b.name || '')).map((st) => (
                  <option key={st.id} value={st.id}>{st.name}</option>
                ))}
              </select>
              {(standardizedKeyValuePairs.length > 0 || true) && (
                <div className="standardized-keys-list">
                  <p className="save-template-section-hint" style={{ marginBottom: 6 }}>Drag onto canvas or click to map to selected box.</p>
                  <div
                    className="standardized-key-item standardized-key-item-logo"
                    draggable
                    onDragStart={(e) => {
                      setDraggingStandardizedKey({ key: 'logo', label: 'Logo' });
                      e.dataTransfer.effectAllowed = 'copy';
                      e.dataTransfer.setData('text/plain', 'logo');
                    }}
                    onDragEnd={() => setDraggingStandardizedKey(null)}
                    onClick={() => {
                      if (selectedBox) {
                        updateBox(selectedBox, { type: 'logo', fieldName: 'logo', labelName: 'Logo', content: '{{logo}}' });
                      }
                    }}
                    title={selectedBox ? 'Map logo to selected box' : 'Select a box on canvas, or drag to add logo'}
                  >
                    <span className="standardized-key-label">Logo</span>
                    <span className="standardized-key-key">logo</span>
                  </div>
                  {standardizedKeyValuePairs.length > 0 && (() => {
                    const sortedKv = [...standardizedKeyValuePairs].sort(sortKvByKey);
                    return (
                    <>
                      <div className="standardized-keys-unboxed" aria-label="First three keys">
                        {sortedKv.slice(0, 3).map((kv, idx) => (
                          <div
                            key={kv.key ? `key-${kv.key}-${idx}` : `std-${idx}`}
                            className="standardized-key-item"
                            draggable
                            onDragStart={(e) => {
                              setDraggingStandardizedKey(kv);
                              e.dataTransfer.effectAllowed = 'copy';
                              e.dataTransfer.setData('text/plain', kv.key);
                            }}
                            onDragEnd={() => setDraggingStandardizedKey(null)}
                            onClick={() => {
                              if (selectedBox) {
                                const label = kv.label || kv.key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
                                updateBox(selectedBox, { type: 'text', fieldName: kv.key, labelName: label, content: `{{${kv.key}}}` });
                              }
                            }}
                            title={selectedBox ? `Map to selected box` : 'Select a box on canvas, or drag to add new'}
                          >
                            <span className="standardized-key-label">{kv.label || kv.key}</span>
                            <span className="standardized-key-key">{kv.key}</span>
                          </div>
                        ))}
                      </div>
                      {sortedKv.slice(3).map((kv, idx) => (
                        <div
                          key={kv.key ? `key-${kv.key}-${idx + 3}` : `std-${idx + 3}`}
                          className="standardized-key-item"
                          draggable
                          onDragStart={(e) => {
                            setDraggingStandardizedKey(kv);
                            e.dataTransfer.effectAllowed = 'copy';
                            e.dataTransfer.setData('text/plain', kv.key);
                          }}
                          onDragEnd={() => setDraggingStandardizedKey(null)}
                          onClick={() => {
                            if (selectedBox) {
                              const label = kv.label || kv.key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
                              updateBox(selectedBox, { type: 'text', fieldName: kv.key, labelName: label, content: `{{${kv.key}}}` });
                            }
                          }}
                          title={selectedBox ? `Map to selected box` : 'Select a box on canvas, or drag to add new'}
                        >
                          <span className="standardized-key-label">{kv.label || kv.key}</span>
                          <span className="standardized-key-key">{kv.key}</span>
                        </div>
                      ))}
                    </>
                    );
                  })()}
                </div>
              )}
            </div>
          )}

          <div className="sidebar-section">
            <h3 className="section-header" onClick={() => handleSectionToggle('global')}>
              <span>🔤 Global</span>
              <span className="expand-icon">{expandedSections.global ? '▼' : '▶'}</span>
            </h3>
            {expandedSections.global && (
              <div className="global-font-content">
                <p className="save-template-section-hint">Apply to all boxes on the canvas.</p>
                <div className="property-group">
                  <label>Font size (pt)</label>
                  <input
                    type="number"
                    min={6}
                    max={72}
                    value={globalFontSize}
                    onChange={(e) => setGlobalFontSize(parseInt(e.target.value, 10) || 10)}
                    title="Size in points (pt); same as in the generated PDF"
                  />
                </div>
                <div className="property-group">
                  <label>Font type</label>
                  <select
                    value={globalFontFamily}
                    onChange={(e) => setGlobalFontFamily(e.target.value)}
                    className="document-title-input"
                  >
                    <option value="Arial">Arial</option>
                    <option value="Helvetica">Helvetica</option>
                    <option value="Times New Roman">Times New Roman</option>
                    <option value="Courier New">Courier New</option>
                  </select>
                </div>
                <button type="button" className="toolbar-button apply-global-font-btn" onClick={applyGlobalFontToAllBoxes} disabled={!boxes.length}>
                  Apply to all boxes
                </button>
                <div className="property-group" style={{ marginTop: 12 }}>
                  <button type="button" className="toolbar-button box-type-button-logo" style={{ width: '100%' }} onClick={() => { if (selectedBox) updateBox(selectedBox, { type: 'logo', fieldName: 'logo', labelName: 'Logo', content: '{{logo}}' }); }} disabled={!selectedBox} title={selectedBox ? 'Map logo to selected box' : 'Select a box first'}>
                    🖼 Map Logo to selected box
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="sidebar-section">
            <h3 className="section-header" onClick={() => handleSectionToggle('demoData')}>
              <span>📋 Demo data</span>
              <span className="expand-icon">{expandedSections.demoData ? '▼' : '▶'}</span>
            </h3>
            {expandedSections.demoData && (
              <div className="demo-data-content">
                <p className="save-template-section-hint">JSON key-value pairs to preview and fill the template. Used in View, Export HTML, and Create PDF.</p>
                <p className="save-template-section-hint" style={{ marginTop: 4 }}>For multi-row tables (e.g. marks_and_numbers_1 … _25): add a <strong>Data Table (loop)</strong> from the Box Library, or select one box in the row and use <strong>Convert row to Data Table (loop)</strong> in Properties.</p>
                <textarea
                  className="demo-data-json-input"
                  value={demoDataJson}
                  onChange={(e) => setDemoDataJson(e.target.value)}
                  placeholder='{"shipper": "ABC Corp", "consignee": "XYZ Ltd", "logo": "Company Logo"}'
                  rows={8}
                  spellCheck={false}
                />
                {demoDataParseError && <p className="demo-data-parse-error">{demoDataParseError}</p>}
                <button type="button" className="toolbar-button admin-btn-secondary" style={{ width: '100%', marginTop: 8 }} onClick={() => { const obj = {}; boxes.forEach((b) => { const k = (b.fieldName && String(b.fieldName).trim()) || (b.labelName ? labelToKey(b.labelName) : ''); if (k) obj[k] = ''; }); setDemoDataJson(JSON.stringify(obj, null, 2)); }}>
                  Fill from template keys
                </button>
              </div>
            )}
          </div>

          <div className="sidebar-section">
            <h3 className="section-header" onClick={() => handleSectionToggle('csvImport')}>
              <span>📊 CSV Import</span>
              <span className="expand-icon">{expandedSections.csvImport ? '▼' : '▶'}</span>
            </h3>
            {expandedSections.csvImport && (
              <div className="csv-import-buttons">
                <p className="csv-import-hint">
                  <strong>Import Structure:</strong> Upload a CSV with field names and box coordinates. Use columns: <strong>Field Name</strong> (or Parameter Name, Title, Name), and either <strong>Left, Top, Right, Bottom</strong> or <strong>Position X, Position Y, Width, Height</strong>. Optional: Template Name, Rank, Type, Content, Font Size, Alignment.
                </p>
                <label className="csv-import-label">
                  <input
                    type="file"
                    accept=".csv"
                    onChange={handleCsvStructureImport}
                    style={{ display: 'none' }}
                    disabled={loading}
                  />
                  <span className="csv-button">Import Structure</span>
                </label>
              </div>
            )}
          </div>

          <div className="sidebar-section">
            <h3 className="section-header" onClick={() => handleSectionToggle('pdfImport')}>
              <span>📄 Import from PDF</span>
              <span className="expand-icon">{expandedSections.pdfImport ? '▼' : '▶'}</span>
            </h3>
            {expandedSections.pdfImport && (
              <div className="csv-import-buttons">
                <p className="csv-import-hint">
                  <strong>Upload PDF template:</strong> Any PDF is supported. If it has form fields, those are used; otherwise the PDF is scanned and text/layout is converted into editable boxes. Add, remove, or modify boxes, then save as a template.
                </p>
                <label className="csv-import-label">
                  <input
                    type="file"
                    accept=".pdf,application/pdf"
                    onChange={handlePdfTemplateImport}
                    style={{ display: 'none' }}
                    disabled={loading}
                  />
                  <span className="csv-button">Import from PDF</span>
                </label>
              </div>
            )}
          </div>

          <div className="sidebar-section">
            <h3 className="section-header" onClick={() => handleSectionToggle('templateSettings')}>
              <span>⚙️ Template Settings</span>
              <span className="expand-icon">{expandedSections.templateSettings ? '▼' : '▶'}</span>
            </h3>
            {expandedSections.templateSettings && (
              <div className="template-settings-content">
                <div className="template-setting-group">
                  <label className="template-setting-label">
                    <input type="radio" name="outlineMode" checked={templateOutlineMode === 'outline-all'} onChange={() => { setTemplateOutlineMode('outline-all'); setBoxes((p) => p.map((b) => ({ ...b, properties: { ...b.properties, border: true } }))); }} />
                    <span>Outline Template</span>
                  </label>
                </div>
                <div className="template-setting-group">
                  <label className="template-setting-label">
                    <input type="radio" name="outlineMode" checked={templateOutlineMode === 'remove-all'} onChange={() => { setTemplateOutlineMode('remove-all'); setBoxes((p) => p.map((b) => ({ ...b, properties: { ...b.properties, border: false } }))); }} />
                    <span>Outlined Box</span>
                  </label>
                </div>
                <div className="template-setting-group">
                  <label className="template-setting-label">
                    <input type="radio" name="outlineMode" checked={templateOutlineMode === 'none'} onChange={() => setTemplateOutlineMode('none')} />
                    <span>Individual Box Control</span>
                  </label>
                </div>
                <div className="template-setting-group" style={{ marginTop: 12, borderTop: '1px solid rgba(102,126,234,0.2)', paddingTop: 12 }}>
                  <label className="template-setting-label">
                    <input type="radio" name="tableMode" checked={tableMode === 'static'} onChange={() => setTableMode('static')} />
                    <span>Static Table</span>
                  </label>
                  <label className="template-setting-label">
                    <input type="radio" name="tableMode" checked={tableMode === 'dynamic'} onChange={() => setTableMode('dynamic')} />
                    <span>Dynamic Table</span>
                  </label>
                  {tableMode === 'dynamic' && (
                    <div style={{ marginLeft: 20 }}>
                      <label>Max Columns:</label>
                      <input type="number" min={1} max={50} value={maxDynamicColumns} onChange={(e) => setMaxDynamicColumns(parseInt(e.target.value) || 10)} style={{ width: 80, padding: 4 }} />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="sidebar-section">
            <h3 className="section-header" onClick={() => handleSectionToggle('boxLibrary')}>
              <span>📦 Box Library</span>
              <span className="expand-icon">{expandedSections.boxLibrary ? '▼' : '▶'}</span>
            </h3>
            {expandedSections.boxLibrary && (
              <div className="box-library-content">
                <button type="button" className="box-type-button" onClick={() => !isTemplateFullyOccupied(500, 20) && addBoxToLibrary('text', 500, 20)}>
                  📝 Add Text Box
                </button>
                <div className="table-button-wrapper">
                  <button type="button" className="box-type-button" onClick={() => setShowTableConfig(!showTableConfig)}>
                    📊 Add Table {showTableConfig ? '▼' : '▶'}
                  </button>
                  {showTableConfig && (
                    <div className="table-config-panel">
                      <div className="config-group">
                        <label>Rows:</label>
                        <input type="number" min={1} max={20} value={tableConfig.rows} onChange={(e) => handleTableConfigChange('rows', e.target.value)} />
                      </div>
                      <div className="config-group">
                        <label>Columns:</label>
                        <input type="number" min={1} max={10} value={tableConfig.columns} onChange={(e) => handleTableConfigChange('columns', e.target.value)} />
                      </div>
                      {tableConfig.headers.map((h, i) => (
                        <div key={i} style={{ marginBottom: 8 }}>
                          <input type="text" value={h} onChange={(e) => handleTableConfigChange(`header_${i}`, e.target.value)} placeholder={`Header ${i + 1}`} style={{ width: '100%' }} />
                          <input type="text" value={tableConfig.fieldNames[i]} onChange={(e) => handleTableConfigChange(`fieldName_${i}`, e.target.value)} placeholder={`field${i + 1}`} style={{ width: '100%', fontSize: 11 }} />
                        </div>
                      ))}
                      <button type="button" className="config-submit-button" onClick={handleCreateTable}>Create Table</button>
                    </div>
                  )}
                </div>
                <button type="button" className="box-type-button" onClick={() => !isTemplateFullyOccupied(300, 300) && addBoxToLibrary('container', 300, 300)}>
                  📦 Add Container
                </button>
                <button type="button" className="box-type-button box-type-button-logo" onClick={() => !isTemplateFullyOccupied(120, 60) && addBoxToLibrary('logo', 120, 60)}>
                  🖼 Add Logo
                </button>
                <button type="button" className="box-type-button" onClick={() => handleAddDataTable()} title="Table that loops over demo data (e.g. marks_and_numbers_1, _2, ...)">
                  📋 Add Data Table (loop)
                </button>
              </div>
            )}
          </div>

          {boxLibrary.length > 0 && (
            <div className="sidebar-section">
              <h3>Drag to Canvas</h3>
              <div className="library-boxes">
                {boxLibrary.map((libBox, libIdx) => (
                  <div
                    key={libBox.id ?? `lib-${libIdx}`}
                    className="library-box-item"
                    draggable
                    onDragStart={(e) => { setDraggingFromLibrary(libBox); e.dataTransfer.effectAllowed = 'copy'; }}
                    onDragEnd={() => setDraggingFromLibrary(null)}
                  >
                    <div className="library-box-preview">
                      {libBox.type === 'table' && libBox.tableConfig ? (libBox.tableConfig.dynamicRowsFromData ? `Data table (${libBox.size.width}×${libBox.size.height})` : `${libBox.type} (${libBox.size.width}×${libBox.size.height})`) : libBox.type === 'logo' ? `Logo (${libBox.size.width}×${libBox.size.height})` : `${libBox.type} (${libBox.size.width}×${libBox.size.height})`}
                    </div>
                    <button type="button" className="remove-library-box" onClick={() => setBoxLibrary((p) => p.filter((b) => b.id !== libBox.id))}>×</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {selectedBoxData && (
            <div className="sidebar-section properties-panel">
              <h3 className="section-header" onClick={() => handleSectionToggle('properties')}>
                <span>⚙️ Properties</span>
                <span className="expand-icon">{expandedSections.properties ? '▼' : '▶'}</span>
              </h3>
              {expandedSections.properties && (
                <div className="properties-content">
                  {selectedBoxData.type !== 'logo' && (
                    <div className="property-group">
                      <button type="button" className="box-type-button box-type-button-logo" style={{ width: '100%' }} onClick={() => updateBox(selectedBox, { type: 'logo', labelName: 'Logo', fieldName: 'logo', content: '{{logo}}' })}>
                        🖼 Convert to Logo
                      </button>
                    </div>
                  )}
                  {(selectedBoxIds.length > 1 || selectedBoxData?.type !== 'table') && (
                    <div className="property-group">
                      <button type="button" className="box-type-button" style={{ width: '100%' }} onClick={handleConvertRowToDataTable} title={selectedBoxIds.length > 1 ? 'Replace selected boxes with one Data Table (loop)' : 'Replace this row of boxes with one Data Table that loops over demo data (e.g. marks_and_numbers_1, _2, …)'}>
                        📋 Convert row to Data Table (loop){selectedBoxIds.length > 1 ? ` (${selectedBoxIds.length} selected)` : ''}
                      </button>
                      <p className="save-template-section-hint" style={{ marginTop: 4, marginBottom: 0 }}>First page shows 3 rows; remaining rows flow to following pages in the editor and in all generated documents (PDF/HTML).</p>
                    </div>
                  )}
                  <div className="property-group">
                    <label>Label Name:</label>
                    <input type="text" value={selectedBoxData.labelName || ''} onChange={(e) => updateBox(selectedBox, { labelName: e.target.value })} placeholder="e.g. Label" />
                  </div>
                  <div className="property-group">
                    <label>Field Name:</label>
                    {editorMode === 'standardized' && standardizedKeyValuePairs.length > 0 ? (
                      <select
                        value={selectedBoxData.fieldName || ''}
                        onChange={(e) => {
                          const key = e.target.value;
                          const kv = standardizedKeyValuePairs.find((p) => p.key === key);
                          const label = kv?.label || key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
                          updateBox(selectedBox, { fieldName: key, labelName: label, content: `{{${key}}}` });
                        }}
                        className="document-title-input"
                        style={{ width: '100%' }}
                      >
                        <option value="">— Select key —</option>
                        {[...standardizedKeyValuePairs].sort(sortKvByKey).map((kv) => (
                          <option key={kv.key} value={kv.key}>{kv.label || kv.key}</option>
                        ))}
                      </select>
                    ) : (
                      <input type="text" value={selectedBoxData.fieldName || ''} onChange={(e) => updateBox(selectedBox, { fieldName: e.target.value })} placeholder="e.g. field_name" />
                    )}
                  </div>
                  <div className="property-group">
                    <label>Content:</label>
                    <textarea value={selectedBoxData.content || ''} onChange={(e) => updateBox(selectedBox, { content: e.target.value })} placeholder={'e.g. {{shipperName}}\n{{shipperAddress}} or text'} rows={3} />
                    <span className="property-hint" style={{ display: 'block', fontSize: 11, color: '#666', marginTop: 2 }}>One box can show multiple values: use {'{{key1}}'} and {'{{key2}}'} (e.g. {'{{shipperName}}'}, {'{{shipperAddress}}'}).</span>
                  </div>
                  {selectedBoxData.type !== 'table' && selectedBoxData.type !== 'logo' && (
                    <>
                      <div className="property-group">
                        <div className="checkbox-row">
                          <input id="prop-label-only" type="checkbox" checked={!!selectedBoxData.properties?.labelOnly} onChange={(e) => updateBox(selectedBox, { properties: { ...selectedBoxData.properties, labelOnly: e.target.checked, ...(e.target.checked ? { valueOnly: false, emptyBox: false } : {}) } })} />
                          <label htmlFor="prop-label-only">Label only</label>
                        </div>
                        <span className="property-hint" style={{ display: 'block', fontSize: 11, color: '#666', marginTop: 2 }}>Show only the label (no value)</span>
                      </div>
                      <div className="property-group">
                        <div className="checkbox-row">
                          <input id="prop-value-only" type="checkbox" checked={!!selectedBoxData.properties?.valueOnly} onChange={(e) => updateBox(selectedBox, { properties: { ...selectedBoxData.properties, valueOnly: e.target.checked, ...(e.target.checked ? { labelOnly: false, emptyBox: false } : {}) } })} />
                          <label htmlFor="prop-value-only">Value only</label>
                        </div>
                        <span className="property-hint" style={{ display: 'block', fontSize: 11, color: '#666', marginTop: 2 }}>Show only the value from data (no label)</span>
                      </div>
                      <div className="property-group">
                        <div className="checkbox-row">
                          <input id="prop-empty-box" type="checkbox" checked={!!selectedBoxData.properties?.emptyBox} onChange={(e) => updateBox(selectedBox, { properties: { ...selectedBoxData.properties, emptyBox: e.target.checked, ...(e.target.checked ? { labelOnly: false, valueOnly: false } : {}) } })} />
                          <label htmlFor="prop-empty-box">Empty box</label>
                        </div>
                        <span className="property-hint" style={{ display: 'block', fontSize: 11, color: '#666', marginTop: 2 }}>Box shows no field or value (empty)</span>
                      </div>
                    </>
                  )}
                  <div className="property-group">
                    <label>Font size (pt):</label>
                    <input type="number" value={selectedBoxData.properties?.fontSize || 12} onChange={(e) => updateBox(selectedBox, { properties: { ...selectedBoxData.properties, fontSize: parseInt(e.target.value) || 12 } })} min={6} max={72} title="Points (pt); matches PDF output" />
                  </div>
                  <div className="property-group">
                    <label>Font Color:</label>
                    <input type="color" value={selectedBoxData.properties?.fontColor || '#000000'} onChange={(e) => updateBox(selectedBox, { properties: { ...selectedBoxData.properties, fontColor: e.target.value } })} />
                  </div>
                  <div className="property-group">
                    <label>
                      <input type="checkbox" checked={selectedBoxData.properties?.border !== false} onChange={(e) => updateBox(selectedBox, { properties: { ...selectedBoxData.properties, border: e.target.checked } })} />
                      Box Outline
                    </label>
                  </div>
                  <div className="property-group">
                    <label>Width:</label>
                    <input type="number" value={selectedBoxData.size.width} onChange={(e) => updateBox(selectedBox, { size: { ...selectedBoxData.size, width: parseInt(e.target.value) } })} />
                  </div>
                  <div className="property-group">
                    <label>Height:</label>
                    <input type="number" value={selectedBoxData.size.height} onChange={(e) => updateBox(selectedBox, { size: { ...selectedBoxData.size, height: parseInt(e.target.value) } })} />
                  </div>
                  {selectedBoxData.type === 'table' && selectedBoxData.tableConfig?.dynamicRowsFromData && (
                    <>
                      <div className="property-group">
                        <label>Rows on first page:</label>
                        <input
                          type="number"
                          min={1}
                          max={100}
                          value={selectedBoxData.tableConfig.rowsOnFirstPage ?? 3}
                          onChange={(e) => updateBox(selectedBox, {
                            tableConfig: {
                              ...selectedBoxData.tableConfig,
                              rowsOnFirstPage: Math.max(1, parseInt(e.target.value) || 3),
                            },
                          })}
                          title="Number of table rows to show on the first page (remaining rows flow to next pages)"
                        />
                      </div>
                      <div className="property-group">
                        <label>Rows on other pages (0 = auto):</label>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={selectedBoxData.tableConfig.rowsOnOtherPages ?? ''}
                          onChange={(e) => {
                            const v = e.target.value.trim();
                            const num = v === '' ? null : parseInt(v, 10);
                            const rowsOnOtherPages = (v === '' || (num != null && !Number.isNaN(num) && num <= 0)) ? null : (num != null && !Number.isNaN(num) ? num : selectedBoxData.tableConfig.rowsOnOtherPages);
                            updateBox(selectedBox, {
                              tableConfig: {
                                ...selectedBoxData.tableConfig,
                                rowsOnOtherPages,
                              },
                            });
                          }}
                          placeholder="Auto"
                          title="Fixed rows per page after the first (0 or empty = fit by page height)"
                        />
                      </div>
                      {(selectedBoxData.tableConfig.headers || selectedBoxData.tableConfig.columnKeys || []).length > 0 && (
                        <div className="property-group">
                          <label>Column widths (%):</label>
                          <div className="column-widths-editor">
                            {(() => {
                              const headers = selectedBoxData.tableConfig.headers || (selectedBoxData.tableConfig.columnKeys || []).map((k) => String(k).replace(/_/g, ' '));
                              const colCount = headers.length || 1;
                              const widths = (selectedBoxData.tableConfig.columnWidths && Array.isArray(selectedBoxData.tableConfig.columnWidths) && selectedBoxData.tableConfig.columnWidths.length === colCount)
                                ? selectedBoxData.tableConfig.columnWidths
                                : Array.from({ length: colCount }, () => Math.round(10000 / colCount) / 100);
                              return headers.map((header, i) => (
                                <div key={i} className="column-width-row">
                                  <span className="column-width-label" title={header}>{String(header).slice(0, 18)}{String(header).length > 18 ? '…' : ''}</span>
                                  <input
                                    type="number"
                                    min={1}
                                    max={100}
                                    step={1}
                                    value={widths[i] ?? 100 / colCount}
                                    onChange={(e) => {
                                      const val = parseFloat(e.target.value);
                                      if (Number.isNaN(val)) return;
                                      const next = [...(selectedBoxData.tableConfig.columnWidths && selectedBoxData.tableConfig.columnWidths.length === colCount ? selectedBoxData.tableConfig.columnWidths : widths)];
                                      next[i] = Math.max(1, Math.min(100, val));
                                      updateBox(selectedBox, { tableConfig: { ...selectedBoxData.tableConfig, columnWidths: next } });
                                    }}
                                    title={`Width % for ${header}`}
                                  />
                                  <span className="column-width-unit">%</span>
                                </div>
                              ));
                            })()}
                          </div>
                          <span className="property-hint">Content wraps within column width; adjust to resize columns.</span>
                        </div>
                      )}
                    </>
                  )}
                  <button type="button" className="delete-button" onClick={() => deleteBox(selectedBox)}>🗑️ Delete Box</button>
                </div>
              )}
            </div>
          )}
        </aside>

        <main className="editor-main">
          <div className="canvas-wrapper">
            {Math.max(1, Math.min(100, dataTableLayout.numPages || 1)) > 1 ? (
              <div
                key="multi-page-canvas"
                className="canvas-pages-container"
                style={{
                  width: canvasDims.width,
                  paddingBottom: 8,
                  ...(canvasBackgroundImage && {
                    backgroundImage: `url(${canvasBackgroundImage})`,
                    backgroundSize: `${canvasDims.width}px ${canvasDims.height}px`,
                    backgroundRepeat: `repeat-y`,
                    backgroundPosition: 'top left',
                  }),
                }}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
                onDrop={(e) => {
                  e.preventDefault();
                  const rect = e.currentTarget.getBoundingClientRect();
                  const offsetY = e.clientY - rect.top;
                  const numP = Math.max(1, Math.min(100, dataTableLayout.numPages || 1));
                  const pageIndex = Math.min(Math.max(0, Math.floor(offsetY / (canvasDims.height + PAGE_GAP))), numP - 1);
                  const localY = offsetY - pageIndex * (canvasDims.height + PAGE_GAP);
                  const globalY = pageIndex * canvasDims.height + Math.max(0, Math.min(localY, canvasDims.height - 20));
                  const dropPos = { x: e.clientX - rect.left, y: globalY };
                  if (draggingStandardizedKey) {
                    addBoxFromStandardizedKey(draggingStandardizedKey, dropPos);
                    setDraggingStandardizedKey(null);
                  } else if (draggingFromLibrary) {
                    addBoxToCanvas(draggingFromLibrary, dropPos);
                    setDraggingFromLibrary(null);
                  }
                }}
              >
                {Array.from({ length: Math.max(1, Math.min(100, dataTableLayout.numPages || 1)) }).map((_, pageIndex) => {
                  const contentW = canvasDims.width - 2 * PAGE_PADDING_PX;
                  const contentH = canvasDims.height - 2 * PAGE_PADDING_PX;
                  const scaleX = contentW / canvasDims.width;
                  const scaleY = contentH / canvasDims.height;
                  return (
                  <div
                    key={`canvas-page-${pageIndex}`}
                    className="canvas-page"
                    style={{
                      width: canvasDims.width,
                      height: canvasDims.height,
                      padding: PAGE_PADDING_PX,
                      marginBottom: pageIndex < Math.max(1, Math.min(100, dataTableLayout.numPages || 1)) - 1 ? PAGE_GAP : 0,
                      overflow: 'hidden',
                      position: 'relative',
                      background: '#fff',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
                      boxSizing: 'border-box',
                    }}
                  >
                    <div
                      className="page-boundary-guide"
                      style={{
                        position: 'absolute',
                        inset: 0,
                        border: '2px dashed rgba(0,0,0,0.35)',
                        pointerEvents: 'none',
                        zIndex: 50,
                        boxSizing: 'border-box',
                      }}
                      title="Page boundary – place boxes inside this area"
                    />
                    <div
                      className="canvas-page-inner"
                      style={{
                        position: 'absolute',
                        left: PAGE_PADDING_PX,
                        top: PAGE_PADDING_PX,
                        width: contentW,
                        height: contentH,
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        className="canvas-page-content"
                        style={{
                          width: canvasDims.width,
                          height: canvasDims.height,
                          transform: `scale(${scaleX}, ${scaleY})`,
                          transformOrigin: '0 0',
                          position: 'relative',
                        }}
                      >
                    {[
                      <div key={`document-title-${pageIndex}`} className="document-title" style={{ height: TITLE_AREA_HEIGHT, minHeight: TITLE_AREA_HEIGHT, boxSizing: 'border-box', marginBottom: 0 }}>{documentTitle}</div>,
                      /* Content area starts below title so title never overlaps table on page 2+ */
                      <div key={`page-content-${pageIndex}`} style={{ position: 'absolute', top: TITLE_AREA_HEIGHT, left: 0, right: 0, width: '100%', height: canvasDims.height - TITLE_AREA_HEIGHT }}>
                        {boxes
                        .filter((b) => {
                        if (pageIndex >= 1 && sequenceSectionBoxIds.includes(b.id)) return false;
                        const globalTop = (b.position?.y ?? 0) + (dataTableLayout.boxYOffset[b.id] || 0);
                        const pageTop = pageIndex * canvasDims.height;
                        const pageBottom = (pageIndex + 1) * canvasDims.height;
                        // Data table: include on this page if it has rows for this page, or page 0 in "attached list" mode (message row only)
                        if (b.type === 'table' && b.tableConfig?.dynamicRowsFromData && Array.isArray(b.tableConfig?.columnKeys) && demoData && typeof demoData === 'object') {
                          const rowCount = getDataTableRowCount(demoData, b.tableConfig.columnKeys);
                          if (rowCount > 0) {
                            const firstPageOfTable = Math.floor(globalTop / canvasDims.height);
                            const tablePageIndex = Math.max(0, pageIndex - firstPageOfTable);
                            const range = getDataTableRowRangeForPage(b, tablePageIndex, rowCount, canvasDims.height - TITLE_AREA_HEIGHT);
                            if (range.endRow > range.startRow) return true;
                            if (tablePageIndex === 0 && rowCount > DATA_TABLE_ATTACHED_LIST_THRESHOLD) return true;
                            return false;
                          }
                        }
                        const boxH = dataTableLayout.effectiveHeightByBoxId[b.id] ?? b.size?.height ?? 20;
                        const globalBottom = globalTop + boxH;
                        if (boxH <= 0) return false;
                        return globalBottom > pageTop && globalTop < pageBottom;
                      })
                        .sort((a, b) => (a.rank || 0) - (b.rank || 0))
                        .map((box, boxIdx) => {
                        const offsetY = dataTableLayout.boxYOffset[box.id] || 0;
                        const globalY = (box.position?.y ?? 0) + offsetY;
                        const localY = globalY - pageIndex * canvasDims.height;
                        let effectiveH = dataTableLayout.effectiveHeightByBoxId[box.id] ?? box.size?.height ?? 20;
                        if (box.type === 'table' && box.tableConfig?.dynamicRowsFromData && Array.isArray(box.tableConfig.columnKeys) && demoData && typeof demoData === 'object') {
                          const rowCount = getDataTableRowCount(demoData, box.tableConfig.columnKeys);
                          if (rowCount > 0) {
                            const firstPageOfTable = Math.floor(globalY / canvasDims.height);
                            const tablePageIndex = Math.max(0, pageIndex - firstPageOfTable);
                            if (pageIndex === firstPageOfTable && dataTableLayout.effectiveHeightByBoxId[box.id] != null) {
                              effectiveH = dataTableLayout.effectiveHeightByBoxId[box.id];
                              // When not in attached list mode, merge table + spacer below into one common box on page 0
                              const useAttachedListMode = rowCount > DATA_TABLE_ATTACHED_LIST_THRESHOLD;
                              const tableIncludesGap = dataTableLayout.dataTableIncludesGapOnFirstPage;
                              if (!useAttachedListMode && !tableIncludesGap && pageIndex === 0 && dataTableLayout.dataTableSpacerTop != null) {
                                const tableBottom = globalY + effectiveH;
                                if (Math.abs(tableBottom - dataTableLayout.dataTableSpacerTop) < 2) {
                                  const spacerH = Math.min(EMPTY_BOX_BELOW_TABLE_PX, canvasDims.height - dataTableLayout.dataTableSpacerTop);
                                  effectiveH += spacerH;
                                }
                              }
                            } else {
                              const range = getDataTableRowRangeForPage(box, tablePageIndex, rowCount, canvasDims.height - TITLE_AREA_HEIGHT);
                              const tableContentHeight = DATA_TABLE_HEADER_ROW_PX + (range.endRow - range.startRow) * DATA_TABLE_ROW_HEIGHT_PX;
                              effectiveH = Math.max(20, tableContentHeight);
                            }
                          }
                        }
                        const boxHeight = Math.max(0, Math.min(effectiveH, canvasDims.height - localY));
                        const displayTop = Math.max(0, localY);
                        const displayHeight = localY < 0 ? Math.min(effectiveH, canvasDims.height) : boxHeight;
                        return (
                          <div
                            key={box.id ?? `box-p${pageIndex}-${boxIdx}`}
                            className={`editor-box ${selectedBoxIds.includes(box.id) ? 'selected' : ''} ${draggingBox === box.id ? 'dragging' : ''} ${overlappingBox === box.id ? 'overlapping' : ''}`}
                            style={{
                              left: `${box.position.x}px`,
                              top: `${displayTop}px`,
                              width: `${box.size.width}px`,
                              height: `${displayHeight}px`,
                              boxSizing: 'border-box',
                              fontSize: `${ptToPx(box.properties?.fontSize || 12)}px`,
                              fontFamily: box.properties?.fontFamily || 'Arial',
                              fontWeight: box.properties?.fontWeight || 'normal',
                              color: box.properties?.fontColor || '#000000',
                              backgroundColor: box.properties?.backgroundColor || 'transparent',
                              textAlign: box.properties?.alignment || 'left',
                              cursor: isDragging && draggingBox === box.id ? 'grabbing' : 'grab',
                              zIndex: draggingBox === box.id ? 1000 : (selectedBoxIds.includes(box.id) ? 100 : 1),
                              ...(box.properties?.border !== false ? (() => {
                                const pageBoxes = boxes.filter((b) => {
                                  if (pageIndex >= 1 && sequenceSectionBoxIds.includes(b.id)) return false;
                                  const gTop = (b.position?.y ?? 0) + (dataTableLayout.boxYOffset[b.id] || 0);
                                  const pTop = pageIndex * canvasDims.height;
                                  const pBottom = (pageIndex + 1) * canvasDims.height;
                                  if (b.type === 'table' && b.tableConfig?.dynamicRowsFromData && Array.isArray(b.tableConfig?.columnKeys) && demoData && typeof demoData === 'object') {
                                    const rc = getDataTableRowCount(demoData, b.tableConfig.columnKeys);
                                    if (rc > 0) {
                                      const fp = Math.floor(gTop / canvasDims.height);
                                      const tpi = Math.max(0, pageIndex - fp);
                                      const r = getDataTableRowRangeForPage(b, tpi, rc, canvasDims.height - TITLE_AREA_HEIGHT);
                                      if (r.endRow > r.startRow) return true;
                                      if (tpi === 0 && rc > DATA_TABLE_ATTACHED_LIST_THRESHOLD) return true;
                                      return false;
                                    }
                                  }
                                  const bh = dataTableLayout.effectiveHeightByBoxId[b.id] ?? b.size?.height ?? 20;
                                  if (bh <= 0) return false;
                                  return gTop + bh > pTop && gTop < pBottom;
                                }).sort((a, b) => (a.rank || 0) - (b.rank || 0));
                                const renderedRects = {};
                                pageBoxes.forEach((b) => {
                                  const oy = dataTableLayout.boxYOffset[b.id] || 0;
                                  const gy = (b.position?.y ?? 0) + oy;
                                  const ly = gy - pageIndex * canvasDims.height;
                                  let eh = dataTableLayout.effectiveHeightByBoxId[b.id] ?? b.size?.height ?? 20;
                                  if (b.type === 'table' && b.tableConfig?.dynamicRowsFromData && Array.isArray(b.tableConfig?.columnKeys) && demoData && typeof demoData === 'object') {
                                    const rc = getDataTableRowCount(demoData, b.tableConfig.columnKeys);
                                    if (rc > 0) {
                                      const fp = Math.floor(gy / canvasDims.height);
                                      const tpi = Math.max(0, pageIndex - fp);
                                      if (pageIndex === fp && dataTableLayout.effectiveHeightByBoxId[b.id] != null) {
                                        eh = dataTableLayout.effectiveHeightByBoxId[b.id];
                                        if (!(rc > DATA_TABLE_ATTACHED_LIST_THRESHOLD) && !dataTableLayout.dataTableIncludesGapOnFirstPage && pageIndex === 0 && dataTableLayout.dataTableSpacerTop != null && Math.abs(gy + eh - dataTableLayout.dataTableSpacerTop) < 2)
                                          eh += Math.min(EMPTY_BOX_BELOW_TABLE_PX, canvasDims.height - dataTableLayout.dataTableSpacerTop);
                                      } else {
                                        const r = getDataTableRowRangeForPage(b, tpi, rc, canvasDims.height - TITLE_AREA_HEIGHT);
                                        eh = Math.max(20, DATA_TABLE_HEADER_ROW_PX + (r.endRow - r.startRow) * DATA_TABLE_ROW_HEIGHT_PX);
                                      }
                                    }
                                  }
                                  const dh = ly < 0 ? Math.min(eh, canvasDims.height) : Math.max(0, Math.min(eh, canvasDims.height - ly));
                                  const dt = Math.max(0, ly);
                                  const l = b.position?.x ?? 0;
                                  renderedRects[b.id] = { top: dt, bottom: dt + dh, left: l, right: l + (b.size?.width ?? 0) };
                                });
                                const edges = getBoxEdgeVisibility(box, pageBoxes, ADJACENT_EPS, dataTableLayout, renderedRects);
                                const line = '1px solid #3b82f6';
                                return {
                                  borderLeft: edges.left ? line : 'none',
                                  borderRight: edges.right ? line : 'none',
                                  borderTop: edges.top ? line : 'none',
                                  borderBottom: edges.bottom ? line : 'none',
                                };
                              })() : { border: 'none' }),
                            }}
                            onMouseDown={(e) => handleMouseDown(e, box.id)}
                            onClick={(e) => {
                              if (!isDragging) {
                                if (e.shiftKey) {
                                  setSelection(selectedBoxIds.includes(box.id) ? selectedBoxIds.filter((id) => id !== box.id) : [...selectedBoxIds, box.id]);
                                } else {
                                  setSelection([box.id]);
                                }
                              }
                            }}
                            onDoubleClick={(e) => { if (!isDragging) handleBoxDoubleClick(e, box); }}
                          >
                            <div className="box-handle">⋮⋮</div>
                            {box.type === 'table' && box.tableConfig ? (
                              (() => {
                                const colCount = (box.tableConfig.headers || []).length || 1;
                                const widths = (box.tableConfig.columnWidths && Array.isArray(box.tableConfig.columnWidths) && box.tableConfig.columnWidths.length === colCount)
                                  ? box.tableConfig.columnWidths
                                  : Array.from({ length: colCount }, () => 100 / colCount);
                                const cellWrapStyle = { wordBreak: 'break-word', overflowWrap: 'break-word', whiteSpace: 'pre-line' };
                                return (
                              <div className="table-preview" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', padding: '4px 4px 0 4px', boxSizing: 'border-box', overflow: 'visible' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, tableLayout: 'fixed' }}>
                                  <colgroup>
                                    {widths.map((pct, i) => <col key={i} style={{ width: `${Math.max(1, Math.min(100, Number(pct) || 100 / colCount))}%` }} />)}
                                  </colgroup>
                                  <thead>
                                    <tr>
                                      {box.tableConfig.headers.map((h, i) => (
                                        <th key={i} style={{ border: '1px solid #ccc', padding: 4, textAlign: 'left', backgroundColor: '#f0f0f0', ...cellWrapStyle }}>{h || `H${i + 1}`}</th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {box.tableConfig.dynamicRowsFromData && Array.isArray(box.tableConfig.columnKeys) && demoData && typeof demoData === 'object' ? (
                                      (() => {
                                        const rowCount = getDataTableRowCount(demoData, box.tableConfig.columnKeys);
                                        if (rowCount === 0) {
                                          return (
                                            <tr><td colSpan={box.tableConfig.headers?.length || 1} style={{ border: 'none', padding: 8, color: '#666' }}>No demo data rows</td></tr>
                                          );
                                        }
                                        const globalTop = (box.position?.y ?? 0) + (dataTableLayout.boxYOffset[box.id] || 0);
                                        const firstPageOfTable = Math.floor(globalTop / canvasDims.height);
                                        const tablePageIndex = Math.max(0, pageIndex - firstPageOfTable);
                                        const range = getDataTableRowRangeForPage(box, tablePageIndex, rowCount, canvasDims.height - TITLE_AREA_HEIGHT);
                                        const useAttachedListMode = rowCount > DATA_TABLE_ATTACHED_LIST_THRESHOLD;
                                        if (tablePageIndex === 0 && useAttachedListMode) {
                                          return (
                                            <tr style={{ height: DATA_TABLE_ATTACHED_LIST_GAP_PX }}>
                                              <td colSpan={box.tableConfig.headers?.length || 1} style={{ border: 'none', padding: 8, fontStyle: 'italic', color: '#444', textAlign: 'center', verticalAlign: 'bottom', height: DATA_TABLE_ATTACHED_LIST_GAP_PX }}>Find the details of elements in attached list.</td>
                                            </tr>
                                          );
                                        }
                                        let startRow = Math.max(0, range.startRow);
                                        let endRow = Math.min(rowCount, range.endRow);
                                        if (tablePageIndex === 0 && !useAttachedListMode && endRow - startRow < 3 && box.tableConfig.columnKeys?.length) {
                                          const hasThird = box.tableConfig.columnKeys.some((k) => demoData[`${String(k).trim()}_3`] !== undefined);
                                          if (hasThird) endRow = Math.min(Math.max(endRow, 3), 500);
                                        }
                                        return Array.from({ length: endRow - startRow }).map((_, i) => {
                                          const ri = startRow + i;
                                          const rowMeta = getDataTableRowMeta(demoData, box.tableConfig.columnKeys, ri + 1);
                                          return (
                                            <tr key={ri} style={{ fontWeight: rowMeta?.isContainerHeading ? 'bold' : 'normal' }}>
                                              {(box.tableConfig.columnKeys || box.tableConfig.headers || []).map((_, ci) => (
                                                <td key={ci} style={{ border: 'none', padding: 4, ...(rowMeta?.isContainerHeading && ci === 0 ? { fontWeight: 'bold' } : {}), ...cellWrapStyle }}>{getDataTableCell(demoData, box.tableConfig.columnKeys, ri + 1, ci)}</td>
                                              ))}
                                            </tr>
                                          );
                                        });
                                      })()
                                    ) : (
                                      Array.from({ length: box.tableConfig.rows || 1 }).map((_, ri) => (
                                        <tr key={ri}>
                                          {box.tableConfig.headers.map((_, ci) => (
                                            <td key={ci} style={{ border: 'none', padding: 4, ...cellWrapStyle }}>{ri === 0 && ci === 0 ? 'Data' : ''}</td>
                                          ))}
                                        </tr>
                                      ))
                                    )}
                                  </tbody>
                                </table>
                              </div>
                                );
                              })()
                            ) : box.type === 'logo' ? (
                              <div className="box-content box-content-logo" style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', padding: 4, cursor: 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 4 }}>
                                <span className="logo-placeholder-icon" aria-hidden>🖼</span>
                                <span className="logo-placeholder-text">{box.labelName || 'Logo'}</span>
                              </div>
                            ) : (
                              <div className="box-content" style={{ position: 'absolute', left: 0, top: 0, width: '100%', padding: 4, paddingLeft: 28, boxSizing: 'border-box', cursor: 'default', whiteSpace: 'normal', wordBreak: 'break-word', overflowWrap: 'break-word', overflow: 'visible', textOverflow: 'clip' }}>
                                {(() => {
                                  const rawLabel = box.labelName || (box.fieldName ? String(box.fieldName).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '');
                                  const label = (rawLabel && String(rawLabel).trim().endsWith('...') && box.fieldName) ? String(box.fieldName).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : rawLabel;
                                  const labelOnly = !!box.properties?.labelOnly;
                                  const valueOnly = !!box.properties?.valueOnly;
                                  const emptyBox = !!box.properties?.emptyBox;
                                  const placeholder = box.content || `{{${box.fieldName || 'field'}}}`;
                                  const numP = Math.max(1, Math.min(100, dataTableLayout.numPages || 1));
                                  const dataWithPages = { ...(typeof demoData === 'object' && demoData ? demoData : {}), pages: `${pageIndex + 1} of ${numP}` };
                                  const displayText = replacePlaceholdersInContent(placeholder, dataWithPages);
                                  const valueEmpty = displayText.trim() === '';
                                  if (emptyBox) return <span></span>;
                                  if (valueOnly) return <span>{valueEmpty ? '\u00A0' : displayText}</span>;
                                  if (labelOnly && label) return <span>{label}</span>;
                                  if (label) return <span><strong>{label}:</strong>{valueEmpty ? '' : ` ${displayText}`}</span>;
                                  if (box.content && String(box.content).trim()) return replacePlaceholdersInContent(box.content, dataWithPages);
                                  if (box.fieldName) return valueEmpty ? '\u00A0' : displayText;
                                  return '\u00A0';
                                })()}
                              </div>
                            )}
                            {selectedBoxIds.includes(box.id) && (
                              <>
                                <button key="box-delete-btn" type="button" className="editor-box-delete-btn" onClick={(e) => { e.stopPropagation(); e.preventDefault(); deleteBox(box.id); }} title="Delete box" aria-label="Delete box">×</button>
                                {['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w'].map((h) => (
                                  <div key={h} className={`resize-handle resize-handle-${h}`} onMouseDown={(e) => handleResizeStart(e, box.id, h)} />
                                ))}
                              </>
                            )}
                          </div>
                        );
                      })}
                      </div>
                    ]}
                      </div>
                    </div>
                  </div>
                  );
                })}
              </div>
            ) : (
              <div
                key="single-page-canvas"
                className="canvas"
                style={{
                  width: canvasDims.width,
                  height: canvasDims.height + (Math.max(0, Number(dataTableLayout.totalExtraHeight)) || 0),
                  minHeight: canvasDims.height,
                  ...(canvasBackgroundImage && {
                    backgroundImage: `url(${canvasBackgroundImage})`,
                    backgroundSize: '100% 100%',
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'top left',
                  }),
                }}
                onMouseDown={(e) => {
                  if (e.target.closest('.editor-box')) return;
                  if (draggingBox || resizingBox) return;
                  const canvas = e.currentTarget;
                  const rect = canvas.getBoundingClientRect();
                  setMarquee({ start: { x: e.clientX - rect.left, y: e.clientY - rect.top }, end: { x: e.clientX - rect.left, y: e.clientY - rect.top } });
                }}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
                onDrop={(e) => {
                  e.preventDefault();
                  const rect = e.currentTarget.getBoundingClientRect();
                  const dropPos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
                  if (draggingStandardizedKey) {
                    addBoxFromStandardizedKey(draggingStandardizedKey, dropPos);
                    setDraggingStandardizedKey(null);
                  } else if (draggingFromLibrary) {
                    addBoxToCanvas(draggingFromLibrary, dropPos);
                    setDraggingFromLibrary(null);
                  }
                }}
              >
              {[
                <div
                  key="page-boundary-guide-single"
                  className="page-boundary-guide"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: canvasDims.width,
                    height: canvasDims.height,
                    border: '2px dashed rgba(0,0,0,0.35)',
                    pointerEvents: 'none',
                    zIndex: 50,
                    boxSizing: 'border-box',
                  }}
                  title="Page boundary – place boxes inside this area"
                />,
                ...(marquee ? [<div
                  key="canvas-marquee"
                  className="canvas-marquee"
                  style={{
                    position: 'absolute',
                    left: `${Math.min(marquee.start.x, marquee.end.x)}px`,
                    top: `${Math.min(marquee.start.y, marquee.end.y)}px`,
                    width: `${Math.abs(marquee.end.x - marquee.start.x)}px`,
                    height: `${Math.abs(marquee.end.y - marquee.start.y)}px`,
                    border: '2px dashed #3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    pointerEvents: 'none',
                    zIndex: 999,
                  }}
                />] : []),
                <div key="document-title" className="document-title">{documentTitle}</div>,
                ...boxes.sort((a, b) => (a.rank || 0) - (b.rank || 0)).map((box, boxIdx) => {
                const isDataTableBox = box.type === 'table' && box.tableConfig?.dynamicRowsFromData && Array.isArray(box.tableConfig?.columnKeys);
                const effectiveH = dataTableLayout.effectiveHeightByBoxId[box.id];
                const useHeight = isDataTableBox && effectiveH != null ? effectiveH : (box.size?.height ?? 20);
                const offsetY = dataTableLayout.boxYOffset[box.id] || 0;
                return (
                <div
                  key={box.id ?? `box-${boxIdx}`}
                  className={`editor-box ${selectedBoxIds.includes(box.id) ? 'selected' : ''} ${draggingBox === box.id ? 'dragging' : ''} ${overlappingBox === box.id ? 'overlapping' : ''}`}
                  style={{
                    left: `${box.position.x}px`,
                    top: `${(box.position?.y ?? 0) + offsetY}px`,
                    width: `${box.size.width}px`,
                    height: `${useHeight}px`,
                    fontSize: `${ptToPx(box.properties?.fontSize || 12)}px`,
                    fontFamily: box.properties?.fontFamily || 'Arial',
                    fontWeight: box.properties?.fontWeight || 'normal',
                    color: box.properties?.fontColor || '#000000',
                    backgroundColor: box.properties?.backgroundColor || 'transparent',
                    textAlign: box.properties?.alignment || 'left',
                    cursor: isDragging && draggingBox === box.id ? 'grabbing' : 'grab',
                    zIndex: draggingBox === box.id ? 1000 : (selectedBoxIds.includes(box.id) ? 100 : 1),
                              ...(box.properties?.border !== false ? (() => {
                      const edges = getBoxEdgeVisibility(box, boxes, ADJACENT_EPS, dataTableLayout);
                      const line = '1px solid #3b82f6';
                      return {
                        borderLeft: edges.left ? line : 'none',
                        borderRight: edges.right ? line : 'none',
                        borderTop: edges.top ? line : 'none',
                        borderBottom: edges.bottom ? line : 'none',
                      };
                    })() : { border: 'none' }),
                  }}
                  onMouseDown={(e) => handleMouseDown(e, box.id)}
                  onClick={(e) => {
                    if (!isDragging) {
                      if (e.shiftKey) {
                        setSelection(selectedBoxIds.includes(box.id) ? selectedBoxIds.filter((id) => id !== box.id) : [...selectedBoxIds, box.id]);
                      } else {
                        setSelection([box.id]);
                      }
                    }
                  }}
                  onDoubleClick={(e) => { if (!isDragging) handleBoxDoubleClick(e, box); }}
                >
                  <div className="box-handle">⋮⋮</div>
                  {box.type === 'table' && box.tableConfig ? (
                    <div className="table-preview" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', padding: '4px 4px 0 4px', boxSizing: 'border-box', overflow: 'visible' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, tableLayout: 'fixed' }}>
                        <thead>
                          <tr>
                            {box.tableConfig.headers.map((h, i) => (
                              <th key={i} style={{ border: '1px solid #ccc', padding: 4, textAlign: 'left', backgroundColor: '#f0f0f0' }}>{h || `H${i + 1}`}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {box.tableConfig.dynamicRowsFromData && Array.isArray(box.tableConfig.columnKeys) && demoData && typeof demoData === 'object' ? (
                            (() => {
                              const rowCount = getDataTableRowCount(demoData, box.tableConfig.columnKeys);
                              if (rowCount === 0) {
                                return (
                                  <tr><td colSpan={box.tableConfig.headers?.length || 1} style={{ border: 'none', padding: 8, color: '#666' }}>No demo data rows (use keys like marks_and_numbers_1, marks_and_numbers_2, …)</td></tr>
                                );
                              }
                              return Array.from({ length: rowCount }).map((_, ri) => (
                                <tr key={ri}>
                                  {(box.tableConfig.columnKeys || box.tableConfig.headers || []).map((_, ci) => (
                                    <td key={ci} style={{ border: 'none', padding: 4 }}>{getDataTableCell(demoData, box.tableConfig.columnKeys, ri + 1, ci)}</td>
                                  ))}
                                </tr>
                              ));
                            })()
                          ) : (
                            Array.from({ length: box.tableConfig.rows || 1 }).map((_, ri) => (
                              <tr key={ri}>
                                {box.tableConfig.headers.map((_, ci) => (
                                  <td key={ci} style={{ border: 'none', padding: 4 }}>{ri === 0 && ci === 0 ? 'Data' : ''}</td>
                                ))}
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  ) : box.type === 'logo' ? (
                    <div className="box-content box-content-logo" style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', padding: 4, cursor: 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 4 }}>
                      <span className="logo-placeholder-icon" aria-hidden>🖼</span>
                      <span className="logo-placeholder-text">{box.labelName || 'Logo'}</span>
                    </div>
                  ) : (
                    <div
                      className="box-content"
                      style={{
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        width: '100%',
                        padding: 4,
                        paddingLeft: 28,
                        boxSizing: 'border-box',
                        cursor: 'default',
                        whiteSpace: 'normal',
                        wordBreak: 'break-word',
                        overflowWrap: 'break-word',
                        overflow: 'visible',
                        textOverflow: 'clip',
                      }}
                    >
                      {(() => {
                        const rawLabel = box.labelName || (box.fieldName ? String(box.fieldName).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '');
                        const label = (rawLabel && String(rawLabel).trim().endsWith('...') && box.fieldName) ? String(box.fieldName).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : rawLabel;
                        const labelOnly = !!box.properties?.labelOnly;
                        const valueOnly = !!box.properties?.valueOnly;
                        const emptyBox = !!box.properties?.emptyBox;
                        const placeholder = box.content || `{{${box.fieldName || 'field'}}}`;
                        const numP = Math.max(1, Math.min(100, dataTableLayout.numPages || 1));
                        const boxGlobalTop = (box.position?.y ?? 0) + (dataTableLayout.boxYOffset[box.id] || 0);
                        const boxPageIndex = Math.min(Math.max(0, Math.floor(boxGlobalTop / canvasDims.height)), numP - 1);
                        const dataWithPages = { ...(typeof demoData === 'object' && demoData ? demoData : {}), pages: `${boxPageIndex + 1} of ${numP}` };
                        const displayText = replacePlaceholdersInContent(placeholder, dataWithPages);
                        const valueEmpty = displayText.trim() === '';
                        if (emptyBox) return <span></span>;
                        if (valueOnly) return <span>{valueEmpty ? '\u00A0' : displayText}</span>;
                        if (labelOnly && label) return <span>{label}</span>;
                        if (label) return <span><strong>{label}:</strong>{valueEmpty ? '' : ` ${displayText}`}</span>;
                        if (box.content && String(box.content).trim()) return replacePlaceholdersInContent(box.content, dataWithPages);
                        if (box.fieldName) return valueEmpty ? '\u00A0' : displayText;
                        return '\u00A0';
                      })()}
                    </div>
                  )}
                  {selectedBoxIds.includes(box.id) && (
                    <>
                      <button
                        key="box-delete-btn"
                        type="button"
                        className="editor-box-delete-btn"
                        onClick={(e) => { e.stopPropagation(); e.preventDefault(); deleteBox(box.id); }}
                        title="Delete box"
                        aria-label="Delete box"
                      >
                        ×
                      </button>
                      {['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w'].map((h) => (
                        <div key={h} className={`resize-handle resize-handle-${h}`} onMouseDown={(e) => handleResizeStart(e, box.id, h)} />
                      ))}
                    </>
                  )}
                </div>
                );
              })
            ]}
            </div>
            )}
          </div>
        </main>

        <aside className="editor-sidebar editor-sidebar-right">
          <div className="sidebar-section">
            <h3 className="section-header">Template designs</h3>
            <p className="save-template-section-hint">Load a saved layout, then map standardized keys to boxes.</p>
            <button
              type="button"
              className="toolbar-button save-template-button"
              style={{ width: '100%', marginBottom: 10 }}
              onClick={() => { setSaveDesignName(''); setShowSaveDesignModal(true); }}
            >
              Save design
            </button>
            <div className="template-designs-list">
              {sortedTemplateDesigns.length === 0 ? (
                <p className="save-template-section-hint">No saved designs yet.</p>
              ) : editorMode === 'standardized' && !selectedStandardizedId ? (
                <>
                  <p key="designs-format-hint" className="save-template-section-hint template-designs-format-hint">Select a format in the left sidebar to use template designs.</p>
                  {sortedTemplateDesigns.map((td, idx) => (
                    <div
                      key={td.id ?? `design-disabled-${idx}`}
                      className="template-design-item template-design-item-thumb template-design-item-disabled"
                      title="Select a format first"
                      aria-disabled="true"
                    >
                      <DesignThumbnail design={td} />
                    </div>
                  ))}
                </>
              ) : (
                <>
                  {editorMode === 'standardized' && selectedStandardizedId && (
                    <p key="designs-recommended-hint" className="save-template-section-hint" style={{ marginBottom: 8 }}>
                      Designs linked to this format show a green &quot;Recommended&quot; badge.
                    </p>
                  )}
                  {sortedTemplateDesigns.map((td, designIdx) => {
                    const formatId = (td.standardizedTemplateId ?? td.standardized_template_id ?? '').toString().toLowerCase();
                    const selectedId = (selectedStandardizedId ?? '').toString().toLowerCase();
                    const isRecommended = editorMode === 'standardized' && selectedId && formatId === selectedId;
                    return (
                      <div
                        key={td.id ?? `design-${designIdx}`}
                        className={`template-design-item template-design-item-thumb ${isRecommended ? 'template-design-item-recommended' : ''} ${selectedDesignId === td.id ? 'selected' : ''}`}
                        onClick={() => handleLoadDesign(td.id)}
                      >
                        {isRecommended && <div className="template-design-item-recommended-badge">Recommended</div>}
                        <DesignThumbnail design={td} />
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          </div>
        </aside>
      </div>

      {showSaveDesignModal && (
        <div className="save-template-modal-overlay" onClick={() => setShowSaveDesignModal(false)}>
          <div className="save-template-modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="save-template-modal-title">Save template design</h2>
            <p className="save-template-section-hint">Save current box layout (positions/sizes). You can load this design and map standardized keys to boxes.</p>
            <div className="save-template-modal-form">
              <div className="save-template-field">
                <label>Design name</label>
                <input
                  type="text"
                  value={saveDesignName}
                  onChange={(e) => setSaveDesignName(e.target.value)}
                  placeholder="e.g. Bill of Lading layout 1"
                />
              </div>
            </div>
            <div className="save-template-modal-actions">
              <button type="button" className="toolbar-button save-template-modal-cancel" onClick={() => setShowSaveDesignModal(false)}>Cancel</button>
              <button type="button" className="toolbar-button save-template-modal-save" onClick={handleSaveDesignModalSave} disabled={savingDesign}>
                {savingDesign ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showExportVariablesModal && (
        <div className="save-template-modal-overlay" onClick={() => setShowExportVariablesModal(false)}>
          <div className="save-template-modal export-variables-modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="save-template-modal-title">Export Variables</h2>
            <p className="save-template-section-hint">Template variables in JSON format. Use Copy to paste into your application.</p>
            <div className="export-variables-content">
              <textarea
                className="export-variables-textarea"
                readOnly
                value={exportVariablesJson}
                spellCheck={false}
                aria-label="Variables JSON"
              />
            </div>
            <div className="save-template-modal-actions">
              <button type="button" className="toolbar-button export-variables-copy-btn" onClick={handleCopyExportVariables} title="Copy all to clipboard">
                📋 Copy
              </button>
              <button type="button" className="toolbar-button save-template-modal-cancel" onClick={() => setShowExportVariablesModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {showSaveTemplateModal && (
        <div className="save-template-modal-overlay" onClick={() => setShowSaveTemplateModal(false)}>
          <div className="save-template-modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="save-template-modal-title">Save Template</h2>
            <div className="save-template-modal-form">
              <div className="save-template-field">
                <label>Template name</label>
                <input
                  type="text"
                  value={saveModalTemplateName}
                  onChange={(e) => setSaveModalTemplateName(e.target.value)}
                  placeholder="e.g. Bill of Lading"
                />
              </div>
              <div className="save-template-field">
                <label>Document name</label>
                <input
                  type="text"
                  value={saveModalDocumentName}
                  onChange={(e) => setSaveModalDocumentName(e.target.value)}
                  placeholder="e.g. Document title"
                />
              </div>
              <div className="save-template-section">
                <label className="save-template-section-label">Parameters (key–value)</label>
                <p className="save-template-section-hint">Edit keys and values below. Use + to add a row, ✏ to edit, 🗑 to remove. Saved as JSON.</p>
                <div className="save-template-kv-toolbar">
                  <button type="button" className="save-template-add-row-btn" onClick={addSaveModalRow} title="Add new row">
                    + Add row
                  </button>
                </div>
                <div className="save-template-kv-table-wrap">
                  {saveModalKeyValues.length === 0 ? (
                    <p className="save-template-batch-empty">No parameters yet. Click &quot;+ Add row&quot; or add boxes on the canvas.</p>
                  ) : (
                    <table className="save-template-kv-table">
                      <thead>
                        <tr>
                          <th>Key</th>
                          <th>Value</th>
                          <th className="save-template-kv-actions-th">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {saveModalKeyValues
                          .map((kv, index) => ({ ...kv, _idx: index }))
                          .sort((a, b) => sortKvByKey(a, b))
                          .map((kv) => (
                          <tr key={kv.boxId ? `box-${kv.boxId}` : `row-${kv._idx}`}>
                            <td>
                              <input
                                type="text"
                                value={kv.key || ''}
                                onChange={(e) => updateSaveModalKeyValue(kv._idx, 'key', e.target.value)}
                                placeholder="field_name"
                                className="save-template-kv-input"
                                title="Edit key"
                              />
                            </td>
                            <td>
                              <input
                                type="text"
                                value={kv.value || ''}
                                onChange={(e) => updateSaveModalKeyValue(kv._idx, 'value', e.target.value)}
                                placeholder="{{field_name}} or text"
                                className="save-template-kv-input"
                                title="Edit value"
                              />
                            </td>
                            <td className="save-template-kv-actions-td">
                              <button
                                type="button"
                                className="save-template-row-btn save-template-edit-btn"
                                onClick={(e) => e.currentTarget.closest('tr')?.querySelector('.save-template-kv-input')?.focus()}
                                title="Edit row"
                              >
                                ✏
                              </button>
                              <button
                                type="button"
                                className="save-template-row-btn save-template-delete-btn"
                                onClick={() => removeSaveModalRow(kv._idx)}
                                title="Delete row"
                              >
                                🗑
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
            <div className="save-template-modal-actions">
              <button type="button" className="toolbar-button save-template-modal-cancel" onClick={() => setShowSaveTemplateModal(false)}>
                Cancel
              </button>
              <button type="button" className="toolbar-button save-template-modal-save" onClick={handleSaveTemplateModalSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteConfirm && (
        <div className="save-template-modal-overlay" onClick={() => !deleting && setShowDeleteConfirm(false)}>
          <div className="save-template-modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="save-template-modal-title">Delete template</h2>
            <p className="delete-confirm-message">
              Are you sure you want to delete this template? This action cannot be undone.
            </p>
            <div className="save-template-modal-actions">
              <button type="button" className="toolbar-button save-template-modal-cancel" onClick={() => !deleting && setShowDeleteConfirm(false)} disabled={deleting}>
                Cancel
              </button>
              <button type="button" className="toolbar-button delete-template-confirm-btn" onClick={handleConfirmDeleteTemplate} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TemplateEditor;
