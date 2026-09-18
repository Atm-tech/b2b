import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { api, formatDateTimeIst } from "../../app/shared";
import { Panel } from "../../components/ui";

type Confirmation = {
  draft_id: string; status: string; created_at: string; retailer_name: string; salesman_name: string; warehouse_id: string;
  due_at?: string; note?: string; shortage_case_id?: string; pending_notifications: number; failed_notifications: number;
  lines: Array<{sku: string; name: string; quantity: number}>;
  events: Array<{id: number; action: string; actor: string; note: string; created_at: string}>;
};
type Action = (id: string, action: string, body: Record<string, unknown>) => Promise<void>;
function ConfirmationCard({item,busy,act}:{item:Confirmation;busy:boolean;act:Action}) {
  const [date,setDate]=useState("");
  const [note,setNote]=useState("");
  const awaiting=item.status==='Awaiting Retailer';
  const overdue=awaiting&&Boolean(item.due_at&&Date.parse(item.due_at)<Date.now());
  return <article className="panel shortage-card">
    <div className="section-heading"><div><span className="eyebrow">{item.warehouse_id} / {formatDateTimeIst(item.created_at)}</span><h3>{item.retailer_name}</h3></div><span className="status-pill pending">{awaiting?(overdue?'Confirmation overdue':item.due_at?'Follow-up scheduled':'Follow-up date required'):'Cancellation notification pending'}</span></div>
    <p><strong>Sales owner:</strong> {item.salesman_name||'Assignment required'}<br /><strong>Confirmation:</strong> {item.draft_id}</p>
    {item.shortage_case_id?<p className="helper-text">Linked shortage: {item.shortage_case_id}. Actions here apply only to this unconfirmed portion; other portions and pending demand remain active.</p>:null}
    <ul>{item.lines.map(line=><li key={line.sku}>{line.name}: {line.quantity}</li>)}</ul>
    {awaiting?<p className={overdue?'error-text':'helper-text'}>{item.due_at?`Follow-up due: ${formatDateTimeIst(item.due_at)}`:'Sales must set a follow-up date. Orders are never automatically cancelled.'}</p>:null}
    {item.note?<p>{item.note}</p>:null}
    {item.pending_notifications>0?<p role="status">{item.pending_notifications} notification(s) queued for delivery.</p>:null}
    {item.failed_notifications>0?<p role="alert">{item.failed_notifications} notification(s) failed. Follow-up remains open.</p>:null}
    {awaiting?<details><summary>Manage retailer confirmation</summary><div className="form-grid">
      <label className="wide-field">Follow-up note / cancellation reason<input value={note} onChange={event=>setNote(event.target.value)} /></label>
      <label>Next follow-up date<input type="datetime-local" value={date} onChange={event=>setDate(event.target.value)} /></label>
      <button className="ghost-button" disabled={busy||!note.trim()||!date} onClick={()=>void act(item.draft_id,'schedule',{date:new Date(date).toISOString(),note})}>Set follow-up date</button>
      <button className="primary-button" disabled={busy||!note.trim()||!date} onClick={()=>void act(item.draft_id,'resend',{date:new Date(date).toISOString(),note})}>Resend confirmation and schedule follow-up</button>
      <button className="danger-button" disabled={busy||!note.trim()} onClick={()=>void act(item.draft_id,'cancel',{note})}>Cancel this unconfirmed portion</button>
    </div></details>:null}
    {item.failed_notifications>0?<button className="ghost-button" disabled={busy} onClick={()=>void act(item.draft_id,'retry',{})}>Retry failed notifications</button>:null}
    {item.events.length?<details><summary>Follow-up history ({item.events.length})</summary><ul>{item.events.map(event=><li key={event.id}><strong>{event.action}</strong> / {event.actor} / {formatDateTimeIst(event.created_at)} — {event.note}</li>)}</ul></details>:null}
  </article>;
}
export function ConfirmationRegister({sessionToken}:{sessionToken:string}) {
  const [items,setItems]=useState<Confirmation[]>([]);
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [filter,setFilter]=useState("");
  const sequence=useRef(0);
  const busyRef=useRef(false);
  const report=(error:unknown)=>axios.isAxiosError(error)?String(error.response?.data?.message||error.message):error instanceof Error?error.message:'The action could not be completed.';
  const refresh=useCallback(async()=>{
    if(busyRef.current)return;
    const current=++sequence.current;
    try {const {data}=await api.get<{items:Confirmation[]}>("/whatsapp/confirmations",{headers:{authorization:`Bearer ${sessionToken}`}});if(current===sequence.current){setItems(data.items);setError("");}}
    catch(error){if(current===sequence.current)setError(report(error));}
    finally{if(current===sequence.current)setLoading(false);}
  },[sessionToken]);
  useEffect(()=>{void refresh();const timer=window.setInterval(()=>void refresh(),30_000);return()=>{window.clearInterval(timer);sequence.current++;};},[refresh]);
  const act:Action=async(id,action,body)=>{
    busyRef.current=true;setBusy(true);++sequence.current;setError("");
    try {const {data}=await api.post<{items:Confirmation[]}>(`/whatsapp/confirmations/${encodeURIComponent(id)}/${action}`,body,{headers:{authorization:`Bearer ${sessionToken}`}});setItems(data.items);}
    catch(error){setError(report(error));}
    finally{busyRef.current=false;setBusy(false);}
  };
  const awaiting=items.filter(item=>item.status==='Awaiting Retailer');
  const visible=items.filter(item=>`${item.retailer_name} ${item.salesman_name} ${item.draft_id}`.toLowerCase().includes(filter.toLowerCase()));
  return <div className="shortage-register"><Panel title="Retailer confirmation follow-up" eyebrow="Sales ownership / WhatsApp Admin oversight">
    <div className="section-heading"><p><strong>{awaiting.length} awaiting confirmation</strong> / {awaiting.filter(item=>!item.due_at).length} need a date / {awaiting.filter(item=>item.due_at&&Date.parse(item.due_at)<Date.now()).length} overdue</p><button className="ghost-button" disabled={busy} onClick={()=>void refresh()}>Refresh confirmations</button></div>
    <p className="helper-text">All unconfirmed orders stay visible here regardless of age. Sales sets the next follow-up; overdue alerts go to Sales and WhatsApp Admin. Cancellation requires a reason and never cancels an existing sales order.</p>
    {error?<p role="alert">{error}</p>:null}
    {loading?<p role="status">Loading confirmations...</p>:null}
    <div className="form-grid"><label className="wide-field">Find a confirmation<input value={filter} onChange={event=>setFilter(event.target.value)} placeholder="Retailer, Sales owner or order reference" /></label></div>
    {!loading&&!items.length&&!error?<p>No retailer confirmations need follow-up.</p>:null}
    <div className="stacked-sections">{visible.map(item=><ConfirmationCard key={item.draft_id} item={item} busy={busy} act={act}/>)}</div>
  </Panel></div>;
}
