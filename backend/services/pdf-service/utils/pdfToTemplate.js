/**
 * Convert an uploaded PDF into our template box structure.
 * 1) If PDF has AcroForm fields, use those.
 * 2) Otherwise scan the PDF (flat) and extract text + positions to create boxes.
 * PDF coordinates: origin bottom-left. Editor: origin top-left, canvas 794×1123 (A4 portrait).
 */
const { PDFDocument } = require('pdf-lib');
const { pdfFlatToTemplate } = require('./pdfFlatToTemplate');
const { pdfTemplateFromPython } = require('./pdfTemplateFromPython');
const fs = require('fs');

const EDITOR_CANVAS_WIDTH = 794;
const EDITOR_CANVAS_HEIGHT = 1123;

/**
 * @param {string} filePath - path to uploaded PDF
 * @returns {Promise<{ boxes: Array<object>, templateName?: string, pageSize?: string, orientation?: string, message?: string }>}
 */
async function pdfToTemplate(filePath) {
  const bytes = fs.readFileSync(filePath);
  let pdfDoc;
  try {
    pdfDoc = await PDFDocument.load(bytes);
  } catch (e) {
    throw new Error('Invalid or corrupted PDF file.');
  }

  let form;
  try {
    form = pdfDoc.getForm();
  } catch (e) {
    return pdfFlatToTemplate(filePath);
  }

  const fields = form.getFields();
  if (!fields || fields.length === 0) {
    const fromPython = await pdfTemplateFromPython(filePath);
    if (fromPython && fromPython.boxes && fromPython.boxes.length > 0) {
      console.log(`Template import: using Python/PyMuPDF (${fromPython.boxes.length} boxes).`);
      return fromPython;
    }
    console.log('Template import: Python cell detection unavailable or returned no cells; using text-only fallback.');
    return pdfFlatToTemplate(filePath);
  }

  const pages = pdfDoc.getPages();
  const page = pages[0];
  const pdfPageWidth = page.getWidth();
  const pdfPageHeight = page.getHeight();

  const scaleX = EDITOR_CANVAS_WIDTH / pdfPageWidth;
  const scaleY = EDITOR_CANVAS_HEIGHT / pdfPageHeight;

  const boxes = [];
  let rank = 1;

  for (const field of fields) {
    try {
      const name = field.getName();
      if (!name) continue;

      const widgets = field.acroField.getWidgets();
      if (!widgets || widgets.length === 0) continue;

      const widget = widgets[0];
      const rect = widget.getRectangle();
      if (!rect) continue;

      let pdfX, pdfY, pdfWidth, pdfHeight;
      if (typeof rect.x === 'number' && typeof rect.width === 'number') {
        pdfX = rect.x;
        pdfY = rect.y;
        pdfWidth = rect.width;
        pdfHeight = rect.height;
      } else if (Array.isArray(rect) && rect.length >= 4) {
        pdfX = rect[0];
        pdfY = rect[1];
        pdfWidth = rect[2] - rect[0];
        pdfHeight = rect[3] - rect[1];
      } else {
        continue;
      }

      const editorX = Math.round(pdfX * scaleX);
      const editorY = Math.round((pdfPageHeight - pdfY - pdfHeight) * scaleY);
      const editorWidth = Math.max(20, Math.round(pdfWidth * scaleX));
      const editorHeight = Math.max(12, Math.round(pdfHeight * scaleY));
      const MIN_FONT_PT = 6;
      const MAX_FONT_PT = 14;
      const inferredFontSizePt = pdfHeight > 0
        ? Math.round(Math.max(MIN_FONT_PT, Math.min(MAX_FONT_PT, pdfHeight * 0.9)))
        : 10;

      const labelName = name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

      boxes.push({
        id: `box_${Date.now()}_${rank}`,
        type: 'text',
        rank,
        position: { x: editorX, y: editorY },
        size: { width: editorWidth, height: editorHeight },
        labelName,
        content: '',
        fieldName: name,
        properties: {
          fontSize: inferredFontSizePt,
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
    } catch (e) {
      console.warn('Skip field:', e.message);
    }
  }

  boxes.sort((a, b) => a.rank - b.rank);

  const templateName = pdfDoc.getTitle() || 'Imported from PDF';

  return {
    boxes,
    templateName: templateName.trim() || 'Imported from PDF',
    pageSize: 'A4',
    orientation: pdfPageWidth > pdfPageHeight ? 'landscape' : 'portrait',
  };
}

module.exports = { pdfToTemplate };
