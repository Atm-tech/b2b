CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_created_at ON purchase_orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_cart ON purchase_orders(cart_id) WHERE cart_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_orders_warehouse ON purchase_orders(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_product ON purchase_orders(product_sku);
CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand);
CREATE INDEX IF NOT EXISTS idx_products_sub_category ON products(sub_category);
CREATE INDEX IF NOT EXISTS idx_products_seasonal_offer ON products(is_seasonal, offer_price) WHERE is_seasonal OR offer_price IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier_product_created ON purchase_orders(supplier_id, product_sku, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sales_orders_shop ON sales_orders(shop_id);
CREATE INDEX IF NOT EXISTS idx_sales_orders_status ON sales_orders(status);
CREATE INDEX IF NOT EXISTS idx_sales_orders_created_at ON sales_orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_orders_cart ON sales_orders(cart_id) WHERE cart_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_orders_warehouse ON sales_orders(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_sales_orders_product ON sales_orders(product_sku);
CREATE INDEX IF NOT EXISTS idx_sales_orders_shop_product_created ON sales_orders(shop_id, product_sku, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(linked_order_id, side);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(verification_status);
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_receipt_checks_order ON receipt_checks(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_receipt_checks_warehouse ON receipt_checks(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_receipt_checks_created_at ON receipt_checks(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_lots_lookup ON inventory_lots(warehouse_id, product_sku, status);
CREATE INDEX IF NOT EXISTS idx_inventory_lots_fifo ON inventory_lots(warehouse_id, product_sku, created_at);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_lookup ON ledger_entries(linked_order_id, side);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_created_at ON ledger_entries(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_delivery_tasks_status ON delivery_tasks(status);
CREATE INDEX IF NOT EXISTS idx_delivery_tasks_assigned_to ON delivery_tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_delivery_tasks_side ON delivery_tasks(side);
CREATE INDEX IF NOT EXISTS idx_delivery_tasks_created_at ON delivery_tasks(created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_dockets_sales_order_unique ON delivery_dockets(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_delivery_dockets_warehouse_status ON delivery_dockets(warehouse_id, status);
CREATE INDEX IF NOT EXISTS idx_delivery_dockets_consignment ON delivery_dockets(consignment_id) WHERE consignment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_delivery_dockets_created_at ON delivery_dockets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_consignments_warehouse_status ON delivery_consignments(warehouse_id, status);
CREATE INDEX IF NOT EXISTS idx_delivery_consignments_created_at ON delivery_consignments(created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_goods_warrants_number_unique ON goods_warrants(warrant_number);
CREATE INDEX IF NOT EXISTS idx_goods_warrants_created_at ON goods_warrants(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_goods_warrants_outlet ON goods_warrants(outlet);

CREATE INDEX IF NOT EXISTS idx_notes_entity ON note_records(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_created_at ON note_records(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_voice_training_active_created ON voice_training_examples(active, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_voice_training_action ON voice_training_examples(action_type);
CREATE INDEX IF NOT EXISTS idx_voice_training_module ON voice_training_examples(training_module, active, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_counterparties_type_name ON counterparties(type, name);
CREATE INDEX IF NOT EXISTS idx_counterparties_created_at ON counterparties(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_warehouse_created ON purchase_returns(warehouse_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_returns_warehouse_created ON sales_returns(warehouse_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_probationary_sales_inventory ON probationary_sales(warehouse_id, product_sku, created_at);
CREATE INDEX IF NOT EXISTS idx_probationary_sales_created_at ON probationary_sales(created_at DESC);
