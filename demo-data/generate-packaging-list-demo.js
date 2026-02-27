#!/usr/bin/env node
/**
 * Generates packaging-list-25-items.json and packaging-list-75-items.json
 * Run from repo root: node demo-data/generate-packaging-list-demo.js
 */
const fs = require('fs');
const path = require('path');

const baseFields = {
  additional_info: "Fragile – handle with care. Stack no more than 3 high.",
  bill_of_lading_number: "BOL-PL-2024-8842",
  buyer_if_not_consignee: "",
  buyer_reference: "BR-PL-8842-2024",
  consignee: "XYZ Trading Co., 123 Harbor Way, Rotterdam, Netherlands",
  consignment_total: "", // filled per file
  country_of_final_destination: "Netherlands",
  country_of_origin_of_goods: "United States",
  date_of_departure: "15 March 2024",
  export_invoice_number_date: "INV-2024-001 / 14 March 2024",
  final_destination: "Rotterdam, Netherlands",
  method_of_dispatch: "Sea Freight",
  name_of_authorized_signatory: "J. Smith",
  packin_exporter: "ABC Logistics Inc.",
  packing_information: "", // filled per file
  pages: "1 of 1",
  port_of_discharge: "Rotterdam, Netherlands",
  port_of_loading: "Los Angeles, USA",
  reference: "REF-PL-2024-8842",
  signatory_company: "ABC Logistics Inc.",
  signature: "[Authorized Signature]",
  total_this_page: "", // filled per file
  type_of_shipment: "FCL",
  vessel_aircraft: "M/V PACIFIC STAR",
  voyage_no: "VY-2847",
};

const products = [
  { code: "PC-1001", desc: "Electronics – Consumer Goods", uom: "PCS", net: 480, gross: 520, cbm: "2.1" },
  { code: "PC-1002", desc: "Machinery Parts", uom: "PCS", net: 620, gross: 650, cbm: "1.8" },
  { code: "PC-1003", desc: "Sample Goods", uom: "PCS", net: 165, gross: 180, cbm: "0.9" },
  { code: "PC-1004", desc: "Textiles – Cotton Fabric", uom: "MTR", net: 320, gross: 350, cbm: "1.2" },
  { code: "PC-1005", desc: "Hardware – Fasteners", uom: "CTN", net: 85, gross: 95, cbm: "0.4" },
  { code: "PC-1006", desc: "Plastic Components", uom: "PCS", net: 210, gross: 230, cbm: "0.7" },
  { code: "PC-1007", desc: "Packaged Food – Canned", uom: "CTN", net: 440, gross: 470, cbm: "1.5" },
  { code: "PC-1008", desc: "Office Supplies", uom: "CTN", net: 28, gross: 32, cbm: "0.2" },
  { code: "PC-1009", desc: "Automotive Parts", uom: "PCS", net: 380, gross: 410, cbm: "1.1" },
  { code: "PC-1010", desc: "Pharmaceuticals – Boxed", uom: "CTN", net: 95, gross: 105, cbm: "0.35" },
];

function rowFields(i) {
  const p = products[(i - 1) % products.length];
  const pallets = Math.floor((i - 1) / 5) + 1;
  return {
    [`product_code_${i}`]: p.code + (i > 10 ? `-${i}` : ""),
    [`description_of_goods_${i}`]: p.desc,
    [`unit_quantity_${i}`]: String(50 + (i % 20) * 10),
    [`kind_no_of_packages_${i}`]: i % 3 === 0 ? "2 Cartons" : i % 2 === 0 ? "1 Crate" : "1 Pallet",
    [`net_weight_kg_${i}`]: String(p.net + (i % 5) * 10),
    [`gross_weight_kg_${i}`]: String(p.gross + (i % 5) * 10),
    [`measurement_m_${i}`]: p.cbm,
    [`measurements_m3_${i}`]: p.cbm,
  };
}

function build(count) {
  const obj = { ...baseFields };
  obj.consignment_total = String(count);
  obj.packing_information = `${count} items, export packed`;
  obj.total_this_page = String(count);
  for (let i = 1; i <= count; i++) Object.assign(obj, rowFields(i));
  return JSON.stringify(obj, null, 2);
}

const dir = path.join(__dirname);
fs.writeFileSync(path.join(dir, "packaging-list-25-items.json"), build(25), "utf8");
fs.writeFileSync(path.join(dir, "packaging-list-75-items.json"), build(75), "utf8");
console.log("Created packaging-list-25-items.json and packaging-list-75-items.json");
