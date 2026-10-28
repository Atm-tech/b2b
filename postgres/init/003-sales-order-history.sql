
-- Actual persistence times are separate from the operator-selected business date.
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS saved_at TIMESTAMPTZ;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS sales_order_change_history (
  id BIGSERIAL PRIMARY KEY,
  order_id TEXT NOT NULL,
  line_id TEXT NOT NULL,
  action TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  actor TEXT,
  before_data JSONB,
  after_data JSONB
);
CREATE INDEX IF NOT EXISTS sales_order_change_history_order_time
  ON sales_order_change_history(order_id, occurred_at);
CREATE OR REPLACE FUNCTION track_sales_order_change() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND to_jsonb(NEW) = to_jsonb(OLD) THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.saved_at := clock_timestamp();
    NEW.updated_at := NEW.saved_at;
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.saved_at := OLD.saved_at;
    NEW.updated_at := clock_timestamp();
  END IF;
  IF TG_OP = 'DELETE' THEN
    INSERT INTO sales_order_change_history(order_id,line_id,action,actor,before_data)
      VALUES(COALESCE(OLD.cart_id,OLD.id),OLD.id,TG_OP,NULLIF(current_setting('app.actor',true),''),to_jsonb(OLD));
    RETURN OLD;
  END IF;
  INSERT INTO sales_order_change_history(order_id,line_id,action,actor,before_data,after_data)
    VALUES(COALESCE(NEW.cart_id,NEW.id),NEW.id,TG_OP,NULLIF(current_setting('app.actor',true),''),
      CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,to_jsonb(NEW));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE OR REPLACE TRIGGER sales_order_change_tracking
  BEFORE INSERT OR UPDATE OR DELETE ON sales_orders
  FOR EACH ROW EXECUTE FUNCTION track_sales_order_change();
