import type { PoolClient } from "pg";

type Db = Pick<PoolClient, "query">;
type Actor = { id: number; fullName: string; role: string; roles: string[]; counterpartyId?: string };
type Dependencies = { transaction: <T>(run: (db: Db) => Promise<T>) => Promise<T>; query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }> };

export function createConfirmationService(deps: Dependencies) {
  async function enqueue(db: Db, draftId: string, kind: string, version: number, payload: Record<string, unknown> = {}) {
    await db.query("INSERT INTO whatsapp_confirmation_notifications(id,draft_id,kind,version,payload_json) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(id) DO NOTHING", [`${draftId}:${kind}:${version}`,draftId,kind,version,JSON.stringify(payload)]);
  }
  async function begin(draftId:string) {
    await deps.query(`INSERT INTO whatsapp_confirmation_followups(draft_id)
      SELECT id FROM whatsapp_order_drafts WHERE id=$1 AND status='Awaiting Retailer'
      ON CONFLICT(draft_id) DO UPDATE SET active=TRUE,due_at=NULL,version=whatsapp_confirmation_followups.version+1,updated_at=NOW()`,[draftId]);
  }
  async function reconcile() {
    await deps.transaction(async db=>{
      await db.query(`UPDATE whatsapp_confirmation_followups f SET active=FALSE,due_at=NULL,version=version+1,updated_at=NOW()
        FROM whatsapp_order_drafts d WHERE d.id=f.draft_id AND d.status<>'Awaiting Retailer' AND f.active`);
      await db.query(`INSERT INTO whatsapp_confirmation_followups(draft_id)
        SELECT id FROM whatsapp_order_drafts WHERE status='Awaiting Retailer'
        ON CONFLICT(draft_id) DO UPDATE SET active=TRUE,due_at=NULL,version=whatsapp_confirmation_followups.version+1,updated_at=NOW() WHERE NOT whatsapp_confirmation_followups.active`);
      await db.query(`UPDATE whatsapp_confirmation_notifications n SET status='Superseded'
        FROM whatsapp_confirmation_followups f,whatsapp_order_drafts d WHERE n.draft_id=f.draft_id AND d.id=f.draft_id
        AND n.kind IN ('Overdue','Resend') AND n.status IN ('Pending','Failed') AND (n.version<>f.version OR d.status<>'Awaiting Retailer')`);
      const due=(await db.query(`SELECT f.draft_id,f.version,f.due_at FROM whatsapp_confirmation_followups f JOIN whatsapp_order_drafts d ON d.id=f.draft_id
        WHERE f.active AND f.due_at<=NOW() AND d.status='Awaiting Retailer'`)).rows;
      for(const row of due)await enqueue(db,row.draft_id,'Overdue',row.version,{dueAt:row.due_at});
    });
  }
  async function list(actor:Actor,admin=false) {
    if(!admin&&![actor.role,...actor.roles].includes('Sales'))throw new Error('Sales access is required.');
    const items=(await deps.query(`SELECT d.id AS draft_id,d.status,d.created_at,d.warehouse_id,c.name AS retailer_name,u.full_name AS salesman_name,
      f.due_at,f.note,COALESCE(f.version,0) AS version,
      (SELECT s.id FROM whatsapp_shortage_cases s WHERE s.draft_id=d.id OR s.id IN (SELECT case_id FROM whatsapp_shortage_portions WHERE draft_id=d.id)) AS shortage_case_id,
      (SELECT count(*)::int FROM whatsapp_confirmation_notifications n WHERE n.draft_id=d.id AND n.status='Failed') AS failed_notifications,
      (SELECT count(*)::int FROM whatsapp_confirmation_notifications n WHERE n.draft_id=d.id AND n.status IN ('Pending','Sending')) AS pending_notifications,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('sku',l.product_sku,'name',p.name,'quantity',l.approved_quantity)) FROM whatsapp_order_draft_lines l JOIN products p ON p.sku=l.product_sku WHERE l.draft_id=d.id AND l.approved_quantity>0),'[]') AS lines,
      COALESCE((SELECT jsonb_agg(e ORDER BY e.created_at DESC) FROM whatsapp_confirmation_events e WHERE e.draft_id=d.id),'[]') AS events
      FROM whatsapp_order_drafts d JOIN counterparties c ON c.id=d.counterparty_id LEFT JOIN users u ON u.id=d.salesman_id LEFT JOIN whatsapp_confirmation_followups f ON f.draft_id=d.id
      WHERE (d.status='Awaiting Retailer' OR EXISTS(SELECT 1 FROM whatsapp_confirmation_notifications n WHERE n.draft_id=d.id AND n.kind='Cancelled' AND n.status NOT IN ('Sent','Superseded')))
      ${admin?'':'AND d.salesman_id=$1'} ORDER BY f.due_at NULLS FIRST,d.created_at`,admin?[]:[actor.id])).rows;
    return {items};
  }
  async function act(draftId:string,input:{action:string;date?:string;note:string},actor:Actor,admin=false) {
    if(!['schedule','resend','cancel','retry'].includes(input.action))throw new Error('Unknown confirmation follow-up action.');
    if(input.action!=='retry'&&!input.note.trim())throw new Error('Record a follow-up note or cancellation reason.');
    if(['schedule','resend'].includes(input.action)&&(!input.date||!Number.isFinite(Date.parse(input.date))||Date.parse(input.date)<=Date.now()))throw new Error('Enter a future follow-up date.');
    return deps.transaction(async db=>{
      // Match confirmation lock order: linked shortage case, then draft.
      const shortage=(await db.query('SELECT * FROM whatsapp_shortage_cases WHERE draft_id=$1 OR id IN (SELECT case_id FROM whatsapp_shortage_portions WHERE draft_id=$1) FOR UPDATE',[draftId])).rows[0];
      const draft=(await db.query('SELECT * FROM whatsapp_order_drafts WHERE id=$1 FOR UPDATE',[draftId])).rows[0];
      if(!draft)throw new Error('Order confirmation not found.');
      if(actor.counterpartyId&&(actor.counterpartyId!==draft.counterparty_id||input.action!=='cancel'))throw new Error('This cancellation is not available for this retailer.');
      if(!actor.counterpartyId&&!admin&&(![actor.role,...actor.roles].includes('Sales')||Number(draft.salesman_id)!==actor.id))throw new Error('This order belongs to another salesperson.');
      if(input.action==='retry') {
        await db.query("UPDATE whatsapp_confirmation_notifications SET status='Pending',attempts=0,available_at=NOW() WHERE draft_id=$1 AND status='Failed'",[draftId]);
      } else {
        if(!(actor.counterpartyId?['Awaiting Retailer','Change Requested','Needs Review','Staff Approved']:['Awaiting Retailer']).includes(draft.status)||draft.sales_cart_id)throw new Error('Only an order awaiting retailer confirmation can be changed here.');
        const existingOrder=await db.query("SELECT 1 FROM sales_orders WHERE note=$1 OR note LIKE $2",[`WhatsApp confirmed order ${draftId}`,`WhatsApp confirmed order ${draftId} | %`]);
        if(existingOrder.rowCount)throw new Error('A sales order already exists. Resolve it through the sales order workflow.');
        const followup=(await db.query(`INSERT INTO whatsapp_confirmation_followups(draft_id,due_at,note,active)
          VALUES($1,$2,$3,$4) ON CONFLICT(draft_id) DO UPDATE SET due_at=EXCLUDED.due_at,note=EXCLUDED.note,active=EXCLUDED.active,version=whatsapp_confirmation_followups.version+1,updated_at=NOW() RETURNING version`,[draftId,input.action==='cancel'?null:input.date,input.note,input.action!=='cancel'])).rows[0];
        await db.query("UPDATE whatsapp_confirmation_notifications SET status='Superseded' WHERE draft_id=$1 AND kind IN ('Overdue','Resend') AND status IN ('Pending','Failed')",[draftId]);
        if(input.action==='cancel') {
          if(shortage)await cancelPortion(db,shortage,draftId,actor.fullName,input.note);
          await db.query("UPDATE whatsapp_order_drafts SET status='Denied',confirmation_message_id=NULL,note=CONCAT(COALESCE(note,''),' | Confirmation cancelled: ',$2::text) WHERE id=$1",[draftId,input.note]);
          await enqueue(db,draftId,'Cancelled',followup.version,{reason:input.note,shortageCaseId:shortage?.id||null});
        }
        if(input.action==='resend')await enqueue(db,draftId,'Resend',followup.version);
      }
      await db.query('INSERT INTO whatsapp_confirmation_events(draft_id,action,actor,note) VALUES($1,$2,$3,$4)',[draftId,input.action,actor.fullName,`${input.note}${input.date?` Follow-up: ${input.date}`:''}`]);
    });
  }
  async function cancelPortion(db:Db,shortage:any,draftId:string,actor:string,note:string) {
    const lines=(await db.query('SELECT product_sku,approved_quantity FROM whatsapp_order_draft_lines WHERE draft_id=$1 AND approved_quantity>0',[draftId])).rows;
    const root=(await db.query('SELECT status FROM whatsapp_order_drafts WHERE id=$1',[shortage.draft_id])).rows[0];
    const first=(await db.query('SELECT draft_id FROM whatsapp_shortage_portions WHERE case_id=$1 ORDER BY created_at,draft_id LIMIT 1',[shortage.id])).rows[0];
    for(const line of lines){
      const tracked=(await db.query('SELECT * FROM whatsapp_shortage_lines WHERE case_id=$1 AND product_sku=$2',[shortage.id,line.product_sku])).rows[0];
      const qty=Number(line.approved_quantity);
      const original=draftId===shortage.draft_id || (root.status==='Superseded'&&first?.draft_id===draftId)?Math.min(qty,Number(tracked.available_quantity)):0;
      const balance=qty-original;
      await db.query(`UPDATE whatsapp_shortage_lines SET available_quantity=available_quantity-$3,pending_quantity=pending_quantity-$4,released_quantity=released_quantity-$4,cancelled_quantity=cancelled_quantity+$3+$4
        WHERE case_id=$1 AND product_sku=$2`,[shortage.id,line.product_sku,original,balance]);
    }
    const remaining=(await db.query('SELECT 1 FROM whatsapp_shortage_lines WHERE case_id=$1 AND pending_quantity>released_quantity',[shortage.id])).rowCount;
    await db.query(`UPDATE whatsapp_shortage_cases SET status=$2,partial_release=FALSE,retailer_choice=CASE WHEN retailer_choice='Pending' THEN 'Split' ELSE retailer_choice END,
      purchase_status=CASE WHEN purchase_status='Draft' AND NOT $3 THEN 'Cancelled' ELSE purchase_status END,next_action_at=NOW(),updated_at=NOW() WHERE id=$1`,[shortage.id,remaining?'Balance Pending':'Fulfilment Pending',Boolean(remaining)]);
    await db.query("INSERT INTO whatsapp_shortage_events(case_id,action,actor,note) VALUES($1,'Unconfirmed portion cancelled',$2,$3)",[shortage.id,actor,`${draftId}: ${note}. Other portions and unallocated demand remain linked.`]);
  }
  async function cancelByRetailer(draftId:string,counterpartyId:string) {
    await act(draftId,{action:'cancel',note:'The retailer cleared the unconfirmed order.'},{id:0,fullName:'Retailer',role:'Retailer',roles:[],counterpartyId});
  }
  return {begin,reconcile,list,act,cancelByRetailer};
}
