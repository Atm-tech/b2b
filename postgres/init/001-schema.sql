CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  mobile_number TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL,
  roles_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  password TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS warehouses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  sku TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  division TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  section_name TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,
  unit TEXT NOT NULL,
  default_weight_kg DOUBLE PRECISION NOT NULL,
  tolerance_kg DOUBLE PRECISION NOT NULL,
  tolerance_percent DOUBLE PRECISION NOT NULL,
  allowed_warehouse_ids_json JSONB NOT NULL,
  slabs_json JSONB NOT NULL,
  remarks TEXT NOT NULL DEFAULT '',
  category_6 TEXT NOT NULL DEFAULT '',
  site_name TEXT NOT NULL DEFAULT '',
  barcode TEXT NOT NULL DEFAULT '',
  supplier_name TEXT NOT NULL DEFAULT '',
  hsn_code TEXT NOT NULL DEFAULT '',
  article_name TEXT NOT NULL DEFAULT '',
  item_name TEXT NOT NULL DEFAULT '',
  brand TEXT NOT NULL DEFAULT '',
  short_name TEXT NOT NULL DEFAULT '',
  size TEXT NOT NULL DEFAULT '',
  rsp DOUBLE PRECISION,
  mrp DOUBLE PRECISION,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS counterparties (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  gst_number TEXT NOT NULL DEFAULT '',
  bank_name TEXT NOT NULL DEFAULT '',
  bank_account_number TEXT NOT NULL DEFAULT '',
  ifsc_code TEXT NOT NULL DEFAULT '',
  mobile_number TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  delivery_address TEXT NOT NULL DEFAULT '',
  delivery_city TEXT NOT NULL DEFAULT '',
  contact_person TEXT NOT NULL DEFAULT '',
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  location_label TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY,
  cart_id TEXT,
  supplier_id TEXT NOT NULL,
  product_sku TEXT NOT NULL,
  purchaser_id BIGINT NOT NULL,
  warehouse_id TEXT NOT NULL,
  quantity_ordered DOUBLE PRECISION NOT NULL,
  quantity_received DOUBLE PRECISION NOT NULL DEFAULT 0,
  rate DOUBLE PRECISION NOT NULL,
  taxable_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  gst_rate DOUBLE PRECISION NOT NULL DEFAULT 0,
  gst_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  tax_mode TEXT NOT NULL DEFAULT 'Exclusive',
  total_amount DOUBLE PRECISION NOT NULL,
  expected_weight_kg DOUBLE PRECISION NOT NULL,
  delivery_mode TEXT NOT NULL,
  payment_mode TEXT NOT NULL,
  cash_timing TEXT,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales_orders (
  id TEXT PRIMARY KEY,
  cart_id TEXT,
  shop_id TEXT NOT NULL,
  product_sku TEXT NOT NULL,
  salesman_id BIGINT NOT NULL,
  warehouse_id TEXT NOT NULL,
  quantity DOUBLE PRECISION NOT NULL,
  rate DOUBLE PRECISION NOT NULL,
  taxable_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  gst_rate DOUBLE PRECISION NOT NULL DEFAULT 0,
  gst_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  tax_mode TEXT NOT NULL DEFAULT 'Exclusive',
  total_amount DOUBLE PRECISION NOT NULL,
  payment_mode TEXT NOT NULL,
  cash_timing TEXT,
  delivery_mode TEXT NOT NULL,
  delivery_charge DOUBLE PRECISION NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  side TEXT NOT NULL,
  linked_order_id TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  mode TEXT NOT NULL,
  cash_timing TEXT,
  reference_number TEXT NOT NULL DEFAULT '',
  voucher_number TEXT,
  utr_number TEXT,
  proof_name TEXT,
  verification_status TEXT NOT NULL,
  verification_note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  verified_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS receipt_checks (
  grc_number TEXT PRIMARY KEY,
  purchase_order_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  receiver_id BIGINT NOT NULL,
  ordered_quantity DOUBLE PRECISION NOT NULL,
  received_quantity DOUBLE PRECISION NOT NULL,
  pending_quantity DOUBLE PRECISION NOT NULL,
  actual_weight_kg DOUBLE PRECISION NOT NULL,
  container_weight_kg DOUBLE PRECISION NOT NULL DEFAULT 0,
  net_weight_kg DOUBLE PRECISION NOT NULL DEFAULT 0,
  weighing_proof_name TEXT,
  expected_weight_kg DOUBLE PRECISION NOT NULL,
  weight_variance_kg DOUBLE PRECISION NOT NULL,
  partial_receipt BOOLEAN NOT NULL,
  flagged BOOLEAN NOT NULL,
  notes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory_lots (
  lot_id TEXT PRIMARY KEY,
  source_order_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  product_sku TEXT NOT NULL,
  quantity_available DOUBLE PRECISION NOT NULL,
  quantity_reserved DOUBLE PRECISION NOT NULL,
  quantity_blocked DOUBLE PRECISION NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id TEXT PRIMARY KEY,
  side TEXT NOT NULL,
  linked_order_id TEXT NOT NULL,
  party_name TEXT NOT NULL,
  goods_value DOUBLE PRECISION NOT NULL,
  paid_amount DOUBLE PRECISION NOT NULL,
  pending_amount DOUBLE PRECISION NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS delivery_tasks (
  id TEXT PRIMARY KEY,
  side TEXT NOT NULL,
  linked_order_id TEXT NOT NULL,
  linked_order_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  mode TEXT NOT NULL,
  source_location TEXT NOT NULL,
  destination_location TEXT NOT NULL,
  assigned_to TEXT NOT NULL,
  pickup_at TIMESTAMPTZ,
  drop_at TIMESTAMPTZ,
  route_hint TEXT,
  payment_action TEXT NOT NULL DEFAULT 'None',
  cash_collection_required BOOLEAN NOT NULL DEFAULT FALSE,
  cash_handover_marked BOOLEAN NOT NULL DEFAULT FALSE,
  weight_proof_name TEXT,
  cash_proof_name TEXT,
  last_action_at TIMESTAMPTZ,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS delivery_dockets (
  id TEXT PRIMARY KEY,
  sales_order_id TEXT NOT NULL,
  shop_id TEXT NOT NULL,
  product_sku TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  quantity DOUBLE PRECISION NOT NULL,
  weight_kg DOUBLE PRECISION NOT NULL DEFAULT 0,
  container_weight_kg DOUBLE PRECISION NOT NULL DEFAULT 0,
  weighing_proof_name TEXT,
  consignment_id TEXT,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS delivery_consignments (
  id TEXT PRIMARY KEY,
  docket_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  warehouse_id TEXT NOT NULL,
  assigned_to TEXT NOT NULL DEFAULT '',
  total_weight_kg DOUBLE PRECISION NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS note_records (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  note TEXT NOT NULL,
  created_by TEXT NOT NULL,
  visibility TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
