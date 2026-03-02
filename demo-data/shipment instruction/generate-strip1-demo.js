const fs = require('fs');
const path = require('path');

const header = {
  buyer_reference: "BR-001",
  carrier: "Carrier",
  carrier_address: "Carrier address",
  carrier_name: "Carrier",
  consignee: "Consignee, Consignee address",
  consignee_address: "Consignee address",
  consignee_name: "Consignee",
  country_of_final_destination: "Country",
  country_of_origin_of_goods: "Origin",
  date_of_departure: "01 Jan 2024",
  declared_value: "As per invoice",
  description_of_goods: "See list below",
  document_instructions: "Original plus 2 copies",
  does_this_shipment_contain_hazardous_dangerous: "No",
  final_destination: "Destination",
  freight_charges: "Prepaid",
  incoterms: "CIF",
  incoterms_2020: "CIF",
  is_shipment_contain_goods: "Yes",
  is_shipment_on_letter: "No",
  is_this_shipment_on_letter_of_credit: "No",
  method_of_dispatch: "Sea Freight",
  name_of_authorized_signatory: "Name",
  notify_party_address: "As consignee",
  notify_party_name: "As consignee",
  notify_party_if_not_consignee: "As consignee",
  pages: "1 of 1",
  place_and_date_of_issue: "Place, Date",
  place_of_receipt: "Place of receipt",
  port_of_discharge: "Port of discharge",
  port_of_loading: "Port of loading",
  reference: "REF-001",
  shipper_address: "Shipper address",
  shipper_name: "Shipper",
  shipping_in_exporter: "Shipper",
  signatory_company: "Carrier",
  signature: "[Signature]",
  special_instructions: "Standard handling.",
  type_of_shipment: "FCL",
  vessel_aircraft_voyage_no: "Vessel / Voyage",
};

const kinds = ["1 Pallet", "2 Cartons", "1 Crate", "2 Pallets", "3 Cartons", "1 Crate", "2 Pallets", "4 Cartons", "1 Pallet", "2 Crates"];

function itemBlock(i) {
  const k = kinds[(i - 1) % kinds.length];
  const w = 200 + (i * 50) % 800;
  const m = (1 + (i % 10) / 10).toFixed(1);
  return {
    [`marks_and_numbers_${i}`]: `${i}-UP`,
    [`kind_no_of_packages_${i}`]: k,
    [`description_of_goods_${i}`]: `Item ${i}`,
    [`gross_weight_kg_${i}`]: String(w),
    [`measurements_m_${i}`]: m,
    [`measurements_m3_${i}`]: m,
  };
}

function buildItems(n) {
  const obj = {};
  for (let i = 1; i <= n; i++) Object.assign(obj, itemBlock(i));
  return obj;
}

const dir = __dirname;

// 25 items
const f25 = { ...header, consignment_total: "25 Pallets", total_this_page: "25 Pallets", ...buildItems(25) };
fs.writeFileSync(path.join(dir, "Strip1 section 25 items.json"), JSON.stringify(f25, null, 2));

// 75 items
const f75 = { ...header, consignment_total: "75 Pallets", total_this_page: "75 Pallets", ...buildItems(75) };
fs.writeFileSync(path.join(dir, "Strip1 section 75 items.json"), JSON.stringify(f75, null, 2));

function buildContainers(n) {
  const itemsPerCont = Math.min(10, Math.ceil(n / 3));
  const containers = [];
  const flat = {};
  let idx = 1;
  for (let c = 1; idx <= n; c++) {
    const contNum = `CONT-${c}`;
    const contType = c % 3 === 0 ? "20GP" : "40GP";
    const items = [];
    for (let i = 0; i < itemsPerCont && idx <= n; i++) {
      const k = kinds[(idx - 1) % kinds.length];
      const w = 200 + (idx * 50) % 800;
      const m = (1 + (idx % 10) / 10).toFixed(1);
      items.push({
        description: `Item ${idx}`,
        commodity: `Item ${idx}`,
        marks_and_numbers: `${idx}-UP`,
        packages: k.split(" ")[0],
        weight: String(w),
        weight_uom: "KG",
        volume: m,
        volume_uom: "CBM",
        load_sequence: i + 1,
      });
      flat[`marks_and_numbers_${idx}`] = `${contNum}, ${contType} - ${idx}-UP`;
      flat[`kind_no_of_packages_${idx}`] = k;
      flat[`description_of_goods_${idx}`] = `Item ${idx}`;
      flat[`gross_weight_kg_${idx}`] = String(w);
      flat[`measurements_m_${idx}`] = m;
      flat[`measurements_m3_${idx}`] = m;
      idx++;
    }
    containers.push({ container_number: contNum, container_type: contType, items });
  }
  return { containers, flat };
}

const c25 = buildContainers(25);
const h25c = {
  booking_number: "BK-001",
  ...header,
  consignment_total: "25 Pallets",
  total_this_page: "25 Pallets",
  kind_no_of_packages: "25 Pallets",
  export_declaration_number: "EDN-001",
  containers: c25.containers,
  ...c25.flat,
};
fs.writeFileSync(path.join(dir, "Strip1 section 25 items container.json"), JSON.stringify(h25c, null, 2));

const c75 = buildContainers(75);
const h75c = {
  booking_number: "BK-001",
  ...header,
  consignment_total: "75 Pallets",
  total_this_page: "75 Pallets",
  kind_no_of_packages: "75 Pallets",
  export_declaration_number: "EDN-001",
  containers: c75.containers,
  ...c75.flat,
};
fs.writeFileSync(path.join(dir, "Strip1 section 75 items container.json"), JSON.stringify(h75c, null, 2));

console.log("Generated Strip1 section 25/75 items + container JSONs");
