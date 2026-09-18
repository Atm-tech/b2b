import {randomUUID,createHash} from 'node:crypto';
import sharp from 'sharp';
import type {PoolClient} from 'pg';
type Db=Pick<PoolClient,'query'>;
type Actor={id:number;username:string;fullName:string;role:string;roles:string[];warehouseIds?:string[]};
type Receipt={lines:Array<{id:string;good:number;damaged:number}>;note:string;resolveMissing:boolean};
type Hooks={load:(db:Db,id:string)=>Promise<{row:any;task:any}>;agent:(row:any,a:Actor,admin:boolean)=>void;version:(row:any,v:number)=>void;audit:(db:Db,id:string,action:string,a:Actor,note?:string)=>Promise<void>;notify:(db:Db,row:any)=>Promise<void>};
const isWarehouse=(a:Actor,row:any)=>[a.role,...a.roles].includes('Warehouse Manager')&&(!a.warehouseIds?.length||a.warehouseIds.includes(row.warehouse_id))&&String(row.original_json[0]?.note).startsWith('WhatsApp confirmed order WAD-');
export function canReceiveReturn(a:Actor,row:any){return isWarehouse(a,row);}
export async function returnFinancialStatus(db:Db,row:any){
 const p=(await db.query("SELECT COALESCE(SUM(amount) FILTER (WHERE verification_status IN ('Verified','Resolved')),0) AS paid,COUNT(*) FILTER(WHERE verification_status NOT IN ('Verified','Resolved','Rejected'))::int AS unverified FROM payments WHERE side='Sales' AND linked_order_id=$1",[row.order_id])).rows[0];
 return Number(p.unverified)===0&&Math.abs(Number(p.paid)-Number(row.adjusted_total))<.005?'Closed':'Warehouse Received';
}
export async function requireAgentReturnPhotos(db:Db,row:any){
 const photos=(await db.query("SELECT line_id FROM delivery_exception_photos WHERE case_id=$1 AND stage='Agent report'",[row.id])).rows;
 if(row.report_json.kind==='Shop closed'){if(!photos.length)throw Error('Take a photo of the closed shop before confirming this visit.');}
 else for(const line of row.report_json.lines)if(!photos.some(p=>p.line_id===line.id))throw Error('Add photo evidence for every returned product before sending the report.');
}
export function createReturnReceiptMethods(deps:{query:(sql:string,args?:unknown[])=>Promise<{rows:any[];rowCount:number|null}>;transaction:<T>(run:(db:Db)=>Promise<T>)=>Promise<T>},h:Hooks){
 function warehouse(row:any,a:Actor){if(!isWarehouse(a,row))throw Error('The Warehouse Manager assigned to this warehouse must record the receipt and final decision.');}
 async function authorizePhoto(id:string,stage:string,lineId:string|null,a:Actor,admin=false){return deps.transaction(async db=>{const {row}=await h.load(db,id);checkPhoto(row,stage,lineId,a,admin);return true;});}
 function checkPhoto(row:any,stage:string,lineId:string|null,a:Actor,admin:boolean){
  if(stage==='Agent report'){h.agent(row,a,admin);if(!['Draft','Correction Requested'].includes(row.status)&&!(row.bill_adjusted_at&&!row.warehouse_received_at))throw Error('The submitted report is locked. Request a correction before adding report photos.');if(row.report_json.kind==='Returned'&&!row.original_json.some((l:any)=>l.id===lineId))throw Error('Select the returned product for this photo.');}
  else if(stage==='Agent handover'){h.agent(row,a,admin);if(!row.bill_adjusted_at||row.warehouse_received_at)throw Error('Upload a handover photo after seller approval and before warehouse receipt.');}
  else if(stage==='Warehouse receipt'){warehouse(row,a);if(!row.handover_at||row.warehouse_received_at)throw Error('The agent must confirm the return handover before warehouse receipt.');if(!row.report_json.lines.some((l:any)=>l.id===lineId))throw Error('Select an authorized returned product for the receiving photo.');}
  else throw Error('Unknown photo evidence stage.');
 }
 async function addPhoto(id:string,stage:string,lineId:string|null,bytes:Buffer,a:Actor,admin=false,source='BConnect',messageId?:string){
  await authorizePhoto(id,stage,lineId,a,admin);if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>8*1024*1024)throw Error('Upload a photo no larger than 8 MB.');
  const image=sharp(bytes,{limitInputPixels:40_000_000});const metadata=await image.metadata();if(!['jpeg','png','webp'].includes(metadata.format||''))throw Error('Upload a JPEG, PNG or WebP photo.');
  const normalized=await image.rotate().resize({width:2048,height:2048,fit:'inside',withoutEnlargement:true}).jpeg({quality:90}).toBuffer();
  return deps.transaction(async db=>{const {row}=await h.load(db,id);checkPhoto(row,stage,lineId,a,admin);
   if(messageId){const existing=(await db.query('SELECT id,case_id FROM delivery_exception_photos WHERE source_message_id=$1',[messageId])).rows[0];if(existing){if(existing.case_id!==id)throw Error('This photo message is already attached to another report.');return existing.id;}}
   const photoId=`DPH-${randomUUID()}`;await db.query('INSERT INTO delivery_exception_photos(id,case_id,stage,line_id,image_bytes,sha256,source,source_message_id,created_by,created_by_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[photoId,id,stage,lineId,normalized,createHash('sha256').update(normalized).digest('hex'),source,messageId||null,a.id,a.fullName]);await h.audit(db,id,'Photo evidence added',a,`${stage}${lineId?` / ${lineId}`:''} / ${photoId}`);return photoId;
  });
 }
 async function handover(id:string,v:number,a:Actor,admin=false){return deps.transaction(async db=>{const {row}=await h.load(db,id);h.agent(row,a,admin);if(row.handover_at)return row;h.version(row,v);if(!row.bill_adjusted_at)throw Error('Seller approval is required before return handover.');if(!(await db.query("SELECT 1 FROM delivery_exception_photos WHERE case_id=$1 AND stage='Agent handover'",[id])).rowCount)throw Error('Take a photo of the goods at warehouse handover first.');const next=(await db.query("UPDATE delivery_exceptions SET handover_at=NOW(),status='Awaiting Warehouse',revision=revision+1,updated_at=NOW() WHERE id=$1 RETURNING *",[id])).rows[0];await h.audit(db,id,'Return presented to warehouse',a,'Custody stays with the agent until Warehouse Manager receipt.');await h.notify(db,next);return next;});}
 async function validateReceipt(db:Db,row:any,input:Receipt,checkPhotos=true){
  if(!input||!Array.isArray(input.lines)||input.lines.length!==row.report_json.lines.length||new Set(input.lines.map(l=>l.id)).size!==input.lines.length||!input.note?.trim())throw Error('Count every returned product and record the Warehouse Manager findings.');
  const photos=(await db.query("SELECT id,line_id FROM delivery_exception_photos WHERE case_id=$1 AND stage='Warehouse receipt'",[row.id])).rows;
  for(const l of input.lines){const expected=row.report_json.lines.find((r:any)=>r.id===l.id);if(!expected||![l.good,l.damaged].every(n=>Number.isFinite(n)&&n>=0)||l.good+l.damaged>expected.quantity)throw Error('Sellable plus damaged quantity cannot exceed the authorized return quantity. Recount unexpected goods before proceeding.');if(checkPhotos&&!photos.some(p=>p.line_id===l.id))throw Error('Add receiving/condition photo evidence for every returned product.');if(l.good+l.damaged<expected.quantity&&input.resolveMissing!==true)throw Error('Record an explicit Warehouse Manager decision for missing quantity before finalizing.');}
 }
 async function saveReceipt(id:string,input:Receipt,v:number,a:Actor){return deps.transaction(async db=>{const {row}=await h.load(db,id);warehouse(row,a);h.version(row,v);if(!row.handover_at||row.warehouse_received_at)throw Error('Select a return awaiting warehouse receipt.');await validateReceipt(db,row,input,false);const next=(await db.query('UPDATE delivery_exceptions SET receipt_json=$2::jsonb,revision=revision+1,updated_at=NOW() WHERE id=$1 RETURNING *',[id,JSON.stringify(input)])).rows[0];await h.audit(db,id,'Warehouse count saved',a,input.note);return next;});}
 async function finalizeReceipt(id:string,v:number,a:Actor){return deps.transaction(async db=>{const {row,task}=await h.load(db,id);warehouse(row,a);if(row.warehouse_received_at){if(row.receipt_finalized_revision===v)return row;throw Error('This return has already been received.');}h.version(row,v);if(!row.handover_at||!row.bill_adjusted_at||!row.receipt_json)throw Error('Save the photographed warehouse count before confirming receipt.');await validateReceipt(db,row,row.receipt_json);await requireAgentReturnPhotos(db,row);
  for(const count of row.receipt_json.lines){const original=row.original_json.find((l:any)=>l.id===count.id);const expected=row.report_json.lines.find((l:any)=>l.id===count.id);const photo=(await db.query("SELECT id FROM delivery_exception_photos WHERE case_id=$1 AND stage='Warehouse receipt' AND line_id=$2 ORDER BY created_at DESC LIMIT 1",[id,count.id])).rows[0];
   for(const [condition,quantity] of [['Sellable',count.good],['Damaged',count.damaged]] as const){if(Number(quantity)<=0)continue;const returnId=`SRL-${randomUUID()}`;
    await db.query("INSERT INTO sales_returns(id,return_group_id,mode,linked_order_id,linked_order_line_id,shop_id,warehouse_id,product_sku,quantity,rate,reason,note,photo_name,created_by) VALUES($1,$2,'Adhoc',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",[returnId,id,row.order_id,count.id,row.shop_id,row.warehouse_id,original.product_sku,quantity,original.rate,condition==='Damaged'?'Damage':'Other',`Delivery return receipt ${id}. Bill already adjusted; no additional credit. ${row.receipt_json.note}`,`/delivery-exceptions/${id}/photos/${photo.id}`,a.fullName]);
    await db.query("INSERT INTO inventory_lots(lot_id,source_order_id,source_type,warehouse_id,product_sku,quantity_available,quantity_reserved,quantity_blocked,status) VALUES($1,$2,'Sales Return',$3,$4,$5,0,$6,$7)",[`LOT-${randomUUID()}`,id,row.warehouse_id,original.product_sku,condition==='Sellable'?quantity:0,condition==='Damaged'?quantity:0,condition==='Sellable'?'Available':'Blocked']);
   }
   const missing=expected.quantity-count.good-count.damaged;if(missing>0)await h.audit(db,id,'Missing return quantity resolved',a,`${original.product_sku}: ${missing} missing. ${row.receipt_json.note}. No stock restored for missing units.`);
  }
  const status=await returnFinancialStatus(db,row);
  const next=(await db.query('UPDATE delivery_exceptions SET warehouse_received_at=NOW(),warehouse_received_by=$2,receipt_finalized_revision=revision,status=$3,revision=revision+1,updated_at=NOW() WHERE id=$1 RETURNING *',[id,a.id,status])).rows[0];
  await db.query('UPDATE delivery_tasks SET route_json=$2::jsonb,last_action_at=NOW() WHERE id=$1',[task.id,JSON.stringify(task.route_json.map((s:any)=>s.orderId===row.order_id?{...s,returnReceived:true}:s))]);
  await h.audit(db,id,'Warehouse receipt finalized',a,`Custody transferred to warehouse. Sellable stock restored; damaged stock blocked. ${row.receipt_json.note}`);await h.notify(db,next);return next;
 });}
 return {authorizePhoto,addPhoto,handover,saveReceipt,finalizeReceipt};
}
