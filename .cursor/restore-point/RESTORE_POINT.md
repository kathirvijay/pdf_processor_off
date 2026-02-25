# Restore Point (latest — 2025-02-19)

**This is the current restore point.** Any previous restore point is superseded and removed; this is the only active baseline. All future work starts from here.

When the user says **"move to restore point"**, **"restore point"**, **"go to restore point"**, or **"revert to restore point"**, restore the codebase to this saved state by copying the snapshot files below to their target paths (overwrite). Any changes made after this restore point are reverted.

## Snapshot files → target paths

| Snapshot file (in `.cursor/restore-point/`) | Restore to (project path) |
|--------------------------------------------|----------------------------|
| `pdfGenerator.js` | `backend/services/pdf-service/utils/pdfGenerator.js` |
| `TemplateEditor.jsx` | `frontend/src/pages/TemplateEditor.jsx` |
| `TemplateEditor.css` | `frontend/src/pages/TemplateEditor.css` |

## How to restore

1. Copy each file from `.cursor/restore-point/` to its target path in the table above (overwrite the current file).
2. Treat the restore point as the single source of truth; do not keep later changes.

## State at this restore point

- **Template editor:** Label only, Value only, Empty box (mutually exclusive). Selected box has higher z-index so resize handles stay on top when overlapping. No rulers/guides (reverted).
- **Export/PDF:** Box content respects `labelOnly`, `valueOnly`, and `emptyBox` in HTML export and PDF generation.
- **Other:** All template editor, PDF, and export behavior as of this date.

## Refreshing the snapshot files

If you create or update this restore point, copy the three project files into `.cursor/restore-point/` so restore works for all of them: `frontend/src/pages/TemplateEditor.jsx` → `TemplateEditor.jsx`, `frontend/src/pages/TemplateEditor.css` → `TemplateEditor.css`, `backend/services/pdf-service/utils/pdfGenerator.js` → `pdfGenerator.js`. If any snapshot file is missing, restore will only apply the files that exist in this folder.
