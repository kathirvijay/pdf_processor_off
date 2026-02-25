# Restore Point — Template Baseline

**Date:** 2025-02-19

This document marks the **current state of the project as the official restore point**.

- Any **previous** restore point is **superseded** by this one. This is the only active restore point.
- All **future work** and changes should be done **starting from here**. This is the baseline.

## What this baseline includes

- Template editor with: Label only, Value only, Empty box (mutually exclusive)
- Selected box brought to top z-index so resize handles are accessible when overlapping
- No rulers/guides (that feature was reverted)
- All other template editor, PDF, and export behavior as implemented up to this date

## How to restore to this point

The project uses a **file-based restore point** in `.cursor/restore-point/`. When you (or the AI) run a restore:

1. Read **`.cursor/restore-point/RESTORE_POINT.md`** for the list of snapshot files and their target paths.
2. Copy each file from `.cursor/restore-point/` to its project path (overwrite).
3. Treat the restore point as the single source of truth.

Say **"move to restore point"**, **"restore point"**, or **"revert to restore point"** to trigger this.

## New restore point later

When you want to update the baseline: copy the current `TemplateEditor.jsx`, `TemplateEditor.css`, and `pdfGenerator.js` into `.cursor/restore-point/`, then update `.cursor/restore-point/RESTORE_POINT.md` (and this file if desired) with the new date and description. The new state becomes the latest restore point and replaces the previous one.
