/**
 * Generates *_sample_data.json for exported HTML templates (25 cargo rows each).
 * Run: node generate-all.js
 */
const fs = require('fs');
const path = require('path');
const OUT = __dirname;

function cargoRow(i) {
  const pkgs = ['2 Crates', '3 Cartons', '1 Pallet'][i % 3];
  const desc = ['Electronics', 'Textiles', 'Machinery parts', 'Consumer goods', 'Auto parts'][i % 5];
  const marks = `${i}-UP`;
  const line = `${pkgs} - ${desc} (line ${i})`;
  return {
    marks,
    pkgs,
    desc,
    line,
    kg: String(250 + i * 10),
    m3: (1.0 + (i % 10) * 0.1).toFixed(1),
    po: `PO-2026-${String(i).padStart(4, '0')}`,
  };
}

// --- FCR Hong Kong ---
function jsonFcr() {
  const o = {
    shipper_name: 'Cargo Services Far East Ltd.',
    shipper_address: 'Unit 1201, 12/F, Tower 1, Mega Trade Centre\n1 Watson Road, North Point, Hong Kong',
    job_reference_no: 'FCR-HK-2026-001',
    forwarder_s_cargo_receipt_number: 'FCR-789456-HK',
    date_cargo_received: '20-Mar-2026',
    place_date_issued: 'Hong Kong, 20-Mar-2026',
    reference_no: 'FCR-HK-2026-001',
    export_reference: 'EXP-REF-2026-0042',
    consignee_name: 'Pacific Trading Co. Ltd.',
    consignee_address: '456 Harbor View Road, Singapore 018956',
    forwarder_reference: 'FW-REF-789456',
    notify_party_name: 'Notify Pvt Ltd',
    notify_party_address: 'Sample Address Line 1\nCity',
    also_notify_complete_name_street_address: 'Also Notify Co.\n123 Secondary Street',
    place_of_receipt: 'Hong Kong CFS',
    place_of_delivery: 'Singapore ICD',
    please_apply_to_overseas_party: 'Cargo Services Far East Ltd., Hong Kong\nTel: +852 1234 5678',
    port_of_loading: 'Hong Kong',
    port_of_discharge: 'Singapore',
    ocean_vessel_voyag: 'MAERSK SEALAND / VY-2026-089',
    documents_received_date: '20-Mar-2026',
    container_list: 'HLBU1234567, MSCU4567890, TEMU9876543',
    total_this_page: '25 Pallets',
    consignment_total: '25 Pallets',
    print_time: '20 Mar 2026 12:00',
  };
  for (let d = 1; d <= 9; d++) {
    o[`doc_original_${d}`] = String((d % 3) + 1);
    o[`doc_copy_${d}`] = String((d % 2) + 1);
  }
  for (let i = 1; i <= 25; i++) {
    const r = cargoRow(i);
    o[`marks_nos_${i}`] = r.marks;
    o[`marks_and_numbers_container_seal_numbers_${i}`] = r.marks;
    o[`kind_no_of_packages_${i}`] = r.pkgs;
    o[`description_of_goods_${i}`] = r.desc;
    o[`number_and_description_of_packages_and_goods_${i}`] = r.line;
    o[`gross_weight_kg_${i}`] = r.kg;
    o[`gross_weight_${i}`] = r.kg;
    o[`measurements_m3_${i}`] = r.m3;
    o[`measurement_${i}`] = r.m3;
  }
  for (let c = 1; c <= 3; c++) {
    o[`carrier_s_o_no_${c}`] = `SO-2026-${c}`;
    o[`container_no_${c}`] = ['HLBU1234567', 'MSCU4567890', 'TEMU9876543'][c - 1];
    o[`size_${c}`] = ['40FR', '20GP', '40HC'][c - 1];
    o[`seal_no_${c}`] = `SN-00${c}`;
    o[`movement_${c}`] = 'CY-CY';
    o[`cntr_pkgs_unit_${c}`] = '3';
    o[`cntr_cbm_${c}`] = (2.5 + c * 0.3).toFixed(1);
    o[`cntr_kgs_${c}`] = String(900 + c * 150);
  }
  return o;
}

// --- CSDE BOL (5 columns) ---
function jsonCsde() {
  const o = {
    shipper_name: 'Shipper Name Ltd.',
    shipper_address: '100 Shipper Road\nHong Kong',
    manifest_no: 'MNF-CSDE-2026-001',
    bill_of_lading_number: 'BOL-HK-2026-8899',
    export_reference: 'EXP-CSDE-0042',
    consignee_name: 'Consignee Trading Pte Ltd.',
    consignee_address: '200 Consignee Ave\nSingapore',
    forwarding_agent_references: 'FWD-REF-556677',
    country_of_origin: 'China',
    notify_party_name: 'Notify Party LLC',
    notify_party_address: '300 Notify St\nUSA',
    notify_routing_instructions: 'Route via HK hub; contact desk A.',
    pre_carriage_by: 'TRUCK',
    delivery_of_goods_apply_to: 'Apply: Far East Cargo Line, Hong Kong',
    ocean_vessel_voyage: 'VESSEL STAR / V-101',
    port_of_discharge: 'Singapore',
    port_of_loading: 'Hong Kong',
    place_of_receipt: 'Shenzhen CFS',
    place_of_delivery: 'Singapore warehouse',
    freight_charges_item_no_rate_rate_basis: 'Freight prepaid as per agreement',
    prepaid: 'USD 3,200.00',
    collect: '—',
    excess_value_declaration_refer_to_clause_6_4_b_c_on_reverse_side: 'N/A',
    freight_payable_at: 'Hong Kong',
    total_freight: 'USD 3,200.00',
    number_of_original_bill_of_lading: 'THREE (3)',
    place_and_date_of_issue: 'Hong Kong, 20-Mar-2026',
    laden_on_board_date: '20-Mar-2026',
    signed_as_agent_for_the_carrier: 'Demo Agent / CSFEL',
    field_31: '',
    field_32: '',
  };
  for (let i = 1; i <= 25; i++) {
    const r = cargoRow(i);
    o[`marks_nos_${i}`] = r.marks;
    o[`marks_and_numbers_container_seal_numbers_${i}`] = r.marks;
    o[`pa_purchase_order_number_item_number_${i}`] = r.po;
    o[`number_and_description_of_packages_and_goods_articulars_declared_by_the_merchant_${i}`] = r.line;
    o[`gross_weight_${i}`] = r.kg;
    o[`gross_weight_kg_${i}`] = r.kg;
    o[`measurement_${i}`] = r.m3;
    o[`measurements_m3_${i}`] = r.m3;
  }
  return o;
}

// --- SEA Waybill ---
function jsonSea() {
  const o = {
    shipper_name: 'Sea Waybill Shipper Co.',
    shipper_address: '10 Port Road\nHong Kong',
    manifest_no: 'MNF-SEA-2026-02',
    sea_waybill_no: 'SWB-2026-778899',
    export_reference: 'EXP-SEA-0099',
    consignee_name: 'Consignee Global Pte Ltd.',
    consignee_address: '88 Marina Way\nSingapore',
    carrier_references: 'CARR-REF-12345',
    country_of_origin: 'Vietnam',
    notify_party_name: 'Notify Sea LLC',
    notify_party_address: '5 Harbor Point\nVietnam',
    notify_routing_instructions: 'Tranship HK; email docs to ops@example.com',
    delivery_of_goods_apply_to: 'United Logistics Singapore',
    ocean_vessel_voyage: 'OCEAN PRIDE / V-202',
    port_of_discharge: 'Singapore',
    port_of_loading: 'Haiphong',
    place_of_receipt: 'Haiphong ICD',
    place_of_delivery: 'Singapore PSA',
    first_leg_carriage: 'BARGE',
    below_particulars_of_the_goods_declared_by_the_shipper_and_unknown_to_the_carrier:
      'BELOW PARTICULARS OF THE GOODS DECLARED BY THE SHIPPER AND UNKNOWN TO THE CARRIER',
    freight_charges_item: 'Ocean freight + THC as per tariff',
    prepaid: 'Collect',
    collect: 'USD 1,890.00',
    excess_limit_declaration_as_per_clause_15_2: 'N/A',
    far_east_container_line_received_the_goods_specified_above_in_apparent_good_orde:
      'Received in apparent good order unless otherwise stated.',
    freight_payable_at: 'Destination',
    total_freight: 'USD 1,890.00',
    number_of_original_sea_waybill: 'ONE (1)',
    place_and_date_of_issue: 'Haiphong, 20-Mar-2026',
    laden_on_board_date: '20-Mar-2026',
    field_32: '',
    field_33: '',
  };
  for (let i = 1; i <= 25; i++) {
    const r = cargoRow(i);
    o[`marks_nos_${i}`] = r.marks;
    o[`marks_and_numbers_container_seal_numbers_${i}`] = r.marks;
    o[`purchase_order_number_item_number_${i}`] = r.po;
    o[`number_and_description_of_packages_and_goods_${i}`] = r.line;
    o[`gross_weight_${i}`] = r.kg;
    o[`gross_weight_kg_${i}`] = r.kg;
    o[`measurement_${i}`] = r.m3;
    o[`measurements_m3_${i}`] = r.m3;
  }
  return o;
}

// --- TELEX United (truncated column key bases in template-config) ---
function jsonTelex() {
  const o = {
    shipper_name: 'Telex Shipper Ltd.',
    shipper_address: '1 Telex Tower\nHong Kong',
    manifest_no: 'MNF-TLX-2026-03',
    bill_of_lading_number: 'BOL-UCL-2026-445566',
    export_reference: 'EXP-TLX-0100',
    consignee_name: 'United Container Consignee',
    consignee_address: '9 Container St\nSingapore',
    carrier_references: 'UCL-REF-9988',
    country_of_origin: 'Thailand',
    notify_party_name: 'Notify Thailand Co.',
    notify_party_address: '7 Bangkok Rd\nThailand',
    notify_routing_instructions: 'Feeder to HK; main leg to SG',
    first_leg_carriage_by: 'RAIL',
    delivery_of_goods_apply_to: 'United Container Line agents Singapore',
    ocean_vessel_voyage: 'UCL EXPRESS / V-303',
    port_of_loading: 'Laem Chabang',
    port_of_discharge: 'Singapore',
    place_of_receipt: 'Laem Chabang CY',
    place_of_delivery: 'Jurong',
    freight_charges_item_no_rate_rate_basis: 'As agreed — FOB Laem Chabang',
    prepaid: 'USD 2,100.00',
    collect: '—',
    freight_payable_at: 'Hong Kong',
    total_freight: 'USD 2,100.00',
    number_of_original_bill_of_lading: 'THREE (3)',
    place_and_date_of_issue: 'Hong Kong, 20-Mar-2026',
    laden_on_board_date: '19-Mar-2026',
    field_30: '',
    field_31: '',
  };
  for (let i = 1; i <= 25; i++) {
    const r = cargoRow(i);
    o[`marks_nos_${i}`] = r.marks;
    o[`marks_and_numbers_container_seal_nu_${i}`] = r.marks;
    o[`purchase_order_number_item_number_${i}`] = r.po;
    o[`number_and_description_of_packages_an_${i}`] = r.line;
    o[`gross_weight_${i}`] = r.kg;
    o[`gross_weight_kg_${i}`] = r.kg;
    o[`measurement_${i}`] = r.m3;
    o[`measurements_m3_${i}`] = r.m3;
  }
  return o;
}

function jsonCarrierSi25() {
  const cats = [
    'Electronics', 'Textiles', 'Food & beverage', 'Auto parts', 'Chemicals (non-haz)',
    'Furniture', 'Paper products', 'Hardware', 'Sporting goods', 'Pharma (OTC)',
  ];
  const cargo_line_items = [];
  for (let i = 1; i <= 25; i++) {
    const pkg = String(10 + (i % 15)).padStart(3, '0') + '.00';
    const desc = `${cats[i % cats.length]} – demo line item ${i} for SI / booking`;
    cargo_line_items.push({
      marks_and_numbers: String(37000 + i),
      number_of_packages: pkg,
      packages: pkg,
      cargo_description: desc,
      description: desc,
      commodity: desc,
      weight: String(100 + i * 4).padStart(5, '0') + '.00',
      volume: String(5 + (i % 15)).padStart(2, '0') + '.00',
    });
  }
  return {
    shipper_company_name: 'Demo Shipper – 25 lines',
    reference_number: 'SB-DEMO-26-03-25LINES',
    ocean_bill_number: 'OBL-DEMO-2026032001',
    si_reference_number: 'SB-DEMO-26-03-25LINES',
    carrier_name: 'CMA CGM',
    attn: 'Documentation',
    from: 'Demo Shipper – 25 lines',
    print_time: 'March 20, 2026 at 12:00 PM',
    freight_charges_display: 'As agreed',
    vessel_name: 'DEMO VESSEL',
    voyage: '001W',
    port_of_loading: 'Hong Kong',
    port_of_discharge: 'Singapore',
    place_of_delivery: 'Singapore ICD',
    shipper_name: 'Demo Shipper Ltd.',
    shipper_address: '1 Demo Street\nHong Kong',
    shipper_city: 'Hong Kong',
    shipper_country: 'HK',
    shipper_contact: '+852 0000 0000',
    shipper_tax_identifier: null,
    notify_party_name: 'Demo Notify',
    notify_party_address: '2 Notify Ave',
    notify_party_city: 'Singapore',
    notify_party_country: 'SG',
    consignee_name: 'Demo Consignee Pte Ltd.',
    consignee_address: '3 Consignee Road\nSingapore',
    consignee_city: 'Singapore',
    consignee_country: 'SG',
    consignee_person: 'Imports Dept',
    consignee_contact: '+65 0000 0000',
    notify_name: '',
    notify_address: '',
    notify_city: '',
    notify_country: '',
    containers: [],
    cargo_line_items,
  };
}

const files = [
  ['FCR_hongkong_sample_data.json', jsonFcr],
  ['csde_BOL_sample_data.json', jsonCsde],
  ['SEA_waybill_FCR_sample_data.json', jsonSea],
  ['TELEX_United_container_sample_data.json', jsonTelex],
  ['carrier_si_booking_sample_data_25.json', jsonCarrierSi25],
];

for (const [name, fn] of files) {
  const p = path.join(OUT, name);
  fs.writeFileSync(p, JSON.stringify(fn(), null, 2), 'utf8');
  console.log('Wrote', p);
}
