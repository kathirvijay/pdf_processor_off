const PDFExtract = require('pdf.js-extract').PDFExtract;
const fs = require('fs');
const path = require('path');

const PDF_PATH = 'c:\\Users\\rpkat\\Downloads\\New folder (1)\\New folder\\SWB_Far East Container Line Limited_CSHB06-V1.pdf';
const PAGE_NUM = 2;
const OUTPUT_JSON = path.join(__dirname, 'page2-extract.json');
const OUTPUT_TXT = path.join(__dirname, 'page2-extract.txt');

async function main() {
  const pdfExtract = new PDFExtract();
  const data = await pdfExtract.extract(PDF_PATH, {
    firstPage: PAGE_NUM,
    lastPage: PAGE_NUM,
    disableCombineTextItems: true
  });

  if (!data.pages || data.pages.length === 0) {
    console.error('No pages extracted');
    process.exit(1);
  }

  const page = data.pages[0];
  const pageInfo = page.pageInfo;
  const items = page.content || [];
  const pageWidth = pageInfo.width || 595;
  const pageHeight = pageInfo.height || 842;

  const rawItems = items.map((item, idx) => ({
    index: idx,
    x: item.x,
    y: item.y,
    str: item.str,
    width: item.width,
    height: item.height,
    fontName: item.fontName,
    dir: item.dir,
    xEnd: item.x + (item.width || 0)
  }));

  const Y_TOL = 3;
  const sortedByFlow = [...rawItems].sort((a, b) => {
    if (Math.abs(a.y - b.y) <= Y_TOL) return a.x - b.x;
    return b.y - a.y;
  });

  const snapEdges = (arr, snapPt) => {
    const s = [...new Set(arr)].sort((a,b) => a - b);
    const out = [s[0]];
    for (let i = 1; i < s.length; i++) {
      if (s[i] - out[out.length - 1] > snapPt) out.push(s[i]);
    }
    return out;
  };

  const leftEdges = items.map(i => i.x);
  const rightEdges = items.map(i => i.x + (i.width || 0));
  const allX = [...leftEdges, ...rightEdges].filter(x => !isNaN(x));
  const allXEdges = snapEdges(allX, 12);

  const colRanges = [];
  for (let i = 0; i < allXEdges.length - 1; i++) {
    const xMin = allXEdges[i];
    const xMax = allXEdges[i + 1];
    const itemCount = items.filter(it => {
      const rx = it.x + (it.width || 0);
      return (it.x >= xMin - 3 && it.x <= xMax + 3) || (rx >= xMin - 3 && rx <= xMax + 3) || (it.x <= xMin && rx >= xMax);
    }).length;
    if (itemCount > 0 && (xMax - xMin) > 10) colRanges.push({ xMin, xMax, itemCount });
  }

  const assignCol = (item, ranges) => {
    const cx = item.x + (item.width || 0) / 2;
    for (let c = 0; c < ranges.length; c++) {
      if (cx >= ranges[c].xMin - 2 && cx <= ranges[c].xMax + 2) return c;
    }
    return 0;
  };

  const byColumn = colRanges.map(() => []);
  sortedByFlow.forEach(item => {
    const col = assignCol(item, colRanges);
    if (col < byColumn.length) byColumn[col].push(item);
  });

  // Logical 2-column: gap at ~279-306 separates left/right
  const twoColRanges = [
    { xMin: 0, xMax: 292 },
    { xMin: 292, xMax: pageWidth }
  ];
  const byTwoCol = [[], []];
  sortedByFlow.forEach(item => {
    const cx = item.x + (item.width || 0) / 2;
    byTwoCol[cx < 292 ? 0 : 1].push(item);
  });

  const output = {
    source: PDF_PATH,
    page: PAGE_NUM,
    pageInfo: { width: pageWidth, height: pageHeight },
    analysis: {
      tableColumnCount: colRanges.length,
      tableColumnBoundaries: colRanges.map(r => ({ xMin: r.xMin, xMax: r.xMax })),
      tableXRanges: colRanges.map(r => [r.xMin.toFixed(1), r.xMax.toFixed(1)]),
      logical2Column: 'Left X[0-292], Right X[292-595] - gap at ~279-306pt',
      logical2ColumnRanges: twoColRanges,
      allXEdges
    },
    rawItems,
    sortedByFlow,
    byTableColumn: colRanges.map((r, i) => ({
      columnIndex: i,
      xRange: [r.xMin.toFixed(1), r.xMax.toFixed(1)],
      itemCount: byColumn[i].length,
      items: byColumn[i],
      textFlow: byColumn[i].map(it => it.str).join(' ')
    })),
    byLogical2Column: [
      { column: 'left', xRange: [0, 292], itemCount: byTwoCol[0].length, items: byTwoCol[0], textFlow: byTwoCol[0].map(it => it.str).join(' ') },
      { column: 'right', xRange: [292, 595], itemCount: byTwoCol[1].length, items: byTwoCol[1], textFlow: byTwoCol[1].map(it => it.str).join(' ') }
    ],
    summary: {
      totalItems: rawItems.length,
      tableColumnCount: colRanges.length,
      logicalColumnCount: 2,
      tableXRanges: colRanges.map(r => [r.xMin.toFixed(1), r.xMax.toFixed(1)]),
      logicalXRanges: [[0, 292], [292, 595]]
    }
  };

  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(output, null, 2), 'utf8');

  let txt = '';
  txt += '=== Page 2 Text Extraction (X,Y positions) ===\n';
  txt += 'Source: ' + PDF_PATH + '\n';
  txt += 'Page size: ' + pageWidth + ' x ' + pageHeight + ' pt\n';
  txt += 'Total text items: ' + rawItems.length + '\n\n';
  txt += '--- (1) Column Count ---\n';
  txt += 'Table columns (fine): ' + colRanges.length + '\n';
  txt += 'Logical columns: 2 (left X[0-292], right X[292-595], gap ~279-306pt)\n\n';
  txt += '--- (2) Column Boundaries ---\n';
  txt += 'Logical 2-col: Left [0, 292] | Right [292, 595]\n';
  txt += 'Table X ranges: ' + JSON.stringify(output.summary.tableXRanges.slice(0,10)) + ' ...\n\n';
  txt += '--- (3) Text Flow Order (top-to-bottom, left-to-right) ---\n';
  txt += 'index\tx\ty\tstr\n';
  sortedByFlow.forEach((it, i) => txt += i + '\t' + it.x.toFixed(1) + '\t' + it.y.toFixed(1) + '\t' + JSON.stringify(it.str) + '\n');
  txt += '\n--- All items (raw) ---\n';
  txt += 'index\tx\ty\txEnd\tstr\n';
  rawItems.forEach(it => txt += it.index + '\t' + it.x.toFixed(1) + '\t' + it.y.toFixed(1) + '\t' + (it.xEnd||it.x).toFixed(1) + '\t' + JSON.stringify(it.str) + '\n');
  txt += '\n--- By logical column ---\n';
  output.byLogical2Column.forEach((col, i) => {
    txt += 'Column ' + i + ' (' + col.column + ') X=' + col.xRange + ' items=' + col.itemCount + '\n';
    txt += '  ' + col.textFlow.substring(0, 250) + (col.textFlow.length > 250 ? '...' : '') + '\n\n';
  });

  fs.writeFileSync(OUTPUT_TXT, txt, 'utf8');

  console.log('Saved:', OUTPUT_JSON, '|', OUTPUT_TXT);
  console.log('\n(1) Columns: Table=' + colRanges.length + ', Logical=2');
  console.log('(2) Logical X: Left [0,292] | Right [292,595]');
  console.log('(3) Text flow: top-to-bottom, left-to-right');
}

main().catch(err => { console.error(err); process.exit(1); });
