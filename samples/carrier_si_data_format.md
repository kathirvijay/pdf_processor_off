# Carrier SI Template – Data Format

The `carrier_si_template.html` is dynamic and expects data to be passed at runtime. No data is embedded in the template.

## How to pass data

1. **`#template-data`** – Replace the JSON in `<script id="template-data">` before rendering.
2. **`window.loadTemplateDataFromJson(jsonString)`** – Call with a JSON string.
3. **`window.templateData = obj; window.applyTemplateData();`** – Set object and re-render.

---

## Booking type

Use when the SI is generated from a **booking** (flat cargo list, no container breakdown).

**Required:** `cargo_line_items` array, and `containers` empty or absent.

### JSON structure

```json
{
  "shipper_company_name": "string",
  "reference_number": "string",
  "ocean_bill_number": "string",
  "si_reference_number": "string",
  "carrier_name": "string",
  "attn": "string | null",
  "from": "string",
  "print_time": "string",
  "freight_charges_display": "string | null",
  "vessel_name": "string",
  "voyage": "string",
  "port_of_loading": "string",
  "port_of_discharge": "string",
  "place_of_delivery": "string | null",
  "shipper_name": "string",
  "shipper_address": "string",
  "shipper_city": "string",
  "shipper_country": "string",
  "shipper_contact": "string",
  "shipper_tax_identifier": "string | null",
  "notify_party_name": "string",
  "notify_party_address": "string",
  "notify_party_city": "string",
  "notify_party_country": "string",
  "consignee_name": "string",
  "consignee_address": "string",
  "consignee_city": "string",
  "consignee_country": "string",
  "consignee_person": "string",
  "consignee_contact": "string",
  "notify_name": "string",
  "notify_address": "string",
  "notify_city": "string",
  "notify_country": "string",
  "containers": [],
  "cargo_line_items": [
    {
      "marks_and_numbers": "string",
      "number_of_packages": "string",
      "packages": "string",
      "cargo_description": "string",
      "description": "string",
      "commodity": "string",
      "weight": "string",
      "volume": "string"
    }
  ]
}
```

**Sample:** `carrier_si_booking_data.json`

---

## Consolidation type

Use when the SI is generated from a **consolidation** (container-level breakdown).

**Required:** `containers` array with at least one container that has an `items` array, **or** `consolidations` array with containers that have `items`.

### JSON structure

```json
{
  "shipper_company_name": "string",
  "reference_number": "string",
  "ocean_bill_number": "string",
  "si_reference_number": "string",
  "carrier_name": "string",
  "attn": "string | null",
  "from": "string",
  "print_time": "string",
  "freight_charges_display": "string | null",
  "vessel_name": "string",
  "voyage": "string",
  "port_of_loading": "string",
  "port_of_discharge": "string",
  "place_of_delivery": "string | null",
  "shipper_name": "string",
  "consignee_name": "string",
  "containers": [
    {
      "container_number": "string",
      "container_type": "string",
      "seal_number": "string | null",
      "size_type": "string",
      "movement": "string",
      "carrier_s_o_no": "string",
      "carrier_booking_id": "string",
      "items": [
        {
          "marks_and_numbers": "string",
          "number_of_packages": "string",
          "packages": "string",
          "cargo_description": "string",
          "description": "string",
          "commodity": "string",
          "weight": "string",
          "volume": "string"
        }
      ]
    }
  ],
  "consolidations": [
    {
      "consolidation_number": "string",
      "consolidation_id": "string",
      "containers": [
        {
          "container_number": "string",
          "container_type": "string",
          "seal_number": "string | null",
          "movement": "string",
          "carrier_s_o_no": "string",
          "items": [ /* same as containers[].items */ ]
        }
      ]
    }
  ]
}
```

**Sample:** `carrier_si_consolidation_data.json`

---

## Mode detection

| Condition | Mode |
|-----------|------|
| `containers` has at least one container with `items` | Consolidation |
| `consolidations` has containers with `items` | Consolidation |
| Otherwise (only `cargo_line_items`) | Booking |

---

## Cargo line item fields

| Field | Description |
|-------|-------------|
| `marks_and_numbers` | Marks and numbers |
| `packages` / `number_of_packages` | Number of packages |
| `cargo_description` / `description` / `commodity` | Description of goods |
| `weight` | Gross weight (kg) |
| `volume` | Measurements (m³) |

## Container fields

| Field | Description |
|-------|-------------|
| `container_number` | Container number |
| `container_type` | Type (e.g. 20FR, 40GP) |
| `seal_number` | Seal number |
| `movement` | Movement (e.g. CY/CY) |
| `carrier_s_o_no` / `carrier_booking_id` | Carrier S/O number |
| `items` | Array of cargo line items |
