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
      const existing = (await db.query("SELECT id FROM whatsapp_shortage_cases WHERE draft_id=$1 OR id IN (SELECT case_id FROM whatsapp_shortage_portions WHERE draft_id=$1)",[draftId])).rows[0];
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
      if(row.balance_draft_id)throw new Error("Use supplier follow-up to change the unallocated balance; existing confirmation portions stay active.");
      if(choice==="Wait" && ["Completed","Processing"].includes(root.status))throw new Error("The available portion is already confirmed; only the remaining quantity can be changed.");
      if(row.retailer_choice==="Cancel Balance")throw new Error("The balance is already cancelled. Place a new order for additional quantities.");
      if(!("counterpartyId" in actor) && !note.trim())throw new Error("Record the retailer agreement before updating the choice.");
      if (!("counterpartyId" in actor) && row.purchase_status==="Cancelled" && choice!=="Cancel Balance") await db.query("UPDATE whatsapp_shortage_cases SET sales_resolution='Keep Pending' WHERE id=$1",[id]);
      if(choice==="Cancel Balance"){
        await db.query("UPDATE whatsapp_shortage_lines SET cancelled_quantity=cancelled_quantity+pending_quantity-released_quantity,pending_quantity=released_quantity,procurement_quantity=0 WHERE case_id=$1",[id]);
        await db.query("UPDATE whatsapp_shortage_cases SET purchase_status=CASE WHEN purchase_status='Draft' THEN 'Cancelled' ELSE purchase_status END WHERE id=$1",[id]);
      }
      await db.query("UPDATE whatsapp_shortage_cases SET retailer_choice=$2,status=$3,updated_at=NOW(),next_action_at=NOW() WHERE id=$1",[id,choice,choice==="Wait"?"Awaiting Stock":root.status==="Completed"?(choice==="Cancel Balance"?"Fulfilment Pending":row.purchase_status==="Cancelled"?("counterpartyId" in actor?"Sales Action Required":"Awaiting Stock"):"Balance Pending"):"Available Confirmation Pending"]);
      if(!["Completed","Processing"].includes(root.status))await db.query("UPDATE whatsapp_order_drafts SET status=$2,confirmation_message_id=NULL WHERE id=$1",[row.draft_id,choice==="Wait"?"Awaiting Stock":"Shortage Pending"]);
      if(choice==='Cancel Balance' && !row.balance_draft_id && !(await db.query("SELECT product_sku FROM whatsapp_shortage_lines WHERE case_id=$1 AND available_quantity>0",[id])).rowCount){
        await db.query("UPDATE whatsapp_order_drafts SET status='Denied',confirmation_message_id=NULL WHERE id=$1",[row.draft_id]);
        await db.query("UPDATE whatsapp_shortage_cases SET status=CASE WHEN purchase_status='Approved' THEN 'Supplier PO resolution required' ELSE 'Cancelled' END,closed_at=CASE WHEN purchase_status='Approved' THEN NULL ELSE NOW() END WHERE id=$1",[id]);
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
      COALESCE((SELECT jsonb_agg(jsonb_build_object('sku',l.product_sku,'name',p.name,'requested',l.requested_quantity,'available',l.available_quantity,'pending',l.pending_quantity-l.released_quantity,'released',l.released_quantity,'purchaseQuantity',l.procurement_quantity,'cancelled',l.cancelled_quantity)) FROM whatsapp_shortage_lines l JOIN products p ON p.sku=l.product_sku WHERE l.case_id=s.id),'[]') AS lines,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('draftId',d.id,'status',d.status,'salesCartId',d.sales_cart_id)) FROM whatsapp_shortage_portions sp JOIN whatsapp_order_drafts d ON d.id=sp.draft_id WHERE sp.case_id=s.id),'[]') AS portions,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('sku',po.product_sku,'ordered',po.quantity_ordered,'received',po.quantity_received,'outstanding',GREATEST(0,po.quantity_ordered-po.quantity_received),'status',po.status)) FROM purchase_orders po WHERE po.cart_id=s.purchase_order_id),'[]') AS receipts,
      COALESCE((SELECT jsonb_agg(e ORDER BY e.created_at DESC) FROM whatsapp_shortage_events e WHERE e.case_id=s.id),'[]') AS events
      FROM whatsapp_shortage_cases s JOIN counterparties c ON c.id=s.counterparty_id LEFT JOIN users u ON u.id=s.salesman_id LEFT JOIN users pu ON pu.id=s.purchaser_id JOIN whatsapp_order_drafts d ON d.id=s.draft_id LEFT JOIN whatsapp_order_drafts b ON b.id=s.balance_draft_id
      WHERE s.closed_at IS NULL ${admin||roles(actor).includes("Purchaser")?"":"AND s.salesman_id=$1"} ORDER BY s.created_at`,admin||roles(actor).includes("Purchaser")?[]:[actor.id])).rows;
    return {cases:rows,canPurchase:admin||roles(actor).includes("Purchaser"),canManage:admin||roles(actor).includes("Sales")};
  }
  async function receipts(db: Db, purchaseId: string) {
    return (await db.query(`SELECT po.product_sku,po.status,po.quantity_ordered,po.quantity_received,
      GREATEST(0,po.quantity_received-COALESCE((SELECT SUM(il.quantity_blocked) FROM inventory_lots il WHERE il.source_order_id=po.id),0)) AS accepted
      FROM purchase_orders po WHERE po.cart_id=$1 ORDER BY po.product_sku`,[purchaseId])).rows;
  }
  async function monitorSupply(id:string){
    return deps.transaction(async db=>{
      const row=await load(db,id);
      if(row.closed_at || row.purchase_status!=="Approved")return;
      const items=await receipts(db,row.purchase_order_id);
      if(!items.length)return;
      const incomplete=items.some(p=>Number(p.quantity_received)<Number(p.quantity_ordered));
      const blocked=items.some(p=>Number(p.accepted)<Number(p.quantity_received));
      const partial=incomplete&&items.some(p=>Number(p.quantity_received)>0);
      const overdue=incomplete&&row.expected_at&&Date.parse(row.expected_at)<Date.now();
      const status=overdue?(partial?'Partial receipt; supplier overdue':'Supplier overdue'):partial?'Partial receipt':blocked?'Receipt under warehouse review':incomplete?'Awaiting supplier':'Received';
      const signature=JSON.stringify([row.purchase_order_id,new Date(row.expected_at).toISOString(),Boolean(overdue),items.map(p=>[p.product_sku,p.quantity_received,p.accepted])]);
      if(signature===row.supply_issue_key)return;
      const needsReview=Boolean(partial||overdue);
      if(!needsReview && row.supply_review_required)await db.query("UPDATE whatsapp_shortage_cases SET status=$2 WHERE id=$1",[id,row.balance_draft_id?'Balance Confirmation Pending':'Awaiting Stock']);
      await db.query("UPDATE whatsapp_shortage_cases SET supply_status=$2,supply_issue_key=$3,supply_review_required=$4,updated_at=NOW() WHERE id=$1",[id,status,signature,needsReview&&row.retailer_choice!=='Cancel Balance']);
      if(needsReview){
        await db.query("UPDATE whatsapp_shortage_cases SET status=$2,next_action_at=NOW() WHERE id=$1",[id,row.retailer_choice==='Cancel Balance'?'Supplier PO resolution required':'Supplier follow-up required']);
        await event(db,id,"Supplier exception","System",`${status}. ${row.retailer_choice==='Cancel Balance'?'Purchaser must resolve the outstanding supplier PO.':'Sales must record the retailer decision.'}`);
        await enqueue(db,id,"SupplyAlert",{status,expectedAt:row.expected_at,items,retailerCancelled:row.retailer_choice==='Cancel Balance'},`supply:${signature}`);
      }
    });
  }
  async function supplyDecision(id:string,input:{decision:string;expectedAt?:string;note:string},actor:Actor,admin=false){
    if(!['Wait','Dispatch','Cancel'].includes(input.decision)||!input.note.trim())throw new Error('Select a supplier follow-up decision and record the retailer agreement.');
    if(input.decision==='Wait'&&(!input.expectedAt||!Number.isFinite(Date.parse(input.expectedAt))||Date.parse(input.expectedAt)<=Date.now()))throw new Error('Enter the revised future arrival date agreed with the retailer.');
    await deps.transaction(async db=>{
      const row=await load(db,id);salesAccess(row,actor,admin);
      if(row.closed_at||!['Approved','Cancelled'].includes(row.purchase_status)||row.retailer_choice==='Cancel Balance')throw new Error('This case has no active supplier follow-up.');
      if(!(await db.query('SELECT 1 FROM whatsapp_shortage_lines WHERE case_id=$1 AND pending_quantity>released_quantity',[id])).rowCount)throw new Error('All remaining quantities already have confirmation portions.');
      const root=(await db.query('SELECT * FROM whatsapp_order_drafts WHERE id=$1 FOR UPDATE',[row.draft_id])).rows[0];
      const originalOpen=!['Completed','Superseded'].includes(root.status);
      if(input.decision==='Cancel'){
        await db.query('UPDATE whatsapp_shortage_lines SET cancelled_quantity=cancelled_quantity+pending_quantity-released_quantity,pending_quantity=released_quantity WHERE case_id=$1',[id]);
      }
      const choice=input.decision==='Cancel'?'Cancel Balance':input.decision==='Wait'&&originalOpen?'Wait':'Split';
      await db.query(`UPDATE whatsapp_shortage_cases SET retailer_choice=$2,partial_release=$3,supply_review_required=FALSE,
        sales_resolution=CASE WHEN purchase_status='Cancelled' AND $2<>'Cancel Balance' THEN 'Keep Pending' ELSE sales_resolution END,expected_at=COALESCE($4,expected_at),next_action_at=COALESCE($4,NOW()),decision_note=$5,status=$6,updated_at=NOW() WHERE id=$1`,
        [id,choice,input.decision==='Dispatch',input.decision==='Wait'?input.expectedAt:null,input.note,input.decision==='Cancel'?'Fulfilment Pending':input.decision==='Wait'?'Awaiting revised delivery':'Partial dispatch requested']);
      // Record the receipt snapshot actually reviewed, including decisions made before the worker poll.
      const reviewedItems=await receipts(db,row.purchase_order_id);
      const reviewedExpected=input.decision==='Wait'?input.expectedAt!:row.expected_at;
      const reviewedOverdue=reviewedItems.some(p=>Number(p.quantity_received)<Number(p.quantity_ordered))&&Date.parse(reviewedExpected)<Date.now();
      const reviewedSignature=JSON.stringify([row.purchase_order_id,new Date(reviewedExpected||0).toISOString(),Boolean(reviewedOverdue),reviewedItems.map(p=>[p.product_sku,p.quantity_received,p.accepted])]);
      await db.query('UPDATE whatsapp_shortage_cases SET supply_issue_key=$2 WHERE id=$1',[id,reviewedSignature]);
      if(input.decision==='Wait')await db.query("UPDATE whatsapp_shortage_cases SET supply_status=$2 WHERE id=$1",[id,reviewedItems.some(p=>Number(p.quantity_received)>0)?'Partial receipt; revised date agreed':'Revised date agreed']);
      if(originalOpen){
        await db.query("UPDATE whatsapp_order_drafts SET status=$2,confirmation_message_id=NULL WHERE id=$1",[row.draft_id,choice==='Wait'?'Awaiting Stock':'Shortage Pending']);
        const hasAvailable=(await db.query('SELECT 1 FROM whatsapp_shortage_lines WHERE case_id=$1 AND available_quantity>0',[id])).rowCount;
        if(choice!=='Wait'&&hasAvailable)await enqueue(db,id,'AvailableConfirmation',{draftId:row.draft_id},key('supply-available'));
        if(choice==='Cancel Balance'&&!hasAvailable&&!row.balance_draft_id){
          await db.query("UPDATE whatsapp_order_drafts SET status='Denied' WHERE id=$1",[row.draft_id]);
          await db.query("UPDATE whatsapp_shortage_cases SET status='Supplier PO resolution required' WHERE id=$1",[id]);
        }
      }
      await event(db,id,'Supplier follow-up decision',actor.fullName,`${input.decision}${input.expectedAt?` until ${input.expectedAt}`:''}: ${input.note}`);
      await enqueue(db,id,'SupplyDecision',{decision:input.decision,expectedAt:input.expectedAt||null},key('supply-decision'));
    });
  }
  async function release(id:string){
    return deps.transaction(async db=>{
      const row=await load(db,id);
      if(row.closed_at || row.retailer_choice==="Pending" || row.retailer_choice==="Cancel Balance" || row.supply_review_required) return;
      if(!["Approved","Not Required"].includes(row.purchase_status) && !(row.purchase_status==="Cancelled" && row.sales_resolution==="Keep Pending"))return;
      // Only one unconfirmed replenishment portion is offered at a time.
      if((await db.query("SELECT 1 FROM whatsapp_shortage_portions p JOIN whatsapp_order_drafts d ON d.id=p.draft_id WHERE p.case_id=$1 AND d.status<>'Completed'",[id])).rowCount)return;
      const root=(await db.query("SELECT * FROM whatsapp_order_drafts WHERE id=$1 FOR UPDATE",[row.draft_id])).rows[0];
      const all=(await db.query("SELECT s.*,l.rate,l.cd_percent,l.tod_percent,l.gst_rate,l.tax_mode FROM whatsapp_shortage_lines s JOIN whatsapp_order_draft_lines l ON l.id=s.draft_line_id WHERE s.case_id=$1 ORDER BY s.product_sku",[id])).rows;
      if(row.retailer_choice==='Split' && all.some(l=>Number(l.available_quantity)>0) && !['Completed','Superseded'].includes(root.status))return;
      const includeOriginal=row.retailer_choice==='Wait'&&!['Completed','Superseded'].includes(root.status);
      const received=await receipts(db,row.purchase_order_id);
      const required=[];
      for(const line of all){
        const remaining=Number(line.pending_quantity)-Number(line.released_quantity);
        const original=includeOriginal?Number(line.available_quantity):0;
        const demand=remaining+original;
        if(demand<=0)continue;
        const receipt=received.find(p=>p.product_sku===line.product_sku);
        const eligible=row.purchase_status==='Approved' ? Math.max(0,Number(line.pending_quantity)+Number(line.cancelled_quantity)-Number(line.procurement_quantity)+Number(receipt?.accepted||0)-Number(line.released_quantity))+original : demand;
        const ready=Math.min(demand,eligible,await stock(db,row.warehouse_id,line.product_sku));
        if(!row.partial_release && ready<demand)return;
        if(ready>0)required.push({...line,quantity:ready,allocated:Math.max(0,ready-original)});
      }
      if(!required.length)return;
      const draftId=key("WAD");
      await db.query(`INSERT INTO whatsapp_order_drafts(id,counterparty_id,phone_e164,salesman_id,warehouse_id,source,status,billing_type,payment_mode,cash_timing,delivery_mode,note)
        VALUES($1,$2,$3,$4,$5,'Shortage balance','Needs Review',$6,$7,$8,$9,$10)`,[draftId,row.counterparty_id,root.phone_e164,row.salesman_id,row.warehouse_id,root.billing_type,root.payment_mode,root.cash_timing,root.delivery_mode,`Pending quantity released from shortage ${id}`]);
      for(const l of required){
        await db.query("INSERT INTO whatsapp_order_draft_lines(id,draft_id,product_sku,requested_quantity,approved_quantity,rate,cd_percent,tod_percent,gst_rate,tax_mode,note) VALUES($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,'')",[key("WADL"),draftId,l.product_sku,l.quantity,l.rate,l.cd_percent,l.tod_percent,l.gst_rate,l.tax_mode]);
        await db.query('UPDATE whatsapp_shortage_lines SET released_quantity=released_quantity+$3 WHERE case_id=$1 AND product_sku=$2',[id,l.product_sku,l.allocated]);
      }
      if(includeOriginal || !all.some(l=>Number(l.available_quantity)>0))await db.query("UPDATE whatsapp_order_drafts SET status='Superseded',confirmation_message_id=NULL WHERE id=$1",[row.draft_id]);
      await db.query('INSERT INTO whatsapp_shortage_portions(case_id,draft_id) VALUES($1,$2)',[id,draftId]);
      await db.query("UPDATE whatsapp_shortage_cases SET balance_draft_id=$2,status='Balance Confirmation Pending',next_action_at=NOW(),updated_at=NOW() WHERE id=$1",[id,draftId]);
      await event(db,id,"Stock released","System",`Retailer confirmation prepared: ${draftId}. Unreleased quantities remain pending.`);
      await enqueue(db,id,"BalanceConfirmation",{draftId},`balance:${draftId}`);
    });
  }
  async function reopenPurchase(id:string,actor:Actor,admin=false,note=""){
    if(!note.trim())throw new Error("A reason is required to request replenishment again.");
    await deps.transaction(async db=>{
      const row=await load(db,id);salesAccess(row,actor,admin);
      if(row.purchase_status!=="Cancelled"||row.retailer_choice==="Cancel Balance"||row.closed_at)throw new Error("This purchase request cannot be resubmitted.");
      if(row.purchase_order_id&&(await db.query("SELECT 1 FROM purchase_orders WHERE cart_id=$1 AND status NOT IN ('Cancelled','Closed') AND quantity_received<quantity_ordered",[row.purchase_order_id])).rowCount)throw new Error('Purchaser must resolve outstanding lines on the previous PO before a replacement purchase is requested.');
      const root=(await db.query('SELECT status FROM whatsapp_order_drafts WHERE id=$1',[row.draft_id])).rows[0];
      const lines=(await db.query('SELECT * FROM whatsapp_shortage_lines WHERE case_id=$1',[id])).rows;
      let total=0;
      for(const line of lines){
        const original=['Completed','Superseded'].includes(root.status)?0:Number(line.available_quantity);
        const needed=Math.max(0,Number(line.pending_quantity)-Number(line.released_quantity)+original-await stock(db,row.warehouse_id,line.product_sku));
        total+=needed;
        await db.query('UPDATE whatsapp_shortage_lines SET procurement_quantity=$3 WHERE case_id=$1 AND product_sku=$2',[id,line.product_sku,needed]);
      }
      await db.query("UPDATE whatsapp_shortage_cases SET purchase_status=$2,status=$3,supply_review_required=FALSE,supply_status='',supply_issue_key='',next_action_at=NOW(),updated_at=NOW() WHERE id=$1",[id,total>0?'Draft':'Not Required',total>0?'Purchase Approval Pending':'Awaiting Stock']);
      await event(db,id,"Purchase resubmitted",actor.fullName,`${note}${row.purchase_order_id?` Previous PO: ${row.purchase_order_id}`:''}`);
      if(total>0)await enqueue(db,id,"PurchaserAlert",{},key("retry"));
    });
  }
  async function retryNotifications(id:string,actor:Actor,admin=false){
    await deps.transaction(async db=>{const row=await load(db,id);salesAccess(row,actor,admin);await db.query("UPDATE whatsapp_shortage_notifications SET status='Pending',attempts=0,available_at=NOW() WHERE case_id=$1 AND status='Failed'",[id]);await event(db,id,"Notification retry",actor.fullName);});
  }
  async function confirm(draftId:string){
    return deps.transaction(async db=>{
      await db.query("SELECT id FROM whatsapp_shortage_cases WHERE draft_id=$1 OR id IN (SELECT case_id FROM whatsapp_shortage_portions WHERE draft_id=$1) FOR UPDATE",[draftId]);
      const draft=(await db.query("SELECT d.*,c.name AS retailer_name FROM whatsapp_order_drafts d JOIN counterparties c ON c.id=d.counterparty_id WHERE d.id=$1 FOR UPDATE OF d",[draftId])).rows[0];
      if(!draft)throw new Error("Order confirmation not found.");
      if(draft.status==='Completed')return draft.sales_cart_id as string;
      if(draft.status!=='Awaiting Retailer')throw new Error("This confirmation is no longer active. Please use the latest confirmation.");
      const caseRow=(await db.query("SELECT * FROM whatsapp_shortage_cases WHERE draft_id=$1 OR id IN (SELECT case_id FROM whatsapp_shortage_portions WHERE draft_id=$1)",[draftId])).rows[0];
      if(caseRow && caseRow.draft_id===draftId && caseRow.retailer_choice==='Wait')throw new Error("The order is waiting for the full quantity. Sales will send a new confirmation when stock arrives.");
      const lines=(await db.query("SELECT * FROM whatsapp_order_draft_lines WHERE draft_id=$1 AND approved_quantity>0 ORDER BY product_sku",[draftId])).rows;
      if(!lines.length)throw new Error("No available items can be confirmed yet.");
      const recovery=(await db.query("SELECT DISTINCT COALESCE(cart_id,id) AS cart FROM sales_orders WHERE note=$1 OR note LIKE $2",[`WhatsApp confirmed order ${draftId}`,`WhatsApp confirmed order ${draftId} | %`])).rows;
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
      const firstPortion = !caseRow || !(await db.query("SELECT 1 FROM whatsapp_order_drafts WHERE sales_cart_id IS NOT NULL AND (id=$1 OR id IN (SELECT draft_id FROM whatsapp_shortage_portions WHERE case_id=$2))",[caseRow.draft_id,caseRow.id])).rowCount;
      const setting=(await db.query("SELECT value_json FROM settings WHERE key='delivery_charge'")).rows[0]?.value_json;
      const charge=draft.delivery_mode==='Delivery' && firstPortion ? Number(setting?.amount||0):0;
      if(charge>0){await db.query("UPDATE sales_orders SET delivery_charge=$2 WHERE id=(SELECT id FROM sales_orders WHERE cart_id=$1 ORDER BY id LIMIT 1)",[cartId,charge]);total+=charge;}
      await db.query("INSERT INTO ledger_entries(id,side,linked_order_id,party_name,goods_value,paid_amount,pending_amount,status) VALUES($1,'Sales',$2,$3,$4,0,$4,'Pending')",[key('LED'),cartId,draft.retailer_name,total]);
      await db.query("UPDATE whatsapp_order_drafts SET status='Completed',sales_cart_id=$2,retailer_confirmed_at=NOW(),completed_at=NOW() WHERE id=$1",[draftId,cartId]);
      if(caseRow){
        if(caseRow.retailer_choice==='Pending')await db.query("UPDATE whatsapp_shortage_cases SET retailer_choice='Split' WHERE id=$1",[caseRow.id]);
        await db.query("UPDATE whatsapp_shortage_cases SET status=$2,updated_at=NOW(),next_action_at=COALESCE(expected_at,NOW()) WHERE id=$1",[caseRow.id,!(await db.query('SELECT 1 FROM whatsapp_shortage_lines WHERE case_id=$1 AND pending_quantity>released_quantity',[caseRow.id])).rowCount?'Fulfilment Pending':caseRow.purchase_status==='Cancelled'?'Sales Action Required':'Balance Pending']);
        await event(db,caseRow.id,'Sales order created','Retailer',cartId);
        await enqueue(db,caseRow.id,'OrderConfirmed',{cartId},`confirmed:${draftId}`);
      }
      return cartId;
    });
  }
  return {detect,choose,purchase,followup,list,release,monitorSupply,supplyDecision,reopenPurchase,retryNotifications,confirm};
}
