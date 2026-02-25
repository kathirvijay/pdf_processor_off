# Backend scripts

## Sanitize template designs (layout only, no key-value)

Ensures all rows in `template_designs` have `design` with **layout-only** boxes (id, position, size, type, rank; no fieldName, labelName, content).

```bash
# From backend folder
node scripts/sanitize-template-designs.js
```

## Seed standardized format and template designs

Creates one standardized format and/or multiple template designs from a JSON file. Boxes in the JSON must be layout-only (no key-value or content). Design table will store only box layout.

**JSON format:**

- `standardizedFormat` (optional): `{ name, slug?, description?, keyValuePairs: [ { key, label } ] }`
- `templateDesigns`: array of `{ name, standardizedTemplateId?, design: { pages: [ { pageNumber, boxes: [ { id, position: {x,y}, size: {width,height}, type, rank } ] } ] }, settings? }`

**Run:**

```bash
# From backend folder
node scripts/seed-designs-and-format.js path/to/your-file.json
```

**Example (sample file):**

```bash
node scripts/seed-designs-and-format.js scripts/sample-designs-format.json
```

If `standardizedTemplateId` in a design is `null`, the script will link it to the format created in the same run (if `standardizedFormat` is present). Otherwise set the UUID of an existing format in your JSON.

**Upload workflow:** Edit `sample-designs-format.json` (or your own JSON) with your format and layout-only boxes, then run the seed script.
