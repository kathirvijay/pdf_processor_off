# Backlog

Tasks to complete. Add items below as they are identified.

---

## Pending

1. **Capture font size on document upload** – When a document is uploaded, capture and preserve the font size from the uploaded document.
2. **Multiple variables per box** – Allow each box input to support multiple variables (instead of a single variable per box).
3. **Order/layout for variables within box** – Variables within a box (e.g. logo box, container) can be ordered based on specifications and arranged vertically or horizontally.
4. **Variable name mapping (Waka)** – Map variables from Waka level to template variables in this system. Build/implement a mapping table to link Waka variables with template variables.
5. **Canvas level adjustment and rules** – Canvas-level adjustment, rules, and dynamic adjustment (auto-fit/resize, layout rules, etc.).
6. ~~**Page boundary guide when adding boxes**~~ ✅ – Show a visible boundary (dotted line or marked line) indicating the end of the current page (top/bottom or left/right limits) so that when adding a new box at the bottom, users can place it within the page bounds and avoid boxes overlapping or disrupting the next page.
7. **Variables visible in HTML export** – Support multiple variables per box; when exporting to HTML, display the variables (e.g. {{var1}}, {{var2}}) visibly in the exported HTML so integrators know which variables map to each box.
8. **Hide missing Handlebars variables in HTML** – When populating exported HTML with dynamic data, if a variable's value is not passed from the API, do not show the Handlebars placeholder (e.g. {{var}}). Instead show a gap/empty – the variable should be hidden when its value is missing.

