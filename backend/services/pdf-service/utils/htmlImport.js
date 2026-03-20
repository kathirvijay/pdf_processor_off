/**
 * Prefer <title> text; fall back to filename stem or a default label.
 */
function extractTemplateNameFromHtml(html, fallbackName) {
  if (!html || typeof html !== 'string') return fallbackName || 'Imported HTML';
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (m) {
    const t = m[1].replace(/\s+/g, ' ').trim();
    if (t) return t.length > 200 ? t.slice(0, 200) : t;
  }
  return fallbackName || 'Imported HTML';
}

module.exports = { extractTemplateNameFromHtml };
