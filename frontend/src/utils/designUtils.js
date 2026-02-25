/**
 * Normalize boxes to layout-only (position, size, type, rank). No key-value or content.
 * Used when saving to template_designs so the design holds only the box pattern.
 * @param {Array<object>} boxes
 * @returns {Array<object>} boxes with only id, position, size, type, rank, tableConfig (if table)
 */
export function boxesToLayoutOnly(boxes) {
  if (!Array.isArray(boxes)) return [];
  return boxes.map((b) => {
    const out = {
      id: b.id || `box_${Math.random().toString(36).slice(2)}`,
      position: { x: Number(b.position?.x) || 0, y: Number(b.position?.y) || 0 },
      size: {
        width: Number(b.size?.width) || 100,
        height: Number(b.size?.height) || 20,
      },
      type: b.type || 'text',
      rank: b.rank ?? 0,
    };
    if (out.type === 'table' && b.tableConfig) {
      out.tableConfig = b.tableConfig;
    }
    return out;
  });
}
