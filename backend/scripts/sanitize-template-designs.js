#!/usr/bin/env node
/**
 * Sanitize all template_designs: set design to layout-only (no key-value or content).
 * Run from backend folder: node scripts/sanitize-template-designs.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

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

function normalizeDesignToLayoutOnly(design) {
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
  const { initializeModels } = require(path.join(__dirname, '../shared/models'));
  const { getSequelize } = require(path.join(__dirname, '../shared/config/database'));
  const { resolveStaticUserIdFromDb } = require(path.join(__dirname, '../shared/config/staticUser'));

  console.log('Connecting to database...');
  const models = await initializeModels();
  const sequelize = getSequelize();
  await resolveStaticUserIdFromDb(sequelize);

  const { TemplateDesign } = models;
  const rows = await TemplateDesign.findAll();
  console.log(`Found ${rows.length} template design(s).`);

  let updated = 0;
  for (const row of rows) {
    const normalized = normalizeDesignToLayoutOnly(row.design);
    const current = JSON.stringify(row.design);
    const next = JSON.stringify(normalized);
    if (current !== next) {
      await row.update({ design: normalized });
      updated++;
      console.log(`  Sanitized: ${row.name} (${row.id})`);
    }
  }
  console.log(`Done. Updated ${updated} row(s).`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
