import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
type Db=Pick<PoolClient,'query'>;
type Deps={query:(sql:string,args?:unknown[])=>Promise<{rows:any[];rowCount:number|null}>;transaction:<T>(run:(db:Db)=>Promise<T>)=>Promise<T>};
type Actor={id:number;fullName:string;role:string;roles:string[]};
export async function enqueueWhatsApp(db:Db,phone:string,payload:Record<string,unknown>,entityType?:string,entityId?:string,key=`WAO-${randomUUID()}`){
 await db.query(`INSERT INTO whatsapp_outbox(id,phone_e164,payload_json,related_entity_type,related_entity_id) VALUES($1,$2,$3::jsonb,$4,$5) ON CONFLICT(id) DO NOTHING`,[key,phone,JSON.stringify(payload),entityType||null,entityId||null]);
 await db.query(`INSERT INTO whatsapp_messages(id,wa_message_id,direction,phone_e164,message_type,related_entity_type,related_entity_id,status,payload_json) VALUES($1,$1,'Outbound',$2,$3,$4,$5,'Queued',$6::jsonb) ON CONFLICT DO NOTHING`,[key,phone,String(payload.type||'text'),entityType||null,entityId||null,JSON.stringify({request:payload})]);
 return key;
}
export function createWhatsAppOutbox(deps:Deps,transport:(row:any)=>Promise<{messageId:string;simulated?:boolean;response?:unknown}>){
 async function dispatch(id:string){
  const row=(await deps.query(`UPDATE whatsapp_outbox SET status='Sending',attempts=attempts+1,available_at=NOW()+INTERVAL '5 minutes',updated_at=NOW() WHERE id=$1 AND status IN ('Pending','Sending') AND available_at<=NOW() RETURNING *`,[id])).rows[0];
  if(!row)return;
  try{
   if(row.related_entity_type==='CollectionFollowup'){
    const followup=(await deps.query('SELECT status,version FROM retailer_collection_followups WHERE order_id=$1',[row.related_entity_id])).rows[0];
    const version=Number(String(row.id).match(/:(\d+):\d+$/)?.[1]);
    if(!followup||followup.status==='Closed'||followup.version!==version){await deps.query("UPDATE whatsapp_outbox SET status='Superseded',updated_at=NOW() WHERE id=$1",[id]);await deps.query("UPDATE whatsapp_messages SET status='Superseded' WHERE id=$1",[id]);return;}
   }
   if((row.attempts>1||row.last_error)&&['Broadcast','Offer'].includes(row.related_entity_type)){
    const profile=(await deps.query('SELECT active,marketing_opt_in,paused_at FROM whatsapp_retailers WHERE phone_e164=$1',[row.phone_e164])).rows[0];
    const expired=row.related_entity_type==='Offer'&&!(await deps.query("SELECT 1 FROM whatsapp_offers WHERE id=$1 AND status='Sent' AND expires_at>NOW()",[row.related_entity_id])).rowCount;
    if(!profile?.active||!profile.marketing_opt_in||profile.paused_at||expired){await deps.query("UPDATE whatsapp_outbox SET status='Superseded',updated_at=NOW() WHERE id=$1",[id]);await deps.query("UPDATE whatsapp_messages SET status='Superseded' WHERE id=$1",[id]);return;}
   }
   const confirmation=row.payload_json.interactive?.action?.buttons?.find((b:any)=>String(b.reply?.id||'').startsWith('wa-confirm:'));
   if(confirmation&&(row.attempts>1||row.last_error)){const draftId=String(confirmation.reply.id).slice('wa-confirm:'.length);const draft=(await deps.query('SELECT status,confirmation_message_id FROM whatsapp_order_drafts WHERE id=$1',[draftId])).rows[0];if(!draft||draft.status!=='Awaiting Retailer'||(draft.confirmation_message_id&&![row.id,row.wa_message_id].includes(draft.confirmation_message_id))){await deps.query("UPDATE whatsapp_outbox SET status='Superseded',updated_at=NOW() WHERE id=$1",[id]);await deps.query("UPDATE whatsapp_messages SET status='Superseded' WHERE id=$1",[id]);return;}}
   const sent=await transport(row);const status=sent.simulated?'Simulated':'Sent';
   await deps.transaction(async db=>{await db.query('UPDATE whatsapp_outbox SET status=$2,wa_message_id=$3,last_error=\'\',updated_at=NOW() WHERE id=$1',[id,status,sent.messageId]);await db.query('UPDATE whatsapp_messages SET wa_message_id=$2,status=$3,error_message=NULL,payload_json=$4::jsonb WHERE id=$1',[id,sent.messageId,status,JSON.stringify({request:row.payload_json,response:sent.response||{}})]);});
   const early=(await deps.query('SELECT status,last_error FROM whatsapp_delivery_receipts WHERE wa_message_id=$1',[sent.messageId])).rows[0];if(early)await receipt(sent.messageId,early.status,early.last_error);

  }catch(error){const note=error instanceof Error?error.message:'WhatsApp delivery failed.';await deps.transaction(async db=>{await db.query("UPDATE whatsapp_outbox SET status=$2,last_error=$3,available_at=NOW()+INTERVAL '5 minutes',updated_at=NOW() WHERE id=$1",[id,row.attempts>=5?'Failed':'Pending',note]);await db.query("UPDATE whatsapp_messages SET status='Failed',error_message=$2 WHERE id=$1",[id,note]);});}
 }
 async function send(phone:string,payload:Record<string,unknown>,type?:string,entityId?:string){const id=await deps.transaction(db=>enqueueWhatsApp(db,phone,payload,type,entityId));await dispatch(id);const row=(await deps.query('SELECT * FROM whatsapp_outbox WHERE id=$1',[id])).rows[0];return {messageId:row.wa_message_id||id,simulated:row.status==='Simulated',queued:!['Sent','Delivered','Read','Simulated'].includes(row.status)};}
 async function sweep(){const due=(await deps.query("SELECT id FROM whatsapp_outbox WHERE status IN ('Pending','Sending') AND available_at<=NOW() ORDER BY created_at LIMIT 30")).rows;for(const row of due)await dispatch(row.id);}
 async function receipt(messageId:string,status:string,note:string){
  const normalized=status.toLowerCase();if(!messageId||!['sent','delivered','read','failed'].includes(normalized))return;
  const detail=normalized==='failed'?(note||'WhatsApp delivery failed.'):note;
  const stored=(await deps.query(`INSERT INTO whatsapp_delivery_receipts(wa_message_id,status,last_error) VALUES($1,$2,$3)
    ON CONFLICT(wa_message_id) DO UPDATE SET status=EXCLUDED.status,last_error=EXCLUDED.last_error,updated_at=NOW()
    WHERE whatsapp_delivery_receipts.status<>'read' AND NOT(whatsapp_delivery_receipts.status='delivered' AND EXCLUDED.status<>'read') AND NOT(whatsapp_delivery_receipts.status='failed' AND EXCLUDED.status='sent') RETURNING *`,[messageId,normalized,detail])).rows[0];
  const effective=stored||(await deps.query('SELECT * FROM whatsapp_delivery_receipts WHERE wa_message_id=$1',[messageId])).rows[0];
  await deps.query(`UPDATE whatsapp_outbox SET status=CASE WHEN $2='failed' THEN CASE WHEN attempts>=5 THEN 'Failed' ELSE 'Pending' END WHEN $2='read' THEN 'Read' WHEN $2='delivered' THEN 'Delivered' ELSE 'Sent' END,last_error=$3,available_at=NOW()+INTERVAL '5 minutes',updated_at=NOW() WHERE wa_message_id=$1 AND status NOT IN ('Manual Resolved','Superseded','Read') AND NOT(status='Delivered' AND $2<>'read') AND NOT($2='sent' AND status NOT IN ('Sending','Sent'))`,[messageId,effective.status,effective.last_error]);
  await deps.query('UPDATE whatsapp_messages SET status=$2,error_message=NULLIF($3,\'\') WHERE wa_message_id=$1',[messageId,effective.status,effective.last_error]);
 }

 async function list(actor:Actor,admin=false){if(!admin&&![actor.role,...actor.roles].includes('Sales'))throw Error('Sales or WhatsApp Admin access required.');return {items:(await deps.query(`SELECT o.*,COALESCE(r.retailer_name,o.phone_e164) AS recipient_name FROM whatsapp_outbox o LEFT JOIN (SELECT w.phone_e164,c.name AS retailer_name,w.salesman_id FROM whatsapp_retailers w JOIN counterparties c ON c.id=w.counterparty_id) r ON r.phone_e164=o.phone_e164 WHERE o.attempts>0 AND o.last_error<>'' AND o.status IN ('Pending','Sending','Failed') AND ($1 OR r.salesman_id=$2) ORDER BY o.created_at`,[admin,actor.id])).rows};}
 async function act(id:string,action:string,note:string,actor:Actor,admin=false){return deps.transaction(async db=>{
  const row=(await db.query('SELECT * FROM whatsapp_outbox WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!row)throw Error('Failed message unavailable.');
  if(!admin&&(![actor.role,...actor.roles].includes('Sales')||!(await db.query('SELECT 1 FROM whatsapp_retailers WHERE phone_e164=$1 AND salesman_id=$2',[row.phone_e164,actor.id])).rowCount))throw Error('This message belongs to another staff member.');
  if(!row.attempts||!['Pending','Failed'].includes(row.status))throw Error('Manual follow-up is only available for a failed message awaiting action.');
  if(!['note','retry','resolve'].includes(action))throw Error('Unknown message action.');if(action!=='retry'&&!note?.trim())throw Error('Record the manual follow-up details.');
  if(action==='retry')await db.query("UPDATE whatsapp_outbox SET status='Pending',attempts=0,available_at=NOW(),updated_at=NOW() WHERE id=$1",[id]);
  else await db.query("UPDATE whatsapp_outbox SET manual_note=$2,manual_by=$3,manual_at=NOW(),status=CASE WHEN $4 THEN 'Manual Resolved' ELSE status END,updated_at=NOW() WHERE id=$1",[id,note.trim(),actor.fullName,action==='resolve']);
  await db.query('INSERT INTO whatsapp_outbox_events(outbox_id,action,actor,note) VALUES($1,$2,$3,$4)',[id,action,actor.fullName,note||'']);
 });}
 return {send,dispatch,sweep,receipt,list,act};
}
