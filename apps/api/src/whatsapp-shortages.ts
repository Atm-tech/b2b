import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { calculateSalesAmounts, calculateTaxAmounts } from "@aapoorti-b2b/domain";

type Db = Pick<PoolClient, "query">;
type Actor = { id: number; username: string; fullName: string; role: string; roles: string[] };
type Dependencies = { transaction: <T>(run: (db: Db) => Promise<T>) => Promise<T>; query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }> };
export type ShortageChoice = "Split" | "Wait" | "Cancel Balance";
const key = (prefix: string) => `${prefix}-${randomUUID()}`;
export function splitDemand(requested: number, available: number) {
  if (!Number.isFinite(requested) || requested <= 0 || !Number.isFinite(available)) throw new Error("Invalid shortage quantity.");
  const ready = Math.min(requested, Math.max(0, available));
  return { requested, available: ready, pending: requested - ready };
}
export function validatePurchaseApproval(input: { supplierId: string; expectedAt: string; lines: Array<{ productSku: string; rate: number; gstRate: number }> }) {
  if (!input.supplierId || !Number.isFinite(Date.parse(input.expectedAt)) || Date.parse(input.expectedAt) <= Date.now()) throw new Error("Select a supplier and a future expected arrival date.");
  if (!input.lines.length || new Set(input.lines.map(l => l.productSku)).size !== input.lines.length || input.lines.some(l => !Number.isFinite(l.rate) || l.rate <= 0 || ![0,5,12,18,28,40].includes(l.gstRate))) throw new Error("Enter valid purchase rates and GST rates for every shortage item.");
}
export function createShortageService(deps: Dependencies) {
  async function event(db: Db, caseId: string, action: string, actor: string, note = "") {
    await db.query("INSERT INTO whatsapp_shortage_events(case_id,action,actor,note) VALUES($1,$2,$3,$4)", [caseId,action,actor,note]);
  }
  async function enqueue(db: Db, caseId: string, kind: string, payload: Record<string, unknown> = {}, token = kind) {
    await db.query("INSERT INTO whatsapp_shortage_notifications(id,case_id,kind,payload_json) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(id) DO NOTHING", [`${caseId}:${token}`,caseId,kind,JSON.stringify(payload)]);
  }
  async function load(db: Db, id: string) {
    const row = (await db.query("SELECT * FROM whatsapp_shortage_cases WHERE id=$1 FOR UPDATE", [id])).rows[0];
    if (!row) throw new Error("Shortage case not found.");
    return row;
  }
  const roles = (a: Actor) => [a.role,...a.roles];
  function salesAccess(row: any, actor: Actor, admin: boolean) {
    if (!admin && !(roles(actor).includes("Sales") && Number(row.salesman_id) === actor.id)) throw new Error("This shortage case belongs to another salesperson.");
  }
  async function stock(db: Db, warehouse: string, sku: string) {
    return Number((await db.query("SELECT GREATEST(0, (SELECT COALESCE(SUM(quantity_available),0) FROM inventory_lots WHERE warehouse_id=$1 AND product_sku=$2) - (SELECT COALESCE(SUM(quantity),0) FROM sales_orders WHERE warehouse_id=$1 AND product_sku=$2 AND status IN ('Booked','Ready for Dispatch','Pending Pickup','Self Pickup') AND note LIKE 'WhatsApp confirmed order WAD-%')) AS qty", [warehouse,sku])).rows[0].qty);
  }
  async function detect(draftId: string) {
    return deps.transaction(async db => {
      const draft = (await db.query("SELECT * FROM whatsapp_order_drafts WHERE id=$1 FOR UPDATE", [draftId])).rows[0];
      if (!draft || ["Completed","Denied","Processing"].includes(draft.status)) return null;
      const existing = (await db.query("SELECT id FROM whatsapp_shortage_cases WHERE draft_id=$1 OR balance_draft_id=$1",[draftId])).rows[0];
      if (existing) return existing.id as string;
      const lines = (await db.query("SELECT * FROM whatsapp_order_draft_lines WHERE draft_id=$1 ORDER BY id",[draftId])).rows;
      const planned = [];
      for (const line of lines) { const physical = await stock(db,draft.warehouse_id,line.product_sku); planned.push({line,procure:Math.max(0,Number(line.requested_quantity)-physical),...splitDemand(Number(line.requested_quantity),Math.min(Number(line.approved_quantity),physical))}); }
      if (!planned.some(l=>l.pending>0)) return null;
      const caseId=key("WSC");
      await db.query("INSERT INTO whatsapp_shortage_cases(id,draft_id,counterparty_id,salesman_id,warehouse_id,next_action_at) VALUES($1,$2,$3,$4,$5,NOW())",[caseId,draftId,draft.counterparty_id,draft.salesman_id,draft.warehouse_id]);
      for (const l of planned) {
        await db.query("INSERT INTO whatsapp_shortage_lines(case_id,draft_line_id,product_sku,requested_quantity,available_quantity,pending_quantity,procurement_quantity) VALUES($1,$2,$3,$4,$5,$6,$7)",[caseId,l.line.id,l.line.product_sku,l.requested,l.available,l.pending,l.procure]);
        await db.query("UPDATE whatsapp_order_draft_lines SET approved_quantity=$2,stock_at_review=$2 WHERE id=$1",[l.line.id,l.available]);
      }
      await db.query("UPDATE whatsapp_order_drafts SET status='Shortage Pending',confirmation_message_id=NULL WHERE id=$1",[draftId]);
      await event(db,caseId,"Shortage detected","System","A draft purchase order was created for the pending quantities.");
      await enqueue(db,caseId,"RetailerChoice");
      if(planned.some(l=>l.procure>0))await enqueue(db,caseId,"PurchaserAlert");
      else await db.query("UPDATE whatsapp_shortage_cases SET purchase_status='Not Required' WHERE id=$1",[caseId]);
      if(planned.some(l=>l.available>0))await enqueue(db,caseId,"AvailableConfirmation",{draftId});
      return caseId;
    });
  }
  async function choose(id: string, choice: ShortageChoice, actor: Actor | { counterpartyId: string }, admin=false, note="") {
    if (!["Split","Wait","Cancel Balance"].includes(choice)) throw new Error("Invalid retailer choice.");
    return deps.transaction(async db=>{
      const row=await load(db,id);
      if ("counterpartyId" in actor) { if(row.counterparty_id!==actor.counterpartyId)throw new Error("This order belongs to another retailer."); }
      else salesAccess(row,actor,admin);
      if(row.closed_at)throw new Error("This shortage case is closed.");
      const root=(await db.query("SELECT status FROM whatsapp_order_drafts WHERE id=$1 FOR UPDATE",[row.draft_id])).rows[0];
      if (row.retailer_choice===choice && "counterpartyId" in actor) return;
      if(row.balance_draft_id)throw new Error("Balance confirmation has already been prepared. Contact Sales to revise it.");
      if(choice==="Wait" && ["Completed","Processing"].includes(root.status))throw new Error("The available portion is already confirmed; only the remaining quantity can be changed.");
      if(row.retailer_choice==="Cancel Balance")throw new Error("The balance is already cancelled. Place a new order for additional quantities.");
      if(!("counterpartyId" in actor) && !note.trim())throw new Error("Record the retailer agreement before updating the choice.");
      if (!("counterpartyId" in actor) && row.purchase_status==="Cancelled" && choice!=="Cancel Balance") await db.query("UPDATE whatsapp_shortage_cases SET sales_resolution='Keep Pending' WHERE id=$1",[id]);
      if(choice==="Cancel Balance"){
        await db.query("UPDATE whatsapp_shortage_lines SET cancelled_quantity=pending_quantity,pending_quantity=0,procurement_quantity=0 WHERE case_id=$1",[id]);
        await db.query("UPDATE whatsapp_shortage_cases SET purchase_status=CASE WHEN purchase_status='Draft' THEN 'Cancelled' ELSE purchase_status END WHERE id=$1",[id]);
      }
      await db.query("UPDATE whatsapp_shortage_cases SET retailer_choice=$2,status=$3,updated_at=NOW(),next_action_at=NOW() WHERE id=$1",[id,choice,choice==="Wait"?"Awaiting Stock":root.status==="Completed"?(choice==="Cancel Balance"?"Fulfilment Pending":row.purchase_status==="Cancelled"?("counterpartyId" in actor?"Sales Action Required":"Awaiting Stock"):"Balance Pending"):"Available Confirmation Pending"]);
      if(!["Completed","Processing"].includes(root.status))await db.query("UPDATE whatsapp_order_drafts SET status=$2,confirmation_message_id=NULL WHERE id=$1",[row.draft_id,choice==="Wait"?"Awaiting Stock":"Shortage Pending"]);
      if(choice==='Cancel Balance' && !(await db.query("SELECT product_sku FROM whatsapp_shortage_lines WHERE case_id=$1 AND available_quantity>0",[id])).rowCount){
        await db.query("UPDATE whatsapp_order_drafts SET status='Denied',confirmation_message_id=NULL WHERE id=$1",[row.draft_id]);
        await db.query("UPDATE whatsapp_shortage_cases SET status='Cancelled',closed_at=NOW() WHERE id=$1",[id]);
      }
      await event(db,id,"Retailer choice", "counterpartyId" in actor?"Retailer":actor.fullName,`${choice}${note?`: ${note}`:""}`);
      await enqueue(db,id,"ChoiceRecorded",{choice},`choice:${key("event")}`);
      if(choice!=="Wait" && !["Completed","Processing"].includes(root.status)) await enqueue(db,id,"AvailableConfirmation",{draftId:row.draft_id},`available:${key("event")}`);
    });
  }
  async function purchase(id:string, input:{decision:"Approve"|"Cancel";supplierId:string;expectedAt:string;note:string;lines:Array<{productSku:string;rate:number;gstRate:number}>},actor:Actor,admin=false){
    if(!admin && !roles(actor).includes("Purchaser"))throw new Error("Purchaser access is required.");
    if(!["Approve","Cancel"].includes(input.decision))throw new Error("Invalid purchase decision.");
    if(input.decision==="Approve")validatePurchaseApproval(input);
    if(input.decision==="Cancel" && !input.note.trim())throw new Error("A cancellation reason is required.");
    return deps.transaction(async db=>{
      const row=await load(db,id);
      if(row.purchase_status!=="Draft" || row.closed_at)throw new Error("The draft purchase order has already been decided.");
      const lines=(await db.query("SELECT l.*,p.default_weight_kg FROM whatsapp_shortage_lines l JOIN products p ON p.sku=l.product_sku WHERE case_id=$1 AND procurement_quantity>0 ORDER BY product_sku",[id])).rows;
      if(!lines.length)throw new Error("No pending quantity remains.");
      let purchaseId:string|null=null;
      if(input.decision==="Approve"){
        const supplier=(await db.query("SELECT id,name FROM counterparties WHERE id=$1 AND type='Supplier'",[input.supplierId])).rows[0];
        if(!supplier)throw new Error("Select a valid supplier.");
        if(input.lines.length!==lines.length || lines.some(l=>!input.lines.some(i=>i.productSku===l.product_sku)))throw new Error("Purchase approval must cover each pending item exactly once.");
        purchaseId=key("PO");let total=0;
        for(const l of lines){
          const price=input.lines.find(i=>i.productSku===l.product_sku)!;
          const amounts=calculateTaxAmounts(Number(l.procurement_quantity),price.rate,price.gstRate as 0,"Exclusive");total+=amounts.totalAmount;
          await db.query(`INSERT INTO purchase_orders(id,cart_id,supplier_id,product_sku,purchaser_id,warehouse_id,quantity_ordered,rate,taxable_amount,gst_rate,gst_amount,tax_mode,total_amount,expected_weight_kg,delivery_mode,payment_mode,note,status)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'Exclusive',$12,$13,'Dealer Delivery','NEFT',$14,'Order Placed - Pending Delivery')`,[key("POL"),purchaseId,input.supplierId,l.product_sku,actor.id,row.warehouse_id,l.procurement_quantity,price.rate,amounts.taxableAmount,amounts.gstRate,amounts.gstAmount,amounts.totalAmount,Number(l.procurement_quantity)*Number(l.default_weight_kg),`WhatsApp shortage ${id}; expected ${input.expectedAt}. ${input.note}`]);
        }
        await db.query("INSERT INTO ledger_entries(id,side,linked_order_id,party_name,goods_value,paid_amount,pending_amount,status) VALUES($1,'Purchase',$2,$3,$4,0,$4,'Pending')",[key("LED"),purchaseId,supplier.name,total]);
      }
      await db.query("UPDATE whatsapp_shortage_cases SET purchase_status=$2,purchase_order_id=$3,purchaser_id=$4,expected_at=$5,next_action_at=COALESCE($5,NOW()),decision_note=$6,sales_resolution='',status=$7,updated_at=NOW() WHERE id=$1",[id,input.decision==="Approve"?"Approved":"Cancelled",purchaseId,actor.id,input.decision==="Approve"?input.expectedAt:null,input.note,input.decision==="Approve"?"Awaiting Stock":"Sales Action Required"]);
      await event(db,id,`Purchase ${input.decision.toLowerCase()}`,actor.fullName,input.note);
      await enqueue(db,id,"PurchaseDecision",{decision:input.decision},key("decision"));
    });
  }
  async function followup(id:string,date:string,note:string,actor:Actor,admin=false){
    if(!note.trim() || !Number.isFinite(Date.parse(date)) || Date.parse(date)<=Date.now())throw new Error("Enter a follow-up note and a future date.");
    await deps.transaction(async db=>{const row=await load(db,id);salesAccess(row,actor,admin);if(row.closed_at)throw new Error("This case is closed.");await db.query("UPDATE whatsapp_shortage_cases SET next_action_at=$2,decision_note=$3,updated_at=NOW() WHERE id=$1",[id,date,note]);await event(db,id,"Follow-up scheduled",actor.fullName,note);});
  }
  async function list(actor:Actor,admin=false){
    if(!admin&&!roles(actor).some(r=>["Sales","Purchaser"].includes(r)))throw new Error("Shortage register access is required.");
    const rows=(await deps.query(`SELECT s.*,c.name AS retailer_name,u.full_name AS salesman_name,pu.full_name AS purchaser_name,d.sales_cart_id AS available_sales_cart_id,b.sales_cart_id AS balance_sales_cart_id,
      (SELECT count(*)::int FROM whatsapp_shortage_notifications n WHERE n.case_id=s.id AND n.status='Failed') AS failed_notifications,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('sku',l.product_sku,'name',p.name,'requested',l.requested_quantity,'available',l.available_quantity,'pending',l.pending_quantity,'purchaseQuantity',l.procurement_quantity,'cancelled',l.cancelled_quantity)) FROM whatsapp_shortage_lines l JOIN products p ON p.sku=l.product_sku WHERE l.case_id=s.id),'[]') AS lines,
      COALESCE((SELECT jsonb_agg(e ORDER BY e.created_at DESC) FROM whatsapp_shortage_events e WHERE e.case_id=s.id),'[]') AS events
      FROM whatsapp_shortage_cases s JOIN counterparties c ON c.id=s.counterparty_id LEFT JOIN users u ON u.id=s.salesman_id LEFT JOIN users pu ON pu.id=s.purchaser_id JOIN whatsapp_order_drafts d ON d.id=s.draft_id LEFT JOIN whatsapp_order_drafts b ON b.id=s.balance_draft_id
      WHERE s.closed_at IS NULL ${admin||roles(actor).includes("Purchaser")?"":"AND s.salesman_id=$1"} ORDER BY s.created_at`,admin||roles(actor).includes("Purchaser")?[]:[actor.id])).rows;
    return {cases:rows,canPurchase:admin||roles(actor).includes("Purchaser"),canManage:admin||roles(actor).includes("Sales")};
  }
  async function release(id:string){
    return deps.transaction(async db=>{
      const row=await load(db,id);
      if(row.closed_at || row.retailer_choice==="Pending" || row.retailer_choice==="Cancel Balance" || row.balance_draft_id) return;
      // A cancelled purchase request remains owned by Sales until it is resubmitted.
      if(!["Approved","Not Required"].includes(row.purchase_status) && !(row.purchase_status==="Cancelled" && row.sales_resolution==="Keep Pending"))return;
      const root=(await db.query("SELECT * FROM whatsapp_order_drafts WHERE id=$1 FOR UPDATE",[row.draft_id])).rows[0];
      const all=(await db.query("SELECT s.*,l.rate,l.cd_percent,l.tod_percent,l.gst_rate,l.tax_mode FROM whatsapp_shortage_lines s JOIN whatsapp_order_draft_lines l ON l.id=s.draft_line_id WHERE s.case_id=$1 ORDER BY s.product_sku",[id])).rows;
      if(row.retailer_choice==='Split' && all.some(l=>Number(l.available_quantity)>0) && root.status!=='Completed')return;
      const required=all.map(l=>({...l,quantity:Number(row.retailer_choice==="Wait"?l.requested_quantity:l.pending_quantity)})).filter(l=>l.quantity>0);
      if(!required.length)return;
      // Only accepted physical receipts make the approved replenishment eligible.
      const receipts=(await db.query("SELECT status,quantity_received,quantity_ordered FROM purchase_orders WHERE cart_id=$1",[row.purchase_order_id])).rows;
      if(row.purchase_status==="Approved" && (!receipts.length || receipts.some(p=>!["Received","Closed"].includes(p.status)||Number(p.quantity_received)<Number(p.quantity_ordered))))return;
      for(const l of required)if(await stock(db,row.warehouse_id,l.product_sku)<l.quantity)return;
      const draftId=key("WAD");
      await db.query(`INSERT INTO whatsapp_order_drafts(id,counterparty_id,phone_e164,salesman_id,warehouse_id,source,status,billing_type,payment_mode,cash_timing,delivery_mode,note)
        VALUES($1,$2,$3,$4,$5,'Shortage balance','Needs Review',$6,$7,$8,$9,$10)`,[draftId,row.counterparty_id,root.phone_e164,row.salesman_id,row.warehouse_id,root.billing_type,root.payment_mode,root.cash_timing,root.delivery_mode,`Pending quantity released from shortage ${id}`]);
      for(const l of required)await db.query("INSERT INTO whatsapp_order_draft_lines(id,draft_id,product_sku,requested_quantity,approved_quantity,rate,cd_percent,tod_percent,gst_rate,tax_mode,note) VALUES($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,'')",[key("WADL"),draftId,l.product_sku,l.quantity,l.rate,l.cd_percent,l.tod_percent,l.gst_rate,l.tax_mode]);
      if(row.retailer_choice==="Wait" || !all.some(l=>Number(l.available_quantity)>0))await db.query("UPDATE whatsapp_order_drafts SET status='Superseded',confirmation_message_id=NULL WHERE id=$1",[row.draft_id]);
      await db.query("UPDATE whatsapp_shortage_cases SET balance_draft_id=$2,status='Balance Confirmation Pending',next_action_at=NOW(),updated_at=NOW() WHERE id=$1",[id,draftId]);
      await event(db,id,"Stock received","System","The pending quantity is available and ready for retailer confirmation.");
      await enqueue(db,id,"BalanceConfirmation",{draftId});
    });
  }
  async function reopenPurchase(id:string,actor:Actor,admin=false,note=""){
    if(!note.trim())throw new Error("A reason is required to request replenishment again.");
    await deps.transaction(async db=>{const row=await load(db,id);salesAccess(row,actor,admin);if(row.purchase_status!=="Cancelled"||row.retailer_choice==="Cancel Balance"||row.closed_at)throw new Error("This purchase request cannot be resubmitted.");await db.query("UPDATE whatsapp_shortage_cases SET purchase_status='Draft',status='Purchase Approval Pending',next_action_at=NOW(),updated_at=NOW() WHERE id=$1",[id]);await event(db,id,"Purchase resubmitted",actor.fullName,note);await enqueue(db,id,"PurchaserAlert",{},key("retry"));});
  }
  async function retryNotifications(id:string,actor:Actor,admin=false){
    await deps.transaction(async db=>{const row=await load(db,id);salesAccess(row,actor,admin);await db.query("UPDATE whatsapp_shortage_notifications SET status='Pending',attempts=0,available_at=NOW() WHERE case_id=$1 AND status='Failed'",[id]);await event(db,id,"Notification retry",actor.fullName);});
  }
  async function confirm(draftId:string){
    return deps.transaction(async db=>{
      await db.query("SELECT id FROM whatsapp_shortage_cases WHERE draft_id=$1 OR balance_draft_id=$1 FOR UPDATE",[draftId]);
      const draft=(await db.query("SELECT d.*,c.name AS retailer_name FROM whatsapp_order_drafts d JOIN counterparties c ON c.id=d.counterparty_id WHERE d.id=$1 FOR UPDATE OF d",[draftId])).rows[0];
      if(!draft)throw new Error("Order confirmation not found.");
      if(draft.status==='Completed')return draft.sales_cart_id as string;
      if(draft.status!=='Awaiting Retailer')throw new Error("This confirmation is no longer active. Please use the latest confirmation.");
      const caseRow=(await db.query("SELECT * FROM whatsapp_shortage_cases WHERE draft_id=$1 OR balance_draft_id=$1",[draftId])).rows[0];
      if(caseRow && caseRow.draft_id===draftId && caseRow.retailer_choice==='Wait')throw new Error("The order is waiting for the full quantity. Sales will send a new confirmation when stock arrives.");
      const lines=(await db.query("SELECT * FROM whatsapp_order_draft_lines WHERE draft_id=$1 AND approved_quantity>0 ORDER BY product_sku",[draftId])).rows;
      if(!lines.length)throw new Error("No available items can be confirmed yet.");
      const recovery=(await db.query("SELECT DISTINCT COALESCE(cart_id,id) AS cart FROM sales_orders WHERE note LIKE $1",[`WhatsApp confirmed order ${draftId}%`])).rows;
      if(recovery.length)throw new Error("An existing sales order needs Sales review before this confirmation can be retried.");
      const cartId=key('SCART');let total=0;
      for(const line of lines){
        await db.query("SELECT lot_id FROM inventory_lots WHERE warehouse_id=$1 AND product_sku=$2 ORDER BY lot_id FOR UPDATE",[draft.warehouse_id,line.product_sku]);
        if(await stock(db,draft.warehouse_id,line.product_sku)<Number(line.approved_quantity))throw new Error("Stock has changed. Sales must review the available quantity before confirmation.");
        const rate=Number(line.rate), quantity=Number(line.approved_quantity);
        const amounts=calculateSalesAmounts({quantity,rate,cdTodRate:rate*(1-(Number(line.cd_percent)+Number(line.tod_percent))/100),cdAmount:quantity*rate*Number(line.cd_percent)/100,todAmount:quantity*rate*Number(line.tod_percent)/100,gstRate:Number(line.gst_rate) as 0,taxMode:line.tax_mode});
        total+=amounts.totalAmount;
        await db.query(`INSERT INTO sales_orders(id,cart_id,shop_id,billing_type,product_sku,salesman_id,warehouse_id,quantity,rate,cd_tod_rate,cd_amount,tod_amount,taxable_amount,gst_rate,gst_amount,tax_mode,total_amount,payment_mode,cash_timing,delivery_mode,delivery_charge,note,status)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$22,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,0,$20,$21)`,[key('SO'),cartId,draft.counterparty_id,draft.billing_type,line.product_sku,draft.salesman_id,draft.warehouse_id,quantity,rate,amounts.cdAmount,amounts.todAmount,amounts.taxableAmount,amounts.gstRate,amounts.gstAmount,amounts.taxMode,amounts.totalAmount,draft.payment_mode,draft.cash_timing,draft.delivery_mode,`WhatsApp confirmed order ${draftId}${line.note?` | ${line.note}`:''}`,draft.delivery_mode==='Delivery'?'Booked':'Self Pickup',amounts.cdTodRate]);
      }
      // Charge the configured delivery fee once across the original and balance portions.
      const firstPortion = !caseRow || caseRow.draft_id===draftId || caseRow.retailer_choice==='Wait' || !(await db.query("SELECT sales_cart_id FROM whatsapp_order_drafts WHERE id=$1 AND sales_cart_id IS NOT NULL",[caseRow.draft_id])).rowCount;
      const setting=(await db.query("SELECT value_json FROM settings WHERE key='delivery_charge'")).rows[0]?.value_json;
      const charge=draft.delivery_mode==='Delivery' && firstPortion ? Number(setting?.amount||0):0;
      if(charge>0){await db.query("UPDATE sales_orders SET delivery_charge=$2 WHERE id=(SELECT id FROM sales_orders WHERE cart_id=$1 ORDER BY id LIMIT 1)",[cartId,charge]);total+=charge;}
      await db.query("INSERT INTO ledger_entries(id,side,linked_order_id,party_name,goods_value,paid_amount,pending_amount,status) VALUES($1,'Sales',$2,$3,$4,0,$4,'Pending')",[key('LED'),cartId,draft.retailer_name,total]);
      await db.query("UPDATE whatsapp_order_drafts SET status='Completed',sales_cart_id=$2,retailer_confirmed_at=NOW(),completed_at=NOW() WHERE id=$1",[draftId,cartId]);
      if(caseRow){
        if(caseRow.retailer_choice==='Pending')await db.query("UPDATE whatsapp_shortage_cases SET retailer_choice='Split' WHERE id=$1",[caseRow.id]);
        await db.query("UPDATE whatsapp_shortage_cases SET status=$2,updated_at=NOW(),next_action_at=COALESCE(expected_at,NOW()) WHERE id=$1",[caseRow.id,caseRow.balance_draft_id===draftId||caseRow.retailer_choice==='Cancel Balance'?'Fulfilment Pending':caseRow.purchase_status==='Cancelled'?'Sales Action Required':'Balance Pending']);
        await event(db,caseRow.id,'Sales order created','Retailer',cartId);
        await enqueue(db,caseRow.id,'OrderConfirmed',{cartId},`confirmed:${draftId}`);
      }
      return cartId;
    });
  }
  return {detect,choose,purchase,followup,list,release,reopenPurchase,retryNotifications,confirm};
}
