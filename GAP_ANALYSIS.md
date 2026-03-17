# Gap Analysis: 80px Between Data Table and Container Fields

## Problem
An ~80px gap persists between the Data table (below the "Data" row) and the container fields (Container No(s), Seal No(s), Size/Type). Resizing the table or moving the container fields does not close the gap.

## Root Cause

The layout logic in `dataTableLayout` (TemplateEditor.jsx) computes `boxYOffset` to maintain an 8px gap between the table and the next elements. Two issues cause the gap to persist:

### 1. **`minY` is null → wrong fallback pushes boxes DOWN**
When computing the offset for boxes below the table:
- **Intended:** `offset = spacerBottom - minY` → pulls container UP to achieve 8px gap
- **When `minY` is null:** fallback `(tEffective + spacerPx) - tDesign` → pushes container DOWN by 8px
- If the container is already 80px below the table, this fallback makes the gap **88px** instead of closing it

### 2. **`minY` can be null when horizontal overlap check is too strict**
`minY` is the minimum Y of boxes that are "below" the table and overlap horizontally. It becomes null when:
- No box satisfies `horizOverlap && (isBelow || overlapsGap)`
- If the table and container have different widths or alignment, `horizOverlap` can fail
- Tables from PDF import or different creation paths may have different coordinate setups

### 3. **Layout only runs for `dynamicRowsFromData` tables**
The layout logic only applies when `box.tableConfig?.dynamicRowsFromData && Array.isArray(box.tableConfig?.columnKeys)`. Tables created without this flag (e.g. from PDF import) get no offset at all → gap stays at raw design positions.

## Fix Strategy

1. **Relax `minY` fallback:** When `minY` is null, use `0` instead of `(tEffective + spacerPx) - tDesign` so we never push boxes down when we can't find the first box below.
2. **Relax horizontal overlap for `minY`:** Also consider boxes that are vertically below the table (`bTop >= firstSegmentBottom`) using a looser horizontal check (e.g. vertical alignment or same-page region) so `minY` is found more reliably.
3. **Apply layout to tables with `columnKeys`:** Include tables that have `columnKeys` (data tables) even when `dynamicRowsFromData` is missing, so PDF-imported tables get layout.
