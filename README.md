# PDF Processor O

Reduced single-page PDF template creator: no login, no versions, no CSV import, no validations. Create templates with boxes and placeholders (fixed top-left inside each box), then Save and Create PDF.

**Uses the same database as the main pdf_processor app.** Both apps share the same PostgreSQL database and the same credentials. This minimal app has no login/logout; it uses a **static user** (one user ID in the DB) for all templates and generated PDFs.

## Stack

- **Frontend:** React (Vite), single page
- **Backend:** Node.js, Express (MVC-style: template service + PDF service, gateway)

## Features

- **Single page:** Template creation area + "Saved templates" count + "Create New Template" + open existing from dropdown
- **Top navbar:** Template name, page size (A4 / A3 / A5), orientation (Portrait / Landscape), Save, Create PDF
- **Left sidebar:** Document title, **CSV Import** (upload CSV with fields and box coordinates to create template structure), Template settings (outline template / outline box / individual box control), Table mode (static/dynamic), Box library (text, table, container), Properties (label, field, content, font size, font color, box outline, width, height). No validations, no inner content color
- **Placeholders:** Content inside each box is fixed at top-left (not movable)
- **Backend:** Same pattern as main pdf_processor: template CRUD + PDF generation, no auth

## Setup

### Backend (same database as pdf_processor)

1. Use the **same PostgreSQL database** as the main pdf_processor app (same `DB_NAME`, `DB_USER`, `DB_PASSWORD`). Copy `backend/.env.example` to `backend/.env` and set:
   - `DB_NAME=pdf_processor` (same as main app)
   - `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT` to match the main app (or `DATABASE_URL`)
   - **`STATIC_USER_ID`**: a UUID of a user that exists in the `users` table. Options:
  - Register a new user in the main pdf_processor app (Register page), then in the DB run `SELECT id FROM users ORDER BY created_at DESC LIMIT 1;` and copy the `id` into `STATIC_USER_ID`.
  - Or insert a dedicated row: `INSERT INTO users (id, email, ...) VALUES (gen_random_uuid(), 'minimal-app@local', ...);` and use that `id`.
2. Install and start:
   ```bash
   cd backend
   npm install
   npm run dev
   ```
   This starts gateway (5000), template service (5002), PDF service (5003), and CSV service (5004). No separate database or new tables are needed; the app uses the existing `templates` and `generated_pdfs` tables with the static user.
3. **Optional – template import alignment:** For flat PDFs (no form fields), the backend uses **Python + PyMuPDF** to align boxes with the template: (1) **Table detection** (`find_tables()`) for form/table layout (e.g. Bill of Lading); (2) **Drawing-based grid** from PDF vector lines/rects; (3) text-only fallback. You need a Python that has **pip** and **pymupdf**. Install: `python -m pip install pymupdf` (use the Python you want the backend to use). If your default `python` has no pip (e.g. MSYS2 MinGW), install [Python from python.org](https://www.python.org/downloads/), then run `python -m pip install pymupdf`. To force the backend to use a specific Python, set in `backend/.env`: `PYTHON_PATH=C:\Path\To\python.exe` (or `PYTHON_CMD`). If Python/PyMuPDF is unavailable, import falls back to text-only detection.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 (or the port Vite prints). Set `VITE_API_URL=http://localhost:5000/api` if the API is not proxied.

## API (via gateway :5000)

- `GET /api/templates/list` – list all templates
- `GET /api/templates/:id` – get one template
- `POST /api/templates` – create template (body: name, settings, pages, etc.)
- `PUT /api/templates/:id` – update template
- `POST /api/pdf/generate` – generate PDF (body: `{ templateId, data? }`), returns PDF file
- `POST /api/csv/import-structure` – import template structure from CSV (multipart file). Returns `{ boxes, templateName?, page }`. CSV columns: **Field Name** (or Parameter Name, Title, Name); coordinates: **Left, Top, Right, Bottom** OR **Position X, Position Y, Width, Height**; optional: Template Name, Rank, Type, Content, Font Size, Alignment, Label Name, Font Weight, Font Color, Background Color.

## Templates table structure

The **templates** table stores each saved document with:

| Column | Description |
|--------|-------------|
| **id** | UUID primary key |
| **name** | Template name (required) |
| **document_name** | Name of the source document (optional) |
| **user_id** | Creator (references `users.id`); this app uses `STATIC_USER_ID` |
| **settings** | JSON: orientation, pageSize, margins, title |
| **pages** | JSON: array of pages, each with `boxes` (position, size, labelName, fieldName, content, properties) |
| **template_key_value** | JSON: extracted parameters as key-value, e.g. `{ "shipper": "{{shipper}}", "bill_of_lading_number": "{{bill_of_lading_number}}" }` |

When you create or update a template, `template_key_value` is built automatically from all boxes’ `fieldName` and `content` (or `{{fieldName}}` placeholder).

**Migration:** If your database was created before these columns existed, run:
```bash
psql -U postgres -d pdf_processor -f backend/shared/migrations/001_add_template_document_and_keyvalue.sql
```

## Error logging

- **Backend:** Winston logs to `backend/logs/error.log` (errors only) and `backend/logs/combined.log` (all levels). Console output is colorized. Set `LOG_LEVEL=debug` in `.env` for verbose logging.
- **Frontend:** Errors are logged to the browser console and sent to `POST /api/logs`, which writes them to the backend logs. Use DevTools → Console to inspect failures.

## Project layout

- `backend/` – gateway, template-service, pdf-service, shared (config, models, middleware, utils)
- `frontend/` – React app, single page `TemplateEditor`
