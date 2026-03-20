# Demo data (sample JSON)

Flat JSON objects for **preview / “Load sample”** style workflows on exported HTML templates (`{{placeholder}}` + indexed table keys `_1` … `_25`).

| File | Matches HTML under `samples/temp/` |
|------|-------------------------------------|
| `FCR_hongkong_sample_data.json` | `FCR_hongkong.html` — FCR + doc original/copy counts + 25 cargo rows |
| `csde_BOL_sample_data.json` | `csde_BOL.html` — CSDE BOL + 5-column cargo table × 25 |
| `SEA_waybill_FCR_sample_data.json` | `SEA_waybill_FCR.html` — Sea waybill + 5-column table × 25 |
| `TELEX_United_container_sample_data.json` | `TELEX_United_container.html` — Telex + 5-column table × 25 |
| `carrier_si_booking_sample_data_25.json` | **Carrier SI / booking** (`samples/carrier_si_template.html` style): `cargo_line_items` array with **25** rows (not the same key layout as BOL/FCR exports) |

## Regenerate

From this folder:

```bash
node generate-all.js
```

Indexed keys follow each template’s `template-config` **columnKeys** (e.g. `marks_nos_1`, `gross_weight_kg_1`, …). Helpers like `kind_no_of_packages_N` / `description_of_goods_N` are included where the runtime merges them into description columns.
