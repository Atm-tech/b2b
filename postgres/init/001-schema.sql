CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  mobile_number TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL,
  roles_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  warehouse_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
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
  sub_category TEXT NOT NULL DEFAULT '',
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
  is_seasonal BOOLEAN NOT NULL DEFAULT FALSE,
  offer_label TEXT NOT NULL DEFAULT '',
  offer_price DOUBLE PRECISION,
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
  channel_scope TEXT NOT NULL DEFAULT 'All',
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT purchase_orders_total_matches_tax
    CHECK (ABS(total_amount - ROUND((taxable_amount + gst_amount)::numeric, 2)::double precision) <= 0.009)
);

CREATE TABLE IF NOT EXISTS sales_orders (
  id TEXT PRIMARY KEY,
  cart_id TEXT,
  shop_id TEXT NOT NULL,
  billing_type TEXT NOT NULL DEFAULT 'B2C',
  product_sku TEXT NOT NULL,
  salesman_id BIGINT NOT NULL,
  warehouse_id TEXT NOT NULL,
  quantity DOUBLE PRECISION NOT NULL,
  rate DOUBLE PRECISION NOT NULL,
  cd_tod_rate DOUBLE PRECISION NOT NULL DEFAULT 0,
  cd_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  tod_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sales_orders_total_matches_discounts
    CHECK (ABS(total_amount - ROUND(GREATEST(0, taxable_amount + gst_amount - cd_amount - tod_amount)::numeric, 2)::double precision) <= 0.009),
  CONSTRAINT sales_orders_discount_matches_net_rate
    CHECK (
      cd_tod_rate >= 0 AND cd_tod_rate <= rate AND cd_amount >= 0 AND tod_amount >= 0
      AND (
        (cd_amount + tod_amount <= 0.01 AND (cd_tod_rate = 0 OR ABS(cd_tod_rate - rate) <= 0.0001))
        OR ABS((cd_amount + tod_amount) - ((rate - cd_tod_rate) * quantity)) <= 0.021
      )
    )
);

CREATE TABLE IF NOT EXISTS purchase_returns (
  id TEXT PRIMARY KEY,
  return_group_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  linked_order_id TEXT,
  linked_order_line_id TEXT,
  supplier_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  product_sku TEXT NOT NULL,
  quantity DOUBLE PRECISION NOT NULL,
  rate DOUBLE PRECISION NOT NULL,
  reason TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  photo_name TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales_returns (
  id TEXT PRIMARY KEY,
  return_group_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  linked_order_id TEXT,
  linked_order_line_id TEXT,
  shop_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  product_sku TEXT NOT NULL,
  quantity DOUBLE PRECISION NOT NULL,
  rate DOUBLE PRECISION NOT NULL,
  reason TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  photo_name TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS probationary_sales (
  id TEXT PRIMARY KEY,
  sales_order_id TEXT NOT NULL,
  sales_cart_id TEXT,
  shop_id TEXT NOT NULL,
  salesman_id BIGINT NOT NULL,
  warehouse_id TEXT NOT NULL,
  product_sku TEXT NOT NULL,
  available_quantity_at_sale DOUBLE PRECISION NOT NULL,
  sold_quantity DOUBLE PRECISION NOT NULL,
  original_probationary_quantity DOUBLE PRECISION NOT NULL,
  pending_probationary_quantity DOUBLE PRECISION NOT NULL,
  rate DOUBLE PRECISION NOT NULL,
  taxable_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  gst_rate DOUBLE PRECISION NOT NULL DEFAULT 0,
  gst_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  tax_mode TEXT NOT NULL DEFAULT 'Exclusive',
  total_amount DOUBLE PRECISION NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cleared_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  side TEXT NOT NULL,
  linked_order_id TEXT NOT NULL,
  payment_kind TEXT NOT NULL DEFAULT 'Order',
  counterparty_id TEXT,
  counterparty_name TEXT,
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

CREATE TABLE IF NOT EXISTS goods_warrants (
  id TEXT PRIMARY KEY,
  warrant_number TEXT NOT NULL UNIQUE,
  outlet TEXT NOT NULL,
  issued_to TEXT NOT NULL DEFAULT '',
  issuer_name TEXT NOT NULL DEFAULT '',
  amount DOUBLE PRECISION NOT NULL,
  payment_mode TEXT NOT NULL,
  cheque_number TEXT,
  cash_collected_on DATE,
  issue_on DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_through DATE NOT NULL,
  note TEXT NOT NULL DEFAULT '',
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

CREATE TABLE IF NOT EXISTS voice_training_examples (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  command_text TEXT NOT NULL,
  recognized_text TEXT NOT NULL DEFAULT '',
  training_module TEXT NOT NULL DEFAULT 'Sales',
  action_type TEXT NOT NULL,
  action_guide TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'hinglish',
  audio_file_name TEXT,
  audio_mime_type TEXT,
  audio_data BYTEA,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- WhatsApp wholesale channel. Retailer-facing state is deliberately kept
-- outside the operational snapshot so no internal ERP data is exposed.
CREATE TABLE IF NOT EXISTS whatsapp_retailers (
  counterparty_id TEXT PRIMARY KEY,
  phone_e164 TEXT NOT NULL UNIQUE,
  salesman_id BIGINT NOT NULL,
  default_warehouse_id TEXT NOT NULL,
  billing_type TEXT NOT NULL DEFAULT 'B2B',
  payment_mode TEXT NOT NULL DEFAULT 'NEFT',
  cash_timing TEXT,
  delivery_mode TEXT NOT NULL DEFAULT 'Delivery',
  opted_in_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS whatsapp_price_rules (
  id TEXT PRIMARY KEY,
  counterparty_id TEXT NOT NULL,
  product_sku TEXT NOT NULL,
  special_rate DOUBLE PRECISION NOT NULL,
  cd_percent DOUBLE PRECISION NOT NULL DEFAULT 0,
  tod_percent DOUBLE PRECISION NOT NULL DEFAULT 0,
  minimum_quantity DOUBLE PRECISION NOT NULL DEFAULT 1,
  valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_until TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS whatsapp_offers (
  id TEXT PRIMARY KEY,
  counterparty_id TEXT NOT NULL,
  salesman_id BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Draft',
  expires_at TIMESTAMPTZ NOT NULL,
  outbound_message_id TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS whatsapp_offer_lines (
  id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL,
  product_sku TEXT NOT NULL,
  quantity DOUBLE PRECISION NOT NULL,
  rate DOUBLE PRECISION NOT NULL,
  cd_percent DOUBLE PRECISION NOT NULL DEFAULT 0,
  tod_percent DOUBLE PRECISION NOT NULL DEFAULT 0,
  minimum_quantity DOUBLE PRECISION NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS whatsapp_order_drafts (
  id TEXT PRIMARY KEY,
  counterparty_id TEXT NOT NULL,
  phone_e164 TEXT NOT NULL,
  salesman_id BIGINT NOT NULL,
  warehouse_id TEXT NOT NULL,
  source TEXT NOT NULL,
  source_message_id TEXT,
  source_offer_id TEXT,
  status TEXT NOT NULL DEFAULT 'Needs Review',
  billing_type TEXT NOT NULL DEFAULT 'B2B',
  payment_mode TEXT NOT NULL DEFAULT 'NEFT',
  cash_timing TEXT,
  delivery_mode TEXT NOT NULL DEFAULT 'Delivery',
  note TEXT NOT NULL DEFAULT '',
  confirmation_message_id TEXT,
  sales_cart_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  retailer_confirmed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS whatsapp_order_draft_lines (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL,
  product_sku TEXT NOT NULL,
  requested_quantity DOUBLE PRECISION NOT NULL,
  approved_quantity DOUBLE PRECISION NOT NULL,
  rate DOUBLE PRECISION NOT NULL,
  cd_percent DOUBLE PRECISION NOT NULL DEFAULT 0,
  tod_percent DOUBLE PRECISION NOT NULL DEFAULT 0,
  gst_rate DOUBLE PRECISION NOT NULL DEFAULT 0,
  tax_mode TEXT NOT NULL DEFAULT 'Exclusive',
  stock_at_review DOUBLE PRECISION,
  note TEXT NOT NULL DEFAULT ''
);

-- Retailer-side conversation cart. This remains separate from the review queue
-- until the retailer explicitly finalizes it.
CREATE TABLE IF NOT EXISTS whatsapp_cart_sessions (
  phone_e164 TEXT PRIMARY KEY,
  counterparty_id TEXT NOT NULL,
  selected_product_sku TEXT,
  stage TEXT NOT NULL DEFAULT 'Browsing',
  last_inbound_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS whatsapp_cart_lines (
  phone_e164 TEXT NOT NULL,
  product_sku TEXT NOT NULL,
  quantity DOUBLE PRECISION NOT NULL,
  rate DOUBLE PRECISION NOT NULL,
  cd_percent DOUBLE PRECISION NOT NULL DEFAULT 0,
  tod_percent DOUBLE PRECISION NOT NULL DEFAULT 0,
  gst_rate DOUBLE PRECISION NOT NULL DEFAULT 0,
  tax_mode TEXT NOT NULL DEFAULT 'Exclusive',
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (phone_e164, product_sku)
);

CREATE TABLE IF NOT EXISTS whatsapp_wishlist_requests (
  id TEXT PRIMARY KEY,
  counterparty_id TEXT NOT NULL,
  phone_e164 TEXT NOT NULL,
  salesman_id BIGINT NOT NULL,
  requested_product TEXT NOT NULL,
  requested_quantity DOUBLE PRECISION NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending',
  source_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id TEXT PRIMARY KEY,
  wa_message_id TEXT UNIQUE,
  direction TEXT NOT NULL,
  phone_e164 TEXT NOT NULL,
  message_type TEXT NOT NULL,
  context_message_id TEXT,
  related_entity_type TEXT,
  related_entity_id TEXT,
  status TEXT NOT NULL DEFAULT 'Received',
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
