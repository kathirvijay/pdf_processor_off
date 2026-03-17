/**
 * Extract text from page 2 of a PDF using pdf.js-extract
 */
const path = require('path');
const { PDFExtract } = require('pdf.js-extract');

const pdfPath = process.argv[2] || 'c:\\Users\\rpkat\\Downloads\\New folder (1)\\New folder\\SWB_Far East Container Line Limited_CSHB06-V1.pdf';

async function extractPage2() {
  const extractor = new PDFExtract();
  try {
    const data = await extractor.extract(pdfPath, { firstPage: 2, lastPage: 2 });
    if (!data.pages || data.pages.length === 0) {
      console.error('No pages found.');
      process.exit(1);
    }
    const page = data.pages[0];
    const items = page.content || [];
    const text = items
      .sort((a, b) => {
        const yDiff = b.y - a.y;
        if (Math.abs(yDiff) > 3) return yDiff;
        return a.x - b.x;
      })
      .map(item => item.str)
      .join('');
    console.log(text);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

extractPage2();
