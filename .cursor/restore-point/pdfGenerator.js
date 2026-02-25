const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const replacePlaceholders = (content, data) => {
  if (!content) return '';
  let result = content;
  Object.keys(data || {}).forEach(key => {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    result = result.replace(regex, data[key] || '');
  });
  return result;
};

function getDataTableRowCount(data, columnKeys) {
  if (!data || !Array.isArray(columnKeys) || !columnKeys.length) return 0;
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
/** When item count exceeds this, first page shows only header + "Find details in attached list"; all rows on attachment pages. */
const DATA_TABLE_ATTACHED_LIST_THRESHOLD = 3;
/** Height (px) reserved for document title on each page; table content uses page height minus this for row-range. */
const EDITOR_TITLE_AREA_PX = 90;

function getDataTableEffectiveHeight(box, data) {
  if (!box?.tableConfig?.dynamicRowsFromData || !Array.isArray(box.tableConfig.columnKeys)) return null;
  const rowCount = getDataTableRowCount(data || {}, box.tableConfig.columnKeys);
  return DATA_TABLE_HEADER_ROW_PX + Math.max(0, rowCount) * DATA_TABLE_ROW_HEIGHT_PX;
}

/** Height of only the first segment (first N rows on page 1). When rowCount > threshold, page 1 = header + 1 message row; else header + up to rowsOnFirst. */
function getDataTableFirstSegmentHeight(box, data) {
  if (!box?.tableConfig?.dynamicRowsFromData || !Array.isArray(box.tableConfig?.columnKeys)) return null;
  const rowCount = getDataTableRowCount(data || {}, box.tableConfig.columnKeys);
  const rowsOnFirst = Math.max(1, Number(box?.tableConfig?.rowsOnFirstPage) || 3);
  const useAttachedListMode = rowCount > DATA_TABLE_ATTACHED_LIST_THRESHOLD;
  const rowsToShow = useAttachedListMode ? 1 : Math.min(rowsOnFirst, Math.max(0, rowCount));
  return DATA_TABLE_HEADER_ROW_PX + rowsToShow * DATA_TABLE_ROW_HEIGHT_PX;
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

/** Build multi-page layout: effective heights (first segment only for data tables so content below flows on page 1), per-box Y offset, total height, and number of pages. Remaining table rows are on attachment pages; totalHeight includes them. */
function buildMultiPageLayout(boxes, data, editorPageHeightPx) {
  const contentHeightPx = editorPageHeightPx - EDITOR_TITLE_AREA_PX;
  const effectiveHeightByBoxId = {};
  let totalExtraHeight = 0;
  boxes.forEach((box) => {
    const designHeight = box.size?.height ?? 20;
    let effective;
    if (box?.tableConfig?.dynamicRowsFromData && Array.isArray(box.tableConfig?.columnKeys)) {
      effective = getDataTableFirstSegmentHeight(box, data);
    }
    if (effective == null) effective = getDataTableEffectiveHeight(box, data);
    if (effective == null) effective = designHeight;
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
    const spacerBottom = firstSegmentBottom + DATA_TABLE_SPACER_PX;
    boxes.forEach((b) => {
      if (b.id === t.id || b.type === 'table') return;
      const bTop = b.position?.y ?? 0;
      const bH = b.size?.height ?? 20;
      const bBottom = bTop + bH;
      const overlapsSpacer = bTop < spacerBottom && bBottom > firstSegmentBottom;
      if (overlapsSpacer && isEmptyBox(b)) {
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
        const spacerBottom = firstSegmentBottom + DATA_TABLE_SPACER_PX;
        const minY = minYBelowTable[t.id];
        if (bTop >= firstSegmentBottom) {
          offset += minY != null ? spacerBottom - minY : (tEffective + DATA_TABLE_SPACER_PX) - tDesign;
        } else if (bBottom > firstSegmentBottom) {
          offset += Math.max(0, spacerBottom - bTop);
        }
      } else if (tEffective != null && tEffective > tDesign && bTop >= tTop + tDesign) {
        offset += tEffective - tDesign;
      }
    });
    boxYOffset[b.id] = offset;
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
      const rowCount = getDataTableRowCount(data || {}, box.tableConfig.columnKeys);
      const useAttachedListMode = rowCount > DATA_TABLE_ATTACHED_LIST_THRESHOLD;
      totalHeight = Math.max(totalHeight, tableTop + firstSegmentHeight);
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
  const numPages = Math.max(1, Math.ceil(totalHeight / editorPageHeightPx));
  return { effectiveHeightByBoxId, boxYOffset, totalHeight, numPages, editorPageHeightPx };
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
  const settings = template.settings || {};
  const pages = template.pages || [];
  const orientation = settings.orientation || 'portrait';
  const pageSize = settings.pageSize || 'A4';
  const margins = settings.margins || { top: 5, bottom: 5, left: 5, right: 5 };

  if (!pages || pages.length === 0) throw new Error('Template has no pages');

  const filename = `pdf_${Date.now()}_${template.id}.pdf`;
  const filepath = path.join(uploadsDir, filename);

  const doc = new PDFDocument({
    size: pageSize,
    layout: orientation,
    margins: { top: margins.top, bottom: margins.bottom, left: margins.left, right: margins.right },
  });

  const stream = fs.createWriteStream(filepath);
  doc.pipe(stream);

  const TITLE_TOP_GAP_PT = 19;
  const TITLE_BOTTOM_GAP_PT = 19;
  const documentTitle = settings.title || template.name || '';

  const allBoxes = pages.reduce((acc, p) => acc.concat(p.boxes || []), []);
  const sortedBoxes = allBoxes.sort((a, b) => (a.rank || 0) - (b.rank || 0));
  const editorPageHeightPx = getEditorPageHeight(settings);
  const layout = buildMultiPageLayout(sortedBoxes, data, editorPageHeightPx);
  const { effectiveHeightByBoxId, boxYOffset, numPages } = layout;

  const editorCanvasWidth = orientation === 'portrait' ? 794 : 1123;

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

    sortedBoxes.forEach((box) => {
      try {
        const globalY = (box.position?.y ?? 0) + (boxYOffset[box.id] || 0);
        const boxH = effectiveHeightByBoxId[box.id] ?? box.size?.height ?? 20;
        const globalBottom = globalY + boxH;

        const isDataTable = box.type === 'table' && box.tableConfig?.dynamicRowsFromData && Array.isArray(box.tableConfig?.columnKeys);
        if (isDataTable) {
          const columnKeys = box.tableConfig.columnKeys;
          const rowCount = getDataTableRowCount(data || {}, columnKeys);
          const range = getDataTableRowRangeForPage(box, pageIndex, rowCount, editorPageHeightPx - EDITOR_TITLE_AREA_PX);
          const showAttachedListMessage = pageIndex === 0 && rowCount > DATA_TABLE_ATTACHED_LIST_THRESHOLD;
          if (range.endRow <= range.startRow && !showAttachedListMessage) return;
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
        if (boxH !== (box.size?.height ?? 20)) height = Math.max(10, Math.min(boxH, clipBottomEditor) * pxToPt);
        if (x + width > pageWidth - margins.right) width = Math.max(10, pageWidth - margins.right - x);
        if (x < margins.left) { const overflow = margins.left - x; x = margins.left; width = Math.max(10, width - overflow); }
        if (y + height > pageHeight - margins.bottom) height = Math.max(10, pageHeight - margins.bottom - y);
        if (y < contentStartY) { const overflow = contentStartY - y; y = contentStartY; height = Math.max(10, height - overflow); }
        width = Math.min(width, availableWidth);
        height = Math.min(height, availableHeight - (y - contentStartY));

        if (box.type === 'table' && box.tableConfig?.dynamicRowsFromData && Array.isArray(box.tableConfig?.columnKeys)) {
          const columnKeys = box.tableConfig.columnKeys;
          const headers = box.tableConfig.headers || columnKeys.map(k => k.replace(/_/g, ' '));
          const rowCount = getDataTableRowCount(data || {}, columnKeys);
          const colCount = columnKeys.length;
          const fontSize = Math.max(8, Math.min(72, Number(box.properties?.fontSize) || 11));
          const rowHeightPt = fontSize + 6;
          const headerHeightPt = rowHeightPt;
          const rowHeightPx = DATA_TABLE_ROW_HEIGHT_PX;
          const headerHeightPx = DATA_TABLE_HEADER_ROW_PX;
          const colWidths = (box.tableConfig.columnWidths && Array.isArray(box.tableConfig.columnWidths))
            ? box.tableConfig.columnWidths.map(p => (p / 100) * width)
            : Array(colCount).fill(width / colCount);

          const tablePageIndex = pageIndex;
          const range = getDataTableRowRangeForPage(box, tablePageIndex, rowCount, editorPageHeightPx - EDITOR_TITLE_AREA_PX);
          const startRow = range.startRow;
          let drawnOnThisPage = range.endRow - range.startRow;
          const showAttachedListMessage = pageIndex === 0 && rowCount > DATA_TABLE_ATTACHED_LIST_THRESHOLD && drawnOnThisPage === 0;

          const tableStartY = pageIndex === 0 ? y : contentStartY;

          doc.fontSize(fontSize).font('Helvetica');
          let tableY = tableStartY;
          doc.save();
          doc.lineWidth(0.5).strokeColor(0, 0, 0);
          let colX = x;
          for (let ci = 0; ci < colCount; ci++) {
            const cw = colWidths[ci] || width / colCount;
            doc.rect(colX, tableY, cw, headerHeightPt).stroke();
            doc.fillColor(0, 0, 0).text(String(headers[ci] || ''), colX + 3, tableY + 3, { width: cw - 6, align: 'left' });
            colX += cw;
          }
          tableY += headerHeightPt;
          if (showAttachedListMessage) {
            doc.rect(x, tableY, width, rowHeightPt).stroke();
            doc.fillColor(0.27, 0.27, 0.27).text('Find the details of elements in attached list.', x + 3, tableY + rowHeightPt - 14, { width: width - 6, align: 'center' });
            tableY += rowHeightPt;
          } else {
            const minRowPt = rowHeightPt;
            const maxRowPt = rowHeightPt * 4;
            for (let ri = startRow; ri < startRow + drawnOnThisPage; ri++) {
              let rowH = minRowPt;
              const cellTexts = [];
              colX = x;
              for (let ci = 0; ci < colCount; ci++) {
                const cw = colWidths[ci] || width / colCount;
                const cellText = getDataTableCell(data || {}, columnKeys, ri + 1, ci);
                cellTexts.push(cellText);
                const cellH = doc.heightOfString(cellText || '', { width: Math.max(1, cw - 6) });
                rowH = Math.max(rowH, Math.min(maxRowPt, cellH + 6));
              }
              colX = x;
              for (let ci = 0; ci < colCount; ci++) {
                const cw = colWidths[ci] || width / colCount;
                doc.rect(colX, tableY, cw, rowH).stroke();
                doc.fillColor(0, 0, 0).text(cellTexts[ci], colX + 3, tableY + 3, { width: Math.max(1, cw - 6), align: 'left' });
                colX += cw;
              }
              tableY += rowH;
            }
          }
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

        let content = '';
        if (box.labelName) {
          const value = box.content || `{{${box.fieldName || 'field'}}}`;
          content = `${box.labelName}: ${replacePlaceholders(value, data || {})}`;
        } else if (box.content) {
          content = replacePlaceholders(box.content || '', data || {});
        } else if (box.fieldName) {
          content = replacePlaceholders(`{{${box.fieldName}}}`, data || {});
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

        const isTotalThisPageBox = (box.fieldName && String(box.fieldName).toLowerCase() === 'total_this_page') ||
          (content && String(content).includes('Total This Page'));
        const isTotalsSectionBox = isTotalThisPageBox ||
          (box.fieldName && String(box.fieldName).toLowerCase() === 'consignment_total') ||
          (content && String(content).includes('Consignment Total'));
        if (isTotalThisPageBox) {
          doc.save();
          doc.lineWidth(0.5).strokeColor(0, 0, 0);
          doc.moveTo(x, y).lineTo(x + width, y).stroke();
          doc.restore();
        }
        if (box.properties?.border !== false) {
          doc.save();
          doc.lineWidth(0.5);
          doc.strokeColor(0, 0, 0);
          if (isTotalsSectionBox) {
            doc.moveTo(x + width, y).lineTo(x + width, y + height).stroke();
            doc.moveTo(x + width, y + height).lineTo(x, y + height).stroke();
            doc.moveTo(x, y + height).lineTo(x, y).stroke();
          } else {
            doc.rect(x, y, width, height).stroke();
          }
          doc.restore();
        }

        if (content && content.trim()) {
          doc.save();
          const textWidthSafe = Math.max(1, textWidth);
          const lineGapPt = 4;
          const keyValueGapPt = 1;
          const alignment = box.properties?.alignment || 'left';
          let keyStr = '';
          let valueStr = '';
          const explicitLabel = box.labelName && String(box.labelName).trim();
          if (explicitLabel) {
            keyStr = `${box.labelName}:`;
            valueStr = replacePlaceholders(box.content || `{{${box.fieldName || 'field'}}}`, data || {});
          } else if (content.indexOf(':') !== -1) {
            const firstColon = content.indexOf(':');
            keyStr = content.slice(0, firstColon + 1).trim();
            valueStr = content.slice(firstColon + 1).trim();
          }
          const hasKeyValue = keyStr.length > 0;
          let useTwoLineLayout = false;
          if (hasKeyValue) {
            const combined = `${keyStr} ${(valueStr || '').trim()}`.trim() || keyStr;
            try {
              doc.font(safeFontFamily).fontSize(fontSize);
              const needH = doc.heightOfString(combined, { width: textWidthSafe });
              useTwoLineLayout = needH + lineGapPt > textHeight;
            } catch (_) {
              useTwoLineLayout = true;
            }
          }

          if (hasKeyValue && useTwoLineLayout) {
            doc.font(safeFontFamily).fontSize(fontSize).fillColor(r, g, b);
            let keyHeight = 0;
            try {
              keyHeight = doc.heightOfString(keyStr, { width: textWidthSafe });
            } catch (_) {
              keyHeight = fontSize * 1.2;
            }
            doc.text(keyStr, textX, textY, {
              width: textWidthSafe,
              align: alignment,
              lineGap: lineGapPt,
              ellipsis: false
            });
            const valueStartY = textY + keyHeight + keyValueGapPt;
            const remainingHeight = textHeight - keyHeight - keyValueGapPt;
            if (remainingHeight > 0) {
              const valueToShow = (valueStr || '').trim() || replacePlaceholders(box.content || `{{${box.fieldName || 'field'}}}`, data || {});
              doc.font(safeFontFamily).fontSize(fontSize).fillColor(r, g, b);
              doc.text(String(valueToShow).trim() || '\u00A0', textX, valueStartY, {
                width: textWidthSafe,
                height: remainingHeight,
                align: alignment,
                lineGap: lineGapPt,
                ellipsis: false
              });
            }
          } else {
            doc.font(safeFontFamily).fontSize(fontSize).fillColor(r, g, b);
            doc.text(content, textX, textY, {
              width: textWidthSafe,
              height: textHeight,
              align: alignment,
              lineGap: lineGapPt,
              ellipsis: false
            });
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
        const spacerTopEditor = (firstDataTable.position?.y ?? 0) + (boxYOffset[firstDataTable.id] || 0) + (effectiveHeightByBoxId[firstDataTable.id] ?? firstDataTable.size?.height ?? 20);
        const spacerHeightPx = Math.min(DATA_TABLE_SPACER_PX, editorPageHeightPx - spacerTopEditor);
        if (spacerHeightPx > 0) {
          const spacerY = (Math.max(0, spacerTopEditor - EDITOR_TITLE_AREA_PX) * pxToPt) + contentStartY;
          const spacerHeightPt = spacerHeightPx * pxToPt;
          const spacerX = ((firstDataTable.position?.x ?? 0) * pxToPt) + margins.left;
          const spacerWidthPt = Math.min(availableWidth, Math.max(10, (firstDataTable.size?.width ?? availableWidth / pxToPt) * pxToPt));
          doc.lineWidth(0.5).strokeColor(0, 0, 0);
          doc.rect(spacerX, spacerY, spacerWidthPt, spacerHeightPt).stroke();
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
};

module.exports = { generatePdf, replacePlaceholders, parseColor };
