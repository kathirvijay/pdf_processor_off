# Sample CSV templates for PDF Processor O

Use these CSVs with **CSV Import → Import Structure** in the app. Each file defines fields and box coordinates to build a template automatically.

## Files

| File | Description |
|------|-------------|
| **01_bill_of_lading.csv** | Bill of Lading – shipper, consignee, vessel, ports, marks, description, weight, freight |
| **02_booking_template.csv** | Shipping Booking Request – booking ref, shipper/consignee, origin/destination, cargo, containers |
| **03_consolidation_step1.csv** | Step 1 Consolidation – master B/L, house B/L ref, consolidator, packages, description |
| **04_commercial_invoice.csv** | Commercial Invoice – seller/buyer, items, quantity, unit price, amount, bank details |
| **05_shipment_bill_of_lading.csv** | Shipment B/L – carrier, vessel, POL/POD, container/seal, freight, signature |

## CSV format (for your own templates)

- **Required name column:** one of `Field Name`, `Parameter Name`, `Container Name`, `Title`, `Name`
- **Required coordinates:** either  
  - `Left`, `Top`, `Right`, `Bottom`  
  - or `Position X`, `Position Y`, `Width`, `Height`
- **Optional:** `Template Name` (first row sets document/template title), `Label Name`, `Rank`, `Type`, `Content`, `Font Size`, `Alignment`, `Font Weight`, `Font Color`, `Background Color`

Coordinates are in pixels (editor canvas; A4 width ≈ 794px). Adjust X, Y, Width, Height as needed after import.

## How to use

1. In the app, open the **CSV Import** section in the left sidebar.
2. Click **Import Structure** and choose one of these CSV files.
3. The canvas will be filled with boxes; the first row’s **Template Name** (if present) sets the template title.
4. Click **Save** to create or update the template, then **Create PDF** to generate a PDF.
