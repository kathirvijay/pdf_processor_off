#!/usr/bin/env node
/**
 * Generate Carrier S/I demo data JSON files.
 * Keys match carrier_si.html template: shipper, consignee, place_of_recipt, loading_port, discharge_port, voyage_no;
 * Cargo table: marks_nos, kind_no_of_packages, description_of_goods, gross_weight_kg, measurements_m3;
 * Container table: carrier_s_o_no, container_no, size, seal_no, movement, cntr_pkgs_unit, cntr_cbm, cntr_kgs.
 * Run: node generate-carrier-si-demo.js
 */

const fs = require('fs');
const path = require('path');

const BASE_HEADER = {
  shipper: "ABC Logistics Ltd\n123 Industrial Park, Manchester M1 2AB, UK",
  reference_no: "REF-SI-2024-001",
  si_ref_no: "SI-REF-001",
  contract_no: "CT-2024-5678",
  consignee: "Global Imports Inc\n456 Harbor Drive, Rotterdam, Netherlands",
  notify_party: "Same as Consignee",
  place_of_delivery: "Rotterdam",
  place_of_recipt: "Manchester",
  subject: "FCL Shipment",
  service_type: "FCL",
  print_time: "09 Mar 2024 14:32",
  loading_port: "Felixstowe",
  discharge_port: "Rotterdam",
  payable_at: "Port of Loading",
  payable_by: "Shipper",
  vessel_name: "MSC OSCAR",
  voyage_no: "VY-123A",
  ocean_freight: "Prepaid",
  pre_carriage: "BY TRUCK",
  signatory_company: "ABC Logistics Ltd",
  signature: "[Signature]",
  name_of_authorized_signatory: "John Smith",
  pages: "1 of 1",
};

const PKG_TYPES = ["Pallet", "Crate", "Carton"];
const DESCRIPTIONS = [
  "Electronics - LCD Monitors", "Electronics - Circuit Boards", "Electronics - Cables",
  "Machinery parts", "Steel components", "Textiles", "Auto parts",
  "Consumer goods", "Industrial equipment", "Medical supplies",
  "Furniture components", "Plastic products", "Paper products",
  "Chemicals (non-haz)", "Food ingredients", "Beverages",
  "Sports equipment", "Office supplies", "Hardware", "Tools",
  "Packaging materials", "Raw materials", "Finished goods",
  "Spare parts", "Samples",
];

function buildItem(n) {
  const pkgType = PKG_TYPES[n % PKG_TYPES.length];
  const qty = (n % 3) + 1;
  const m3 = (1 + (n % 10) * 0.1).toFixed(1);
  return {
    [`marks_nos_${n}`]: `${n}-UP`,
    [`kind_no_of_packages_${n}`]: `${qty} ${qty > 1 ? (pkgType === "Carton" ? "Cartons" : pkgType + "s") : pkgType}`,
    [`description_of_goods_${n}`]: DESCRIPTIONS[n % DESCRIPTIONS.length],
    [`gross_weight_kg_${n}`]: String(250 + (n % 20) * 25),
    [`measurements_m3_${n}`]: m3,
  };
}

function buildContainer(n, itemCount, containerCount) {
  const pkgsInThis = n <= Math.ceil(itemCount / containerCount) ? 3 : 0;
  return {
    [`carrier_s_o_no_${n}`]: "SO-2024-001",
    [`container_no_${n}`]: `MSCU12345${String(n).padStart(2, "0")}`,
    [`size_${n}`]: n % 2 === 0 ? "40HC" : "20GP",
    [`seal_no_${n}`]: `SN-${String(n).padStart(3, "0")}`,
    [`movement_${n}`]: "CY-CY",
    [`cntr_pkgs_unit_${n}`]: String(pkgsInThis),
    [`cntr_cbm_${n}`]: (2.5 + n * 0.3).toFixed(1),
    [`cntr_kgs_${n}`]: String(800 + n * 150),
  };
}

function generate(itemCount) {
  const data = { ...BASE_HEADER };
  data.total_this_page = `${itemCount} Pallets`;
  data.consignment_total = `${itemCount} Pallets`;
  const containerCount = Math.max(2, Math.ceil(itemCount / 10));
  data.container_list = Array.from({ length: containerCount }, (_, i) => `CONT-${String(i + 1).padStart(3, "0")}`).join(", ");

  for (let i = 1; i <= itemCount; i++) {
    Object.assign(data, buildItem(i));
  }

  for (let i = 1; i <= containerCount; i++) {
    Object.assign(data, buildContainer(i, itemCount, containerCount));
  }

  return data;
}

const dir = __dirname;
fs.writeFileSync(path.join(dir, "carrier-si-25-items.json"), JSON.stringify(generate(25), null, 2));
fs.writeFileSync(path.join(dir, "carrier-si-default.json"), JSON.stringify(generate(8), null, 2));
fs.writeFileSync(path.join(dir, "carrier-si-45-items.json"), JSON.stringify(generate(45), null, 2));
console.log("Generated: carrier-si-25-items.json, carrier-si-default.json, carrier-si-45-items.json");
