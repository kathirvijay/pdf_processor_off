/**
 * Render the first page of a PDF to a PNG image (base64).
 * Used so the template editor can show the PDF as background and preserve layout.
 * @param {string} filePath - path to PDF
 * @param {number} scale - scale factor for resolution (default 2)
 * @returns {Promise<string|null>} base64 data URL or null on failure
 */
async function pdfPageToImageBase64(filePath, scale = 2) {
  try {
    const { pdf } = await import('pdf-to-img');
    const document = await pdf(filePath, { scale });
    const pageBuffer = await document.getPage(1);
    if (!pageBuffer || !Buffer.isBuffer(pageBuffer)) return null;
    const base64 = pageBuffer.toString('base64');
    return `data:image/png;base64,${base64}`;
  } catch (err) {
    console.warn('PDF page to image failed:', err.message);
    return null;
  }
}

module.exports = { pdfPageToImageBase64 };
