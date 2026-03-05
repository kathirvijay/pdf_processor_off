# Backlog

**Status:** 2 completed | 7 pending

Tasks to complete. Add items below as they are identified.

---

## Completed

1. **Page boundary guide when adding boxes** ✅ – Show a visible boundary (dotted line or marked line) indicating the end of the current page so that when adding a new box, users can place it within the page bounds.
2. **Hide missing Handlebars variables in HTML** ✅ – When populating exported HTML with dynamic data, missing variables show empty instead of the {{var}} placeholder.

---

## Pending

1. **Capture font size on document upload** – When a document is uploaded, capture and preserve the font size from the uploaded document.
2. **Multiple variables per box** – Allow each box input to support multiple variables (instead of a single variable per box).
3. **Order/layout for variables within box** – Variables within a box (e.g. logo box, container) can be ordered based on specifications and arranged vertically or horizontally.
4. **Variable name mapping (Waka)** – Map variables from Waka level to template variables in this system. Build/implement a mapping table to link Waka variables with template variables.
5. **Canvas level adjustment and rules** – Canvas-level adjustment, rules, and dynamic adjustment (auto-fit/resize, layout rules, etc.).
6. **Variables visible in HTML export** – Support multiple variables per box; when exporting to HTML, display the variables (e.g. {{var1}}, {{var2}}) visibly in the exported HTML so integrators know which variables map to each box.
7. **Rulers and global padding for alignment** – For the chosen page layout (A4, A3, etc.), add: (a) **Rulers** – a vertical ruler on the left and a horizontal ruler on the top of the canvas so users can align boxes using ruler measurements; (b) **Global padding** – add canvas-level fields for padding top, padding bottom, padding left, and padding right. All boxes that touch the outer edges should extend or align to these padding boundaries so that the overall layout forms a single, even outer shell with straight alignment (left columns in line, right columns in line, top and bottom in line). This ensures the document looks like one coherent box structure.

