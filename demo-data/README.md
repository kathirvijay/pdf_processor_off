# Demo data

Sample JSON files for preview and PDF generation.

## Packaging list

Demo data for the **packaging list** template using the standard packing list variables.

| File | Description |
|------|-------------|
| `packaging-list-3-items.json` | 3 line items in the table |
| `packaging-list-25-items.json` | 25 line items |
| `packaging-list-75-items.json` | 75 line items |

Use these in the template editor **Demo data** section (paste JSON or load file) to preview and generate PDFs with different table sizes.

Variables included: `additional_info`, `bill_of_lading_number`, `buyer_if_not_consignee`, `buyer_reference`, `consignee`, `consignment_total`, `country_of_final_destination`, `country_of_origin_of_goods`, `date_of_departure`, `description_of_goods`, `export_invoice_number_date`, `final_destination`, `gross_weight_kg`, `kind_no_of_packages`, `measurement_m`, `method_of_dispatch`, `name_of_authorized_signatory`, `net_weight_kg`, `packin_exporter`, `packing_information`, `port_of_discharge`, `port_of_loading`, `product_code`, `reference`, `signatory_company`, `signature`, `total_this_page`, `type_of_shipment`, `unit_quantity`, `vessel_aircraft`, `voyage_no`, plus table rows as `product_code_1`, `description_of_goods_1`, etc.

## Shipment instruction

Demo data for **shipment instruction** templates. Simple instruction-style text; same keys as templates expect.

| File | Description |
|------|-------------|
| `Strip1 section 3 items.json` | 3 line items (flat keys) |
| `Strip1 section 3 items container.json` | 3 items with `containers` array + flat keys |
| `Strip1 section 10 items.json` | 10 line items |
| `Strip1 section 10 items with blanks.json` | 10 items with some fields blank |
| `Strip1 section 25 items.json` | 25 line items |
| `Strip1 section 25 items container.json` | 25 items with containers |
| `Strip1 section 75 items.json` | 75 line items |
| `Strip1 section 75 items container.json` | 75 items with containers |

Run `node generate-strip1-demo.js` in `demo-data/shipment instruction/` to regenerate the 25- and 75-item files.

## Carrier S/I

Demo data for **Carrier Shipping Instruction (S/I)** templates. Based on the Carrier S/I PDF layout (shipper, consignee, ports, vessel, cargo table, container table).

| File | Description |
|------|-------------|
| `carrier-si-3-items.json` | 3 cargo line items |
| `carrier-si-default.json` | 8 cargo line items (default sample) |
| `carrier-si-25-items.json` | 25 cargo line items |
| `carrier-si-45-items.json` | 45 cargo line items |

Run `node generate-carrier-si-demo.js` in `demo-data/carrier si/` to regenerate the 25-, 45-, and default files.

Variables match `carrier_si.html`: `shipper`, `consignee`, `reference_no`, `si_ref_no`, `contract_no`, `notify_party`, `place_of_delivery`, `place_of_recipt`, `subject`, `service_type`, `print_time`, `loading_port`, `discharge_port`, `payable_at`, `payable_by`, `vessel_name`, `voyage_no`, `ocean_freight`, `pre_carriage`, `total_this_page`, `consignment_total`, `container_list`, `signatory_company`, `signature`, `name_of_authorized_signatory`, `pages`. Cargo table: `marks_nos_N`, `kind_no_of_packages_N`, `description_of_goods_N`, `gross_weight_kg_N`, `measurements_m3_N`. Container table: `carrier_s_o_no_N`, `container_no_N`, `size_N`, `seal_no_N`, `movement_N`, `cntr_pkgs_unit_N`, `cntr_cbm_N`, `cntr_kgs_N`.
