/**
 * Convert a flat PDF into template boxes using Python + PyMuPDF.
 * Uses actual drawn lines/rects from the PDF to build a grid so boxes align with the template.
 * Output coordinates from Python are PDF points, origin top-left (y downward).
 * Editor canvas: 794×1123, origin top-left.
 */
const path = require('path');
const { spawnSync } = require('child_process');
const fs = require('fs');
const { normalizeFontSizes } = require('./pdfFlatToTemplate');

const EDITOR_CANVAS_WIDTH = 794;
const EDITOR_CANVAS_HEIGHT = 1123;
const MIN_BOX_WIDTH = 60;
const MIN_BOX_HEIGHT = 16;
const MIN_FONT_SIZE_PT = 6;
const MAX_FONT_SIZE_PT = 72;
/** Default font size for empty cells (no label) - avoid inferring from large cell height */
const DEFAULT_FONT_SIZE_EMPTY_CELL_PT = 11;

/**
 * Convert a label (e.g. "Bill of Lading Number") to a template variable name: lowercase, spaces → underscores.
 * Returns '' for empty, "none", or non-meaningful labels so caller can use field_${rank} instead.
 * @param {string} label
 * @returns {string} e.g. "bill_of_lading_number" or ''
 */
function labelToFieldName(label) {
  if (!label || typeof label !== 'string') return '';
  const s = label
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  if (!s || s === 'none') return '';
  return s;
}

/** Path to the Python script (from this file: utils -> pdf-service -> services -> backend, then scripts) */
const SCRIPT_PATH = path.resolve(__dirname, '../../../scripts/detect_template_cells.py');

/**
 * Run the Python cell-detection script and parse JSON from stdout.
 * @param {string} filePath - absolute or relative path to the PDF
 * @returns {{ pageWidth: number, pageHeight: number, cells: Array<{x,y,width,height,label}> } | null}
 */
function runPythonCellDetection(filePath) {
  if (!path.isAbsolute(filePath)) {
    filePath = path.resolve(process.cwd(), filePath);
  }
  if (!fs.existsSync(filePath)) {
    console.warn('[PDF import] Python cell detection skipped: PDF file not found:', filePath);
    return null;
  }
  if (!fs.existsSync(SCRIPT_PATH)) {
    console.warn('[PDF import] Python cell detection skipped: script not found:', SCRIPT_PATH);
    return null;
  }
  // Use PYTHON_PATH or PYTHON_CMD from .env if set (e.g. path to Python that has pip/pymupdf)
  const envPython = process.env.PYTHON_PATH || process.env.PYTHON_CMD;
  const pythonCmds = envPython && fs.existsSync(envPython)
    ? [envPython]
    : process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python'];
  let result = { status: -1, stdout: '', stderr: '', error: null };
  for (const pythonCmd of pythonCmds) {
    result = spawnSync(pythonCmd, [SCRIPT_PATH, filePath], {
      encoding: 'utf8',
      timeout: 30000,
      windowsHide: true,
    });
    if (result.status === 0 && !result.error) break;
  }
  if (result.error) {
    console.warn('[PDF import] Python cell detection failed: cannot run Python:', result.error.message);
    return null;
  }
  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim().slice(0, 300);
    console.warn('[PDF import] Python cell detection failed: exit code', result.status, stderr ? `| stderr: ${stderr}` : '');
    if (result.status === 2 && /pymupdf|PyMuPDF|fitz/i.test(stderr)) {
      console.warn('[PDF import] Install PyMuPDF for the same Python used by Node: python -m pip install pymupdf');
    }
    return null;
  }
  const out = (result.stdout || '').trim();
  if (!out) {
    console.warn('[PDF import] Python cell detection: script produced no output.');
    return null;
  }
  try {
    // PyMuPDF or other libs may print to stdout; extract only the JSON object (from first { to matching })
    let jsonStr = out;
    const firstBrace = out.indexOf('{');
    if (firstBrace >= 0) {
      let depth = 0;
      let end = firstBrace;
      for (let i = firstBrace; i < out.length; i++) {
        if (out[i] === '{') depth++;
        else if (out[i] === '}') {
          depth--;
          if (depth === 0) {
            end = i + 1;
            break;
          }
        }
      }
      jsonStr = out.slice(firstBrace, end);
    }
    const data = JSON.parse(jsonStr);
    if (!Array.isArray(data.cells) || data.cells.length === 0) {
      console.warn('[PDF import] Python cell detection: script returned 0 cells (no tables/drawings detected for this PDF).');
    }
    return data;
  } catch (e) {
    console.warn('[PDF import] Python cell detection: invalid JSON from script:', (e.message || e).slice(0, 100));
    return null;
  }
}

/**
 * @param {string} filePath - path to uploaded PDF
 * @returns {Promise<{ boxes: Array<object>, templateName?: string, pageSize?: string, orientation?: string } | null>}
 * Returns null if Python/PyMuPDF unavailable or script failed.
 */
async function pdfTemplateFromPython(filePath) {
  const data = runPythonCellDetection(filePath);
  if (!data || !Array.isArray(data.cells) || data.cells.length === 0) {
    return null;
  }

  const pageWidth = Number(data.pageWidth) || 595;
  const pageHeight = Number(data.pageHeight) || 842;
  const scaleX = EDITOR_CANVAS_WIDTH / pageWidth;
  const scaleY = EDITOR_CANVAS_HEIGHT / pageHeight;

  const boxes = [];
  let rank = 1;
  const ts = Date.now();
  const usedFieldNames = new Set();

  for (const cell of data.cells) {
    const x = Number(cell.x) || 0;
    const y = Number(cell.y) || 0;
    const w = Number(cell.width) || 0;
    const h = Number(cell.height) || 0;
    if (w < 3 || h < 3) continue;

    const editorX = Math.round(x * scaleX);
    const editorY = Math.round(y * scaleY);
    const editorW = Math.max(MIN_BOX_WIDTH, Math.round(w * scaleX));
    const editorH = Math.max(MIN_BOX_HEIGHT, Math.round(h * scaleY));

    const labelName = (cell.label || '').trim();
    const shortLabel = labelName.length > 40 ? labelName.slice(0, 37) + '...' : labelName;

    let fieldName = labelToFieldName(labelName);
    if (!fieldName) fieldName = `field_${rank}`;
    if (usedFieldNames.has(fieldName)) {
      let n = 2;
      while (usedFieldNames.has(`${fieldName}_${n}`)) n++;
      fieldName = `${fieldName}_${n}`;
    }
    usedFieldNames.add(fieldName);

    const displayLabel = shortLabel || (fieldName.startsWith('field_') ? `Field ${rank}` : fieldName.replace(/_/g, ' '));
    const hasMeaningfulLabel = (cell.label || '').trim().length > 0;
    const extractedFontSizePt = (typeof cell.fontSize === 'number' && cell.fontSize > 0)
      ? Math.round(Math.max(MIN_FONT_SIZE_PT, Math.min(MAX_FONT_SIZE_PT, cell.fontSize)))
      : (!hasMeaningfulLabel ? DEFAULT_FONT_SIZE_EMPTY_CELL_PT : (h > 0 ? Math.round(Math.max(MIN_FONT_SIZE_PT, Math.min(MAX_FONT_SIZE_PT, h * 0.95))) : 12));

    boxes.push({
      id: `box_${ts}_${rank}`,
      type: 'text',
      rank,
      position: { x: Math.max(0, editorX), y: Math.max(0, editorY) },
      size: { width: editorW, height: editorH },
      labelName: displayLabel,
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

  if (boxes.length === 0) return null;

  normalizeFontSizes(boxes);
  boxes.sort((a, b) =>
    a.position.y !== b.position.y ? a.position.y - b.position.y : a.position.x - b.position.x
  );

  return {
    boxes,
    templateName: 'Imported from PDF',
    pageSize: 'A4',
    orientation: pageWidth > pageHeight ? 'landscape' : 'portrait',
  };
}

module.exports = { pdfTemplateFromPython, runPythonCellDetection };
