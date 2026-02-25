#!/usr/bin/env node
/**
 * Create standardized format and/or template designs from a JSON file.
 * Design boxes must be layout-only (id, position, size, type, rank, tableConfig).
 *
 * JSON format:
 * {
 *   "standardizedFormat": {
 *     "name": "Bill of Lading",
 *     "slug": "bill-of-lading",
 *     "description": "Optional",
 *     "keyValuePairs": [ { "key": "shipper", "label": "Shipper" }, ... ]
 *   },
 *   "templateDesigns": [
 *     {
 *       "name": "BOL Layout 1",
 *       "standardizedTemplateId": "<uuid of format, or null>",
 *       "design": { "pages": [ { "pageNumber": 1, "boxes": [ { "id": "...", "position": { "x", "y" }, "size": { "width", "height" }, "type": "text", "rank": 1 } ] } ] },
 *       "settings": { "pageSize": "A4", "orientation": "portrait" }
 *     }
 *   ]
 * }
 *
 * Run from backend folder:
 *   node scripts/seed-designs-and-format.js path/to/your-file.json
 *
 * If standardizedTemplateId in a design is null, you can set it after creating the format
 * (script creates format first, then designs; you can put the format id in the JSON after first run, or leave null).
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');

function boxesToLayoutOnly(boxes) {
  if (!Array.isArray(boxes)) return [];
  return boxes.map((b) => {
    const out = {
      id: b.id || `box_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      position: { x: Number(b.position?.x) || 0, y: Number(b.position?.y) || 0 },
      size: { width: Number(b.size?.width) || 100, height: Number(b.size?.height) || 20 },
      type: b.type || 'text',
      rank: b.rank ?? 0,
    };
    if (out.type === 'table' && b.tableConfig) out.tableConfig = b.tableConfig;
    return out;
  });
}

function normalizeDesign(design) {
  if (!design || typeof design !== 'object') return { pages: [{ boxes: [] }] };
  const pages = Array.isArray(design.pages) ? design.pages : [{ boxes: [] }];
  return {
    pages: pages.map((p, i) => ({
      pageNumber: p.pageNumber ?? i + 1,
      boxes: boxesToLayoutOnly(p.boxes),
    })),
  };
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.log('Usage: node scripts/seed-designs-and-format.js <path-to-json>');
    console.log('Example: node scripts/seed-designs-and-format.js ./uploads/designs.json');
    process.exit(1);
  }
  const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absPath)) {
    console.error('File not found:', absPath);
    process.exit(1);
  }

  const raw = fs.readFileSync(absPath, 'utf8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.error('Invalid JSON:', e.message);
    process.exit(1);
  }

  const { initializeModels } = require(path.join(__dirname, '../shared/models'));
  const { getSequelize } = require(path.join(__dirname, '../shared/config/database'));
  const { resolveStaticUserIdFromDb } = require(path.join(__dirname, '../shared/config/staticUser'));

  console.log('Connecting to database...');
  const models = await initializeModels();
  const sequelize = getSequelize();
  await resolveStaticUserIdFromDb(sequelize);
  const userId = process.env.STATIC_USER_ID;

  const { StandardizedTemplate, TemplateDesign } = models;
  let formatId = null;

  if (data.standardizedFormat && data.standardizedFormat.name) {
    const f = data.standardizedFormat;
    const pairs = (f.keyValuePairs || []).map((p) => ({
      key: String(p?.key ?? '').trim() || undefined,
      label: String(p?.label ?? p?.key ?? '').trim() || undefined,
    })).filter((p) => p.key);
    const row = await StandardizedTemplate.create({
      name: String(f.name).trim(),
      slug: (f.slug && String(f.slug).trim()) || null,
      description: (f.description && String(f.description).trim()) || null,
      keyValuePairs: pairs,
      isActive: true,
    });
    formatId = row.id;
    console.log('Created standardized format:', row.name, row.id);
  }

  const designs = Array.isArray(data.templateDesigns) ? data.templateDesigns : [];
  for (const d of designs) {
    const designPayload = normalizeDesign(d.design);
    const linkedId = d.standardizedTemplateId || formatId || null;
    await TemplateDesign.create({
      name: (d.name && String(d.name).trim()) || 'Unnamed design',
      userId,
      standardizedTemplateId: linkedId,
      design: designPayload,
      settings: d.settings || { pageSize: 'A4', orientation: 'portrait' },
    });
    console.log('Created template design:', d.name || 'Unnamed');
  }

  console.log('Done. Format id (for reference):', formatId);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
