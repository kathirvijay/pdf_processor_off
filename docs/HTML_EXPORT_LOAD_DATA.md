# How to load / pass data into the exported HTML

The exported HTML includes embedded JavaScript. You can view it with the data that was loaded at export time, or pass your own data in three ways.

**Dynamic page numbers:** Use the placeholder `{{pages}}` in any box (e.g. "INSTRUCTION Pages: {{pages}}"). It is replaced automatically with the current page and total (e.g. "1 of 1", "1 of 2", "2 of 2") in the editor, PDF, and exported HTML.

---

## Option 1: Use the “Load custom data” panel (easiest, no console)

1. Open the exported `.html` file in a browser.
2. Click **“Load custom data (paste JSON)”** at the top.
3. Paste your JSON into the textarea (or edit the pre-filled data).
4. Click **“Apply data”**.

The template will re-render with your data. No need to use the browser console.

---

## Option 2: Data is already in the file (default)

When you export, the **current demo data** is embedded in the HTML in a script tag:

```html
<script type="application/json" id="template-data">{"port_of_loading":"Los Angeles", ...}</script>
```

- **Open the `.html` file in a browser** (double‑click or drag into Chrome/Edge/Firefox).
- The page will render using this embedded data (same as “Export with current data”).

To use **different data** in the same file:

1. Open the `.html` file in a text editor.
2. Find the tag: `<script type="application/json" id="template-data">`
3. **Replace the JSON** between `>` and `</script>` with your own data (valid JSON, same kind of keys as your template).
4. Save and open the file in a browser again.

Example: replace the contents with something like:

```json
{
  "port_of_loading": "New York",
  "date_of_departure": "15 March 2025",
  "marks_and_numbers_1": "1-UP",
  "kind_no_of_packages_1": "2 Pallets",
  "description_of_goods_1": "Electronics",
  "gross_weight_kg_1": "1056",
  "measurements_m3_1": "5.48",
  "marks_and_numbers_2": "2-UP",
  "kind_no_of_packages_2": "1 Crate",
  "description_of_goods_2": "Parts",
  "gross_weight_kg_2": "200",
  "measurements_m3_2": "1.2"
}
```

---

## Option 3: Pass data from the browser console

Use this when you want to **change data without editing the file** (e.g. from another script or API).

1. Open the exported `.html` file in a browser.
2. Open Developer Tools (F12) and go to the **Console** tab.
3. Set your data and re-render:

```javascript
window.templateData = {
  port_of_loading: "Rotterdam",
  date_of_departure: "20 April 2025",
  total_this_page: "10 Pallets",
  consignment_total: "10 Pallets",
  marks_and_numbers_1: "1-UP",
  kind_no_of_packages_1: "3 Pallets",
  description_of_goods_1: "Goods",
  gross_weight_kg_1: "1500",
  measurements_m3_1: "6.0"
  // add more keys as needed (e.g. marks_and_numbers_2, ...)
};
window.applyTemplateData();
```

4. The page will re-render with your data. Table rules (e.g. ≤3 items on first page, >3 “attached list”) and headings on every page are applied by the script.

**Alternative (paste JSON string):**  
`window.loadTemplateDataFromJson('{"port_of_loading":"NY","date_of_departure":"2025-01-01"}');`  
Use this if you find it easier to paste a single JSON string than to type an object.

---

## Data priority

The script uses data in this order:

1. **`#template-data`** – JSON inside the `<script id="template-data">` tag in the file.
2. **`window.templateData`** – Value you set in the console (or from another script).
3. **Initial export data** – The data that was in the app when you exported.

So: if you embed JSON in `#template-data`, that is used when you just open the file. If you set `window.templateData` and call `applyTemplateData()`, that overrides for that run.

---

## Example: minimal data to test the template

Paste this in the console (or into `#template-data` as JSON) to test:

```javascript
window.templateData = {
  port_of_loading: "Los Angeles, USA",
  date_of_departure: "11 February 2024",
  total_this_page: "25 Pallets",
  consignment_total: "25 Pallets",
  special_instructions: "Handle with care.",
  place_and_date_of_issue: "Los Angeles, 11 February 2024",
  signatory_company: "Global Sea Freight Ltd.",
  name_of_authorized_signatory: "J. Smith",
  marks_and_numbers_1: "1-UP",
  kind_no_of_packages_1: "2 Pallets",
  description_of_goods_1: "Electronics",
  gross_weight_kg_1: "1056",
  measurements_m3_1: "5.48",
  marks_and_numbers_2: "2-UP",
  kind_no_of_packages_2: "2 Pallets",
  description_of_goods_2: "Electronics",
  gross_weight_kg_2: "1056",
  measurements_m3_2: "5.48",
  marks_and_numbers_3: "3-UP",
  kind_no_of_packages_3: "4 Crates",
  description_of_goods_3: "Machinery",
  gross_weight_kg_3: "2100",
  measurements_m3_3: "8.2"
};
window.applyTemplateData();
```

With 3 table rows, they all appear on the first page. If you add more `_4`, `_5`, … keys (and more rows), the script will switch to "attached list" and extra pages as in the app.

**Why placeholders stay as `{{...}}`:** Each placeholder (e.g. `{{shipping_in_exporter}}`) is replaced only when your JSON has a **matching key**. If your JSON only has table keys like `description_of_goods_70`, those fill the table but not the other boxes. Include both header/field keys (e.g. `port_of_loading`, `consignee`, `shipping_in_exporter`) and table keys in your JSON; copy the structure from the data that was in the app when you exported. Missing keys are shown as empty. “attached list”