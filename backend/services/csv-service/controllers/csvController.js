const Papa = require('papaparse');
const fs = require('fs');

/**
 * CSV import for template structure only (no auth, no CsvImport DB in pdf_processor_o).
 * CSV format: field/parameter name + box coordinates.
 * Coordinates: "Left", "Top", "Right", "Bottom" OR "Position X", "Position Y", "Width", "Height".
 * Name column: "Field Name" | "Parameter Name" | "Container Name" | "Title" | "Name".
 */
const csvController = {
  importStructure: async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'CSV file is required' });
      }

      const filePath = req.file.path;
      const fileContent = fs.readFileSync(filePath, 'utf-8');

      const parseResult = Papa.parse(fileContent, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h) => (h || '').trim(),
      });

      if (parseResult.errors.length > 0) {
        return res.status(400).json({
          message: 'CSV parsing errors',
          errors: parseResult.errors,
        });
      }

      const rows = parseResult.data;
      if (!rows.length) {
        return res.status(400).json({ message: 'CSV file has no data rows' });
      }

      const rawHeaders = Object.keys(rows[0]);
      const headerMap = {};
      rawHeaders.forEach((h) => {
        const key = (h || '').trim();
        const lower = key.toLowerCase();
        if (!headerMap[lower]) headerMap[lower] = key;
      });

      const getCol = (row, ...names) => {
        for (const n of names) {
          const key = Object.keys(headerMap).find((k) => k === n.toLowerCase());
          if (key && row[headerMap[key]] !== undefined && row[headerMap[key]] !== '') {
            return String(row[headerMap[key]]).trim();
          }
        }
        return '';
      };
      const getNum = (row, ...names) => {
        const v = getCol(row, ...names);
        const n = parseInt(v, 10);
        return Number.isNaN(n) ? undefined : n;
      };

      const nameCol = ['Field Name', 'Parameter Name', 'Container Name', 'Title', 'Name'].find(
        (c) => headerMap[c.toLowerCase()]
      );
      if (!nameCol) {
        return res.status(400).json({
          message:
            'CSV must have a name column: one of "Field Name", "Parameter Name", "Container Name", "Title", "Name"',
        });
      }

      const hasFourSides =
        headerMap['left'] !== undefined &&
        headerMap['top'] !== undefined &&
        headerMap['right'] !== undefined &&
        headerMap['bottom'] !== undefined;
      const hasXYWH =
        (headerMap['position x'] !== undefined || headerMap['x'] !== undefined) &&
        (headerMap['position y'] !== undefined || headerMap['y'] !== undefined) &&
        headerMap['width'] !== undefined &&
        headerMap['height'] !== undefined;

      if (!hasFourSides && !hasXYWH) {
        return res.status(400).json({
          message:
            'CSV must define box coordinates: either "Left", "Top", "Right", "Bottom" or "Position X", "Position Y", "Width", "Height"',
        });
      }

      const boxes = rows.map((row, index) => {
        let x, y, width, height;

        if (hasFourSides) {
          const left = getNum(row, 'Left');
          const top = getNum(row, 'Top');
          const right = getNum(row, 'Right');
          const bottom = getNum(row, 'Bottom');
          if (left === undefined || top === undefined || right === undefined || bottom === undefined) {
            x = 50;
            y = 50 + index * 60;
            width = 500;
            height = 20;
          } else {
            x = left;
            y = top;
            width = Math.max(0, right - left);
            height = Math.max(0, bottom - top);
          }
        } else {
          x = getNum(row, 'Position X', 'X') ?? 50;
          y = getNum(row, 'Position Y', 'Y') ?? 50 + index * 60;
          width = getNum(row, 'Width') ?? 500;
          height = getNum(row, 'Height') ?? 20;
        }

        const fieldName = getCol(row, nameCol) || `field_${index + 1}`;
        const rank = getNum(row, 'Rank') ?? index + 1;

        return {
          id: `box_${Date.now()}_${index}`,
          type: getCol(row, 'Type') || 'text',
          rank,
          position: { x, y },
          size: { width: Math.max(20, width), height: Math.max(12, height) },
          labelName: getCol(row, 'Label Name') || '',
          content: getCol(row, 'Content') || '',
          fieldName,
          properties: {
            fontSize: getNum(row, 'Font Size') ?? 12,
            fontFamily: getCol(row, 'Font Family') || 'Arial',
            fontWeight: (getCol(row, 'Font Weight') || 'normal').toLowerCase(),
            fontColor: getCol(row, 'Font Color') || '#000000',
            backgroundColor: getCol(row, 'Background Color') || 'transparent',
            alignment: (getCol(row, 'Alignment') || 'left').toLowerCase(),
            contentPosition: { x: 0, y: 0 },
            border: true,
          },
        };
      });

      boxes.sort((a, b) => a.rank - b.rank);

      const templateNameCol = headerMap['template name'];
      const templateName =
        templateNameCol && rows[0][templateNameCol] ? String(rows[0][templateNameCol]).trim() : null;

      res.json({
        message: 'CSV structure imported successfully',
        boxes,
        page: { pageNumber: 1, boxes },
        templateName: templateName || undefined,
      });
    } catch (error) {
      console.error('Import structure error:', error);
      res.status(500).json({ message: 'Error importing CSV structure', error: error.message });
    }
  },

  validate: async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'CSV file is required' });
      }

      const filePath = req.file.path;
      const fileContent = fs.readFileSync(filePath, 'utf-8');

      const parseResult = Papa.parse(fileContent, {
        header: true,
        skipEmptyLines: true,
        preview: 5,
      });

      res.json({
        valid: parseResult.errors.length === 0,
        headers: Object.keys(parseResult.data[0] || {}),
        errors: parseResult.errors,
        preview: parseResult.data,
      });
    } catch (error) {
      console.error('Validate CSV error:', error);
      res.status(500).json({ message: 'Error validating CSV', error: error.message });
    }
  },
};

module.exports = csvController;
