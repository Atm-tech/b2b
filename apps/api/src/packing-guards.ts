import type { PoolClient } from "pg";
export async function lockPackingCart(db:Pick<PoolClient,'query'>,cartId:string) {
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`packing:${cartId}`]);
}
export async function assertNoPackingHold(db:Pick<PoolClient,'query'>,ids:string[]) {
  const rows=(await db.query('SELECT DISTINCT COALESCE(cart_id,id) AS cart FROM sales_orders WHERE cart_id=ANY($1::text[]) OR id=ANY($1::text[]) ORDER BY cart',[ids])).rows;
  for(const row of rows){
    await lockPackingCart(db,row.cart);
    if((await db.query("SELECT 1 FROM delivery_exceptions WHERE order_id=$1 AND status NOT IN ('Retry Scheduled','Withdrawn','Closed')",[row.cart])).rowCount)throw new Error('This order has an unresolved delivery exception. Follow the seller decision and goods return process before changing it.');
    if((await db.query("SELECT 1 FROM whatsapp_packing_reviews WHERE cart_id=$1 AND status NOT IN ('Finalized','Financial Review')",[row.cart])).rowCount)throw new Error('Packing recheck is unresolved. Complete the recheck, approvals and final confirmation before changing or dispatching this order.');
  }
}
