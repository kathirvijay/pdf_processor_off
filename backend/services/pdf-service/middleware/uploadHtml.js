const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadsDir = path.join(__dirname, '../../../uploads/html-import');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `html-import-${uniqueSuffix}-${(file.originalname || 'file').replace(/[^a-zA-Z0-9.-]/g, '_')}`);
  },
});

function isHtmlFile(file) {
  const name = (file.originalname || '').toLowerCase();
  return (
    file.mimetype === 'text/html'
    || file.mimetype === 'application/xhtml+xml'
    || name.endsWith('.html')
    || name.endsWith('.htm')
  );
}

const uploadHtml = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (isHtmlFile(file)) cb(null, true);
    else cb(new Error('Only HTML files (.html, .htm) are allowed'));
  },
  limits: { fileSize: 8 * 1024 * 1024 },
});

module.exports = uploadHtml;
