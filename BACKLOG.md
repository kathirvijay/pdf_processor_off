# Backlog

**Status:** 15 completed | 8 pending

Tasks to complete. Add items below as they are identified.

---

## Completed

1. **Page boundary guide when adding boxes** ✅ – Show a visible boundary (dotted line or marked line) indicating the end of the current page so that when adding a new box, users can place it within the page bounds.
2. **Hide missing Handlebars variables in HTML** ✅ – When populating exported HTML with dynamic data, missing variables show empty instead of the {{var}} placeholder.
3. **Rulers and global padding for alignment** ✅ – Vertical ruler on left and horizontal ruler on top of canvas; global padding fields (top, right, bottom, left) in Template Settings; boxes constrained to padded content area; visual padding guide when padding > 0.
4. **Table resize should push boxes below down** ✅ – When resizing a box (table or any) downward (s, sw, se handles), boxes below are pushed down instead of overlapping.
5. **Rulers: arrow marks and alignment guides** ✅ (partial) – Arrow marks and click-to-add alignment lines implemented. Full spec in #10.
6. **Global padding: prominent section and highlight toggle** ✅ – Global Padding & Alignment section; toggle to highlight padding area with transparent violet.
7. **Default page padding 40px on all sides** ✅ – Default global padding is 40px (top, right, bottom, left) for new templates and when no saved padding.
8. **Top padding consistent with other sides** ✅ – Content wrapper ensures top padding equals left/right/bottom; boxes and content respect uniform inset.
10. **Rulers: draggable arrows and highlight toggle** ✅ – Two draggable arrows on each ruler; bright orange alignment lines; "Highlight arrows" toggle in Global Layout.
11. **Remove black line below document title** ✅ – Removed the solid black horizontal line below the "PDF Document" title on the canvas.
12. **Fix top blue padding guide** ✅ – Top blue dotted line now aligns with the top padding boundary (above the document title), matching left, right, and bottom.
13. **Fit template boxes to alignment guides** ✅ – "Fit to guides" button in Global Layout snaps all boxes so their edges align with the orange alignment lines and padding boundaries.
14. **Lock guides to content area** ✅ – Replaced Fit to guides. Lock toggle: when ON, the 4 ruler guidelines drive the content area; dragging a guideline extends or compresses that edge.
15. **Move nested boxes outside parent** ✅ – Support moving boxes enclosed inside a parent/container box out to the canvas area. Spatial containment detection; drag excludes parent from overlap check so inner boxes can be dragged out; "Move to canvas" button in Properties when box is inside another.

---

## Pending

1. **Capture font size on document upload** – When a document is uploaded, capture and preserve the font size from the uploaded document.
2. **Multiple variables per box** – Allow each box input to support multiple variables (instead of a single variable per box).
3. **Order/layout for variables within box** – Variables within a box (e.g. logo box, container) can be ordered based on specifications and arranged vertically or horizontally.
4. **Variable name mapping (Waka)** – Map variables from Waka level to template variables in this system. Build/implement a mapping table to link Waka variables with template variables.
5. **Canvas level adjustment and rules** – Canvas-level adjustment, rules, and dynamic adjustment (auto-fit/resize, layout rules, etc.).
6. **Variables visible in HTML export** – Support multiple variables per box; when exporting to HTML, display the variables (e.g. {{var1}}, {{var2}}) visibly in the exported HTML so integrators know which variables map to each box.
7. **Left and right sidebars: expand/collapse** – Add expand and collapse controls for the left and right sidebars so users can hide them for more canvas space and show them when needed.
8. **Convert Global Layout checkboxes to toggle buttons** – In Global Layout, convert "Highlight padding area on canvas" and "Highlight arrows" from checkboxes to toggle-style buttons for a more modern UI.
9. **Box layout vs Custom layout toggle** – In Global Layout, add a toggle to switch between **Box layout** (grid/box-based canvas with visible boxes and borders) and **Custom layout** (non-boxy, free-flowing template like forms or cover pages with labels, varying alignment, horizontal lines, and natural content flow—no visible boxes). Toggle styling: Box layout = bright green; Custom layout = blue.
10. **Select nested boxes inside parent** – When a parent container has nested boxes inside it, clicking on a nested/child box currently selects the parent instead of the child. Fix: ensure child boxes receive clicks (e.g. higher z-index for contained boxes) so users can select and use "Move to canvas" on nested boxes.
