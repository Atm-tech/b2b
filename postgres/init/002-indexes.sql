CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_created_at ON purchase_orders(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sales_orders_shop ON sales_orders(shop_id);
CREATE INDEX IF NOT EXISTS idx_sales_orders_status ON sales_orders(status);
CREATE INDEX IF NOT EXISTS idx_sales_orders_created_at ON sales_orders(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(linked_order_id, side);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(verification_status);
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_receipt_checks_order ON receipt_checks(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_receipt_checks_warehouse ON receipt_checks(warehouse_id);

CREATE INDEX IF NOT EXISTS idx_inventory_lots_lookup ON inventory_lots(warehouse_id, product_sku, status);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_lookup ON ledger_entries(linked_order_id, side);

CREATE INDEX IF NOT EXISTS idx_delivery_tasks_status ON delivery_tasks(status);
CREATE INDEX IF NOT EXISTS idx_delivery_tasks_assigned_to ON delivery_tasks(assigned_to);
CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_dockets_sales_order_unique ON delivery_dockets(sales_order_id);

CREATE INDEX IF NOT EXISTS idx_notes_entity ON note_records(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
