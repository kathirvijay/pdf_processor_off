const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const {
  replacePlaceholders,
  buildMultiPageLayout,
  getDataTableRowCount,
  getDataTableCell,
  getDataTableRowRangeForPage,
  getEditorPageHeight,
  EDITOR_TITLE_AREA_PX,
  DATA_TABLE_HEADER_ROW_PX,
  DATA_TABLE_ROW_HEIGHT_PX,
  DATA_TABLE_ATTACHED_LIST_THRESHOLD,
  EMPTY_BOX_BELOW_TABLE_PX,
} = require('./pdfGenerator');

const DATA_TABLE_ATTACHED_LIST_GAP_PX = 100;
const MIN_ROW_PX = 22;
const EXTRA_PX_PER_LINE = 14;
const CHARS_PER_LINE_ESTIMATE = 45;

/** Estimate row height (px) from cell text lengths – more lines for longer content. */
function estimateRowHeightPx(dataObj, columnKeys, rowIndex1Based, boxWidthPx, colCount) {
  let maxLines = 1;
  const colWidthPx = Math.max(40, (boxWidthPx - 8) / colCount);
  for (let ci = 0; ci < colCount; ci++) {
    const text = getDataTableCell(dataObj, columnKeys, rowIndex1Based, ci) || '';
    const len = String(text).length;
    const lines = Math.max(1, Math.ceil((len || 0) / Math.max(1, CHARS_PER_LINE_ESTIMATE)));
    maxLines = Math.max(maxLines, Math.min(lines, 15));
  }
  return MIN_ROW_PX + (maxLines - 1) * EXTRA_PX_PER_LINE;
}

/** Build per-table ranges by accumulating row heights so items per page are dynamic. */
function buildDynamicTableRanges(box, dataObj, contentHeightPx) {
  const columnKeys = box.tableConfig?.columnKeys;
  if (!Array.isArray(columnKeys) || !columnKeys.length) return { ranges: [], rowHeightsPx: [] };
  const rowCount = getDataTableRowCount(dataObj, columnKeys);
  if (rowCount <= 0) return { ranges: [{ startRow: 0, endRow: 0 }], rowHeightsPx: [] };

  const boxWidthPx = Math.max(100, box.size?.width ?? 100);
  const colCount = columnKeys.length;
  const rowHeightsPx = [];
  for (let ri = 1; ri <= rowCount; ri++) {
    rowHeightsPx.push(estimateRowHeightPx(dataObj, columnKeys, ri, boxWidthPx, colCount));
  }

  const useAttachedList = rowCount > DATA_TABLE_ATTACHED_LIST_THRESHOLD;
  const availablePx = contentHeightPx - DATA_TABLE_HEADER_ROW_PX;
  const ranges = [];
  if (useAttachedList) ranges.push({ startRow: 0, endRow: 0 });

  let start = 0;
  while (start < rowCount) {
    let accum = 0;
    let end = start;
    while (end < rowCount && accum + rowHeightsPx[end] <= availablePx) {
      accum += rowHeightsPx[end];
      end++;
    }
    if (end === start) end = Math.min(start + 1, rowCount);
    ranges.push({ startRow: start, endRow: end });
    start = end;
  }
  return { ranges, rowHeightsPx };
}

function escapeHtml(str) {
  if (str == null) return '';
  const s = String(str);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getDisplayLabel(box) {
  const raw = box.labelName || (box.fieldName ? String(box.fieldName).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '');
  if (raw && String(raw).trim().endsWith('...') && box.fieldName) return String(box.fieldName).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return raw;
}

/**
 * Generate PDF from template + data using Puppeteer (HTML → print to PDF).
 * Same API as pdfGenerator.generatePdf: (template, data, uploadsDir) → { filename, filepath, fileSize }.
 */
async function generatePdfPuppeteer(template, data, uploadsDir) {
  const dataObj = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  const settings = template.settings || {};
  let pages = template.pages;
  if (!Array.isArray(pages)) {
    if (pages != null && typeof pages === 'string') {
      try {
        const parsed = JSON.parse(pages);
        pages = Array.isArray(parsed) ? parsed : parsed != null ? [parsed] : [];
      } catch (_) {
        pages = [];
      }
    } else {
      pages = pages != null ? [pages] : [];
    }
  }
  pages = pages.map((p) => (p && typeof p === 'object' ? p : { boxes: [] }));

  if (pages.length === 0) throw new Error('Template has no pages');

  const orientation = String(settings.orientation || 'portrait').toLowerCase();
  const pageSize = typeof settings.pageSize === 'string' ? settings.pageSize : 'A4';
  const documentTitle = settings.title || template.name || '';

  const allBoxes = pages.reduce((acc, p) => acc.concat(p.boxes || []), []);
  const sortedBoxes = [...allBoxes].sort((a, b) => (a.rank || 0) - (b.rank || 0));

  const editorPageHeightPx = getEditorPageHeight(settings);
  const editorCanvasWidth = orientation === 'portrait' ? 794 : 1123;
  const pageWidthPx = orientation === 'portrait' ? 794 : 1123;
  const pageHeightPx = editorPageHeightPx;
  const contentHeightPx = pageHeightPx - EDITOR_TITLE_AREA_PX;

  const dynamicTableCachePx = new Map();
  const layoutEffectiveHeightByBoxId = {};
  const layoutTablePageCountByBoxId = {};
  sortedBoxes.forEach((box) => {
    if (box.type !== 'table' || !box.tableConfig?.dynamicRowsFromData || !Array.isArray(box.tableConfig?.columnKeys)) return;
    const { ranges, rowHeightsPx } = buildDynamicTableRanges(box, dataObj, contentHeightPx);
    dynamicTableCachePx.set(box.id, { ranges, rowHeightsPx });
    layoutTablePageCountByBoxId[box.id] = ranges.length;
    const rowCount = getDataTableRowCount(dataObj, box.tableConfig.columnKeys);
    const singleDataPageNoAttachedList = ranges.length === 1 && rowCount > 0 && (ranges[0].endRow - ranges[0].startRow >= rowCount);
    if (singleDataPageNoAttachedList && rowHeightsPx.length > 0) {
      const sum = rowHeightsPx.reduce((a, b) => a + b, 0);
      const rowsOnFirst = Math.max(1, Number(box.tableConfig?.rowsOnFirstPage) || 3);
      const includeGap = rowCount <= DATA_TABLE_ATTACHED_LIST_THRESHOLD && rowCount <= rowsOnFirst;
      layoutEffectiveHeightByBoxId[box.id] = DATA_TABLE_HEADER_ROW_PX + sum + (includeGap ? EMPTY_BOX_BELOW_TABLE_PX : 0);
    }
  });

  const layoutOverrides = {
    effectiveHeightByBoxId: Object.keys(layoutEffectiveHeightByBoxId).length ? layoutEffectiveHeightByBoxId : undefined,
    tablePageCountByBoxId: Object.keys(layoutTablePageCountByBoxId).length ? layoutTablePageCountByBoxId : undefined,
  };
  const layout = buildMultiPageLayout(sortedBoxes, dataObj, editorPageHeightPx, layoutOverrides);
  let { effectiveHeightByBoxId, boxYOffset, numPages } = layout;

  let lastTablePageIndex = -1;
  dynamicTableCachePx.forEach(({ ranges }) => {
    if (ranges.length > 0) lastTablePageIndex = Math.max(lastTablePageIndex, ranges.length - 1);
  });
  if (lastTablePageIndex >= 0) {
    numPages = Math.min(numPages, lastTablePageIndex + 1);
  }

  const templateId = template.id != null ? String(template.id) : 'unknown';
  const filename = `pdf_${Date.now()}_${templateId}.pdf`;
  const filepath = path.join(uploadsDir, filename);

  const htmlParts = [];
  htmlParts.push(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, sans-serif; }
    .pdf-page { position: relative; width: ${pageWidthPx}px; height: ${pageHeightPx}px; page-break-after: always; overflow: hidden; background: #fff; }
    .pdf-page:last-child { page-break-after: auto; }
    .pdf-title { position: absolute; left: 0; top: 19px; width: 100%; text-align: center; font-size: 20px; font-weight: bold; background: #fff; z-index: 1; }
    .pdf-content { position: absolute; left: 0; top: ${EDITOR_TITLE_AREA_PX}px; width: ${pageWidthPx}px; height: ${contentHeightPx}px; background: #fff; }
    .pdf-box { position: absolute; padding: 4px; white-space: normal; word-break: break-word; overflow-wrap: break-word; border: 1px solid #000; }
    .pdf-box-table { border: none; padding: 0; }
    .pdf-box-table table { width: 100%; border-collapse: collapse; font-size: 11px; border: 1px solid #000; }
    .pdf-box-table.pdf-box-table-with-gap table { border: none; }
    .pdf-box-table th { border: 1px solid #000; padding: 4px; text-align: left; background: #f0f0f0; }
    .pdf-box-table td { border: none; padding: 4px; text-align: left; }
  </style></head><body>`);

  const GAP_BELOW_TABLE_PX = 12;

  for (let pageIndex = 0; pageIndex < numPages; pageIndex++) {
    const pageTopEditor = pageIndex * editorPageHeightPx;
    const pageBottomEditor = (pageIndex + 1) * editorPageHeightPx;

    let tableBottomOnThisPagePx = 0;
    if (pageIndex === lastTablePageIndex && lastTablePageIndex >= 0) {
      sortedBoxes.forEach((box) => {
        if (box.type !== 'table' || !box.tableConfig?.dynamicRowsFromData || !Array.isArray(box.tableConfig?.columnKeys)) return;
        const cache = dynamicTableCachePx.get(box.id);
        const range = cache?.ranges[pageIndex] ?? { startRow: 0, endRow: 0 };
        if (range.endRow <= range.startRow) return;
        const headerPx = DATA_TABLE_HEADER_ROW_PX;
        let rowH = (range.endRow - range.startRow) * DATA_TABLE_ROW_HEIGHT_PX;
        if (cache?.rowHeightsPx?.length) {
          rowH = cache.rowHeightsPx.slice(range.startRow, range.endRow).reduce((a, b) => a + b, 0);
        }
        tableBottomOnThisPagePx = Math.max(tableBottomOnThisPagePx, headerPx + rowH);
      });
    }

    htmlParts.push(`<div class="pdf-page">`);
    if (documentTitle) {
      htmlParts.push(`<div class="pdf-title">${escapeHtml(documentTitle)}</div>`);
    }
    htmlParts.push(`<div class="pdf-content">`);

    for (const box of sortedBoxes) {
      const globalY = (box.position?.y ?? 0) + (boxYOffset[box.id] || 0);
      const boxH = effectiveHeightByBoxId[box.id] ?? box.size?.height ?? 20;
      const globalBottom = globalY + boxH;

      const isDataTable = box.type === 'table' && box.tableConfig?.dynamicRowsFromData && Array.isArray(box.tableConfig?.columnKeys);
      if (isDataTable) {
        const columnKeys = box.tableConfig.columnKeys;
        const rowCount = getDataTableRowCount(dataObj, columnKeys);
        const cache = dynamicTableCachePx.get(box.id);
        const range = cache
          ? (cache.ranges[pageIndex] ?? { startRow: 0, endRow: 0 })
          : getDataTableRowRangeForPage({ ...box, tableConfig: { ...box.tableConfig, rowsOnOtherPages: null } }, pageIndex, rowCount, contentHeightPx);
        const showAttachedListMessage = pageIndex === 0 && rowCount > DATA_TABLE_ATTACHED_LIST_THRESHOLD;
        /* On page 0 always draw table (at least header); on later pages skip only when no rows on this page */
        if (range.endRow <= range.startRow && !showAttachedListMessage && pageIndex > 0) continue;
      } else {
        if (boxH <= 0) continue;
        const wouldBeOnPageAfterLastTable = lastTablePageIndex >= 0 && globalY >= (lastTablePageIndex + 1) * editorPageHeightPx;
        if (wouldBeOnPageAfterLastTable) {
          if (pageIndex !== lastTablePageIndex) continue;
        } else if (globalBottom <= pageTopEditor || globalY >= pageBottomEditor) {
          continue;
        }
      }

      const wouldBeOnPageAfterLastTable = !isDataTable && lastTablePageIndex >= 0 && globalY >= (lastTablePageIndex + 1) * editorPageHeightPx;
      let localYEditor = pageIndex === 0 ? Math.max(0, globalY - EDITOR_TITLE_AREA_PX) : globalY - pageTopEditor;
      if (wouldBeOnPageAfterLastTable && pageIndex === lastTablePageIndex) {
        localYEditor = tableBottomOnThisPagePx + GAP_BELOW_TABLE_PX;
      }
      const clipBottomEditor = contentHeightPx - localYEditor;
      const x = box.position?.x ?? 0;
      let y = localYEditor;
      let w = Math.max(10, box.size?.width ?? 100);
      let h = Math.max(10, box.size?.height ?? 20);
      if (boxH !== (box.size?.height ?? 20)) h = Math.max(10, Math.min(boxH, clipBottomEditor));

      const fontSize = Math.max(8, Math.min(72, Number(box.properties?.fontSize) || 12));
      const fontColor = (box.properties?.fontColor || '#000000').trim();
      const fontFamily = (box.properties?.fontFamily || 'Arial').trim() || 'Arial';

      if (box.type === 'table' && isDataTable) {
        const columnKeys = box.tableConfig.columnKeys;
        const headers = box.tableConfig.headers || columnKeys.map((k) => k.replace(/_/g, ' '));
        const rowCount = getDataTableRowCount(dataObj, columnKeys);
        const cache = dynamicTableCachePx.get(box.id);
        const range = cache
          ? (cache.ranges[pageIndex] ?? { startRow: 0, endRow: 0 })
          : getDataTableRowRangeForPage({ ...box, tableConfig: { ...box.tableConfig, rowsOnOtherPages: null } }, pageIndex, rowCount, contentHeightPx);
        const showAttachedListMessage = pageIndex === 0 && rowCount > DATA_TABLE_ATTACHED_LIST_THRESHOLD && range.endRow <= range.startRow;

        const colCount = columnKeys.length;
        const colWidths = (box.tableConfig.columnWidths && Array.isArray(box.tableConfig.columnWidths) && box.tableConfig.columnWidths.length === colCount)
          ? box.tableConfig.columnWidths
          : Array.from({ length: colCount }, () => 100 / colCount);
        const cellWrap = 'word-break:break-word;overflow-wrap:break-word;white-space:normal;';

        let tableHtml = '<table style="table-layout:fixed;width:100%;"><colgroup>';
        for (let ci = 0; ci < colCount; ci++) {
          const pct = Math.max(1, Math.min(100, Number(colWidths[ci]) || 100 / colCount));
          tableHtml += `<col style="width:${pct}%">`;
        }
        tableHtml += '</colgroup><thead><tr>';
        for (const hd of headers) tableHtml += `<th style="border:1px solid #000;padding:4px;text-align:left;background:#f0f0f0;${cellWrap}">${escapeHtml(hd || '')}</th>`;
        tableHtml += '</tr></thead><tbody>';

        if (showAttachedListMessage) {
          tableHtml += `<tr><td colspan="${headers.length}" style="border:none;text-align:center;font-style:italic;vertical-align:bottom;height:${DATA_TABLE_ATTACHED_LIST_GAP_PX}px;">Find the details of elements in attached list.</td></tr>`;
        } else {
          for (let ri = range.startRow; ri < range.endRow; ri++) {
            tableHtml += '<tr>';
            for (let ci = 0; ci < columnKeys.length; ci++) {
              const cell = getDataTableCell(dataObj, columnKeys, ri + 1, ci);
              tableHtml += `<td style="border:none;padding:4px;${cellWrap}">${escapeHtml(cell)}</td>`;
            }
            tableHtml += '</tr>';
          }
        }
        tableHtml += '</tbody></table>';

        if (pageIndex > 0) {
          y = 0;
          const headerPx = DATA_TABLE_HEADER_ROW_PX;
          if (cache && cache.rowHeightsPx.length) {
            let sum = 0;
            for (let ri = range.startRow; ri < range.endRow; ri++) sum += cache.rowHeightsPx[ri];
            h = headerPx + sum;
          } else {
            const numRows = range.endRow - range.startRow;
            h = headerPx + numRows * DATA_TABLE_ROW_HEIGHT_PX;
          }
        }
        const rowsOnFirst = Math.max(1, Number(box.tableConfig?.rowsOnFirstPage) || 3);
        const tableIncludesGap = pageIndex === 0 && rowCount <= DATA_TABLE_ATTACHED_LIST_THRESHOLD && rowCount <= rowsOnFirst;
        const gapDiv = tableIncludesGap ? `<div style="width:100%;height:${EMPTY_BOX_BELOW_TABLE_PX}px;flex-shrink:0;"></div>` : '';
        const tableClass = tableIncludesGap ? 'pdf-box pdf-box-table pdf-box-table-with-gap' : 'pdf-box pdf-box-table';
        const tableStyle = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;font-size:${fontSize}px;${tableIncludesGap ? 'border:1px solid #000;display:flex;flex-direction:column;' : ''}`;
        htmlParts.push(`<div class="${tableClass}" style="${tableStyle}">${tableHtml}${gapDiv}</div>`);
        continue;
      }

      const dataWithPages = { ...dataObj, pages: `${pageIndex + 1} of ${numPages}` };
      const displayLabel = getDisplayLabel(box);
      const labelOnly = !!box.properties?.labelOnly;
      const valueOnly = !!box.properties?.valueOnly;
      const emptyBox = !!box.properties?.emptyBox;
      const value = box.content || `{{${box.fieldName || 'field'}}}`;
      const valueStr = replacePlaceholders(value, dataWithPages);

      let content = '';
      if (emptyBox) content = '';
      else if (valueOnly) content = valueStr != null ? String(valueStr) : '';
      else if (labelOnly && displayLabel) content = displayLabel;
      else if (displayLabel) content = valueStr && String(valueStr).trim() ? `${displayLabel}: ${valueStr}` : `${displayLabel}:`;
      else if (box.content) content = replacePlaceholders(box.content || '', dataWithPages);
      else if (box.fieldName) content = replacePlaceholders(`{{${box.fieldName}}}`, dataWithPages);

      const borderCss = box.properties?.border === false ? 'border:none;' : 'border:1px solid #000;';
      const boxStyle = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;font-size:${fontSize}px;font-family:${escapeHtml(fontFamily)};color:${escapeHtml(fontColor)};${borderCss}`;
      htmlParts.push(`<div class="pdf-box" style="${boxStyle}">${escapeHtml(content)}</div>`);
    }

    htmlParts.push('</div></div>');
  }

  htmlParts.push('</body></html>');
  const html = htmlParts.join('');

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    await page.setViewport({
      width: pageWidthPx,
      height: Math.max(pageHeightPx, pageHeightPx * numPages),
      deviceScaleFactor: 1,
    });
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.pdf({
      path: filepath,
      format: pageSize,
      landscape: orientation === 'landscape',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
  } finally {
    if (browser) await browser.close();
  }

  const fileSize = fs.statSync(filepath).size;
  return { filename, filepath, fileSize };
}

module.exports = { generatePdfPuppeteer };
