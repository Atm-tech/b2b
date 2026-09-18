import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import type { AppSnapshot } from '@aapoorti-b2b/domain';
import { api, formatDateTimeIst } from '../../app/shared';
import { Panel } from '../../components/ui';
type Line={id:string;product_sku:string;product_name:string;quantity:number;total_amount:number};
type Review={id:string;cart_id:string;warehouse_id:string;retailer_name:string;salesman_name:string;status:string;revision:number;original_json:Line[];report_json?:{changed:boolean;machineBroken:boolean;lines:Array<{id:string;quantity:number;issue:string}>};reason:string;expected_weight:number;measured_weight?:number;override_reason:string;override_approved_by?:string;balance_choice?:string;balance_draft_id?:string;proposed_total?:number;credit_amount:number;failed_notifications:number;events:Array<{id:number;action:string;actor:string;note:string;created_at:string}>};
type Register={cases:Review[];canWarehouse:boolean;canSales:boolean;canOverride:boolean};
type Act=(id:string,action:string,body:Record<string,unknown>)=>Promise<void>;
function PackingCard({item,permissions,busy,act}:{item:Review;permissions:Register;busy:boolean;act:Act}) {
  const [quantities,setQuantities]=useState<Record<string,string>>({});const [issues,setIssues]=useState<Record<string,string>>({});const [weight,setWeight]=useState('');const [broken,setBroken]=useState(false);const [note,setNote]=useState('');const [balance,setBalance]=useState('Pending');
  return <article className="panel shortage-card">
    <div className="section-heading"><div><span className="eyebrow">{item.warehouse_id} / {item.cart_id}</span><h3>{item.retailer_name}</h3></div><span className="status-pill pending">{item.status}</span></div>
    <p><strong>Sales owner:</strong> {item.salesman_name} / <strong>Review:</strong> {item.id}</p>
    <div className="table-wrap"><table><thead><tr><th>Product</th><th>Ordered</th><th>Recounted</th><th>Finding</th></tr></thead><tbody>{item.original_json.map(line=>{const reported=item.report_json?.lines.find(next=>next.id===line.id);return <tr key={line.id}><td>{line.product_name}<small>{line.product_sku}</small></td><td>{line.quantity}</td><td>{reported?.quantity??'Recheck required'}</td><td>{reported?.issue||'-'}</td></tr>;})}</tbody></table></div>
    <p>Expected weight: {Number(item.expected_weight).toFixed(3)} kg / Recorded weight: {item.measured_weight==null?'Unavailable':`${Number(item.measured_weight).toFixed(3)} kg`}</p>
    {item.reason?<p><strong>Warehouse finding:</strong> {item.reason}</p>:null}
    {item.override_approved_by?<p><strong>Weight override approved by {item.override_approved_by}:</strong> {item.override_reason}</p>:null}
    {item.proposed_total!=null?<p><strong>{['Finalized','Financial Review'].includes(item.status)?'Final bill':'Proposed bill'}:</strong> Rs.{Number(item.proposed_total).toFixed(2)}{item.balance_choice?` / Unavailable balance: ${item.balance_choice}`:''}</p>:null}
    {item.balance_draft_id?<p>Linked pending order: {item.balance_draft_id}</p>:null}
    {item.credit_amount>0?<p role="alert">Rs.{Number(item.credit_amount).toFixed(2)} requires Accounts credit/refund review. It has not been refunded automatically.</p>:null}
    {item.status==='Recheck Required'&&permissions.canWarehouse?<form className="form-grid" onSubmit={event=>{event.preventDefault();void act(item.id,'report',{weight:broken?null:Number(weight),machineBroken:broken,reason:note,lines:item.original_json.map(line=>{const quantity=Number(quantities[line.id]??line.quantity);return {id:line.id,quantity,issue:quantity<line.quantity?(issues[line.id]||'Missing'):'None'};})});}}>
      <p className="helper-text wide-field">Recount every item first. Record sellable quantity only; identify missing or damaged units. The current bill stays unchanged until approvals and final confirmation.</p>
      {item.original_json.map(line=><div className="form-grid wide-field" key={line.id}><label>{line.product_name}: recounted quantity<input required type="number" min="0" max={line.quantity} step="any" value={quantities[line.id]??String(line.quantity)} onChange={event=>setQuantities(current=>({...current,[line.id]:event.target.value}))}/></label><label>Reason for reduction<select value={issues[line.id]||'Missing'} disabled={Number(quantities[line.id]??line.quantity)>=line.quantity} onChange={event=>setIssues(current=>({...current,[line.id]:event.target.value}))}><option>Missing</option><option>Damaged</option></select></label></div>)}
      <label className="checkbox-line packing-machine-choice"><input type="checkbox" checked={broken} onChange={event=>setBroken(event.target.checked)}/> Weighing machine unavailable or faulty</label>
      <label>Rechecked weight (kg)<input type="number" min="0" step="0.001" required={!broken} disabled={broken} value={weight} onChange={event=>setWeight(event.target.value)}/></label>
      <label className="wide-field">Warehouse answer / reason<input required value={note} onChange={event=>setNote(event.target.value)} placeholder="Describe the recount, damage, shortage or machine problem"/></label>
      <button className="primary-button" disabled={busy}>Submit recheck findings</button>
    </form>:null}
    {((item.status==='Override Approval Required'&&permissions.canOverride)||(item.status==='Sales Review Required'&&permissions.canSales))?<div className="form-grid">
      <label className="wide-field">Decision reason<input value={note} onChange={event=>setNote(event.target.value)}/></label>
      {item.status==='Override Approval Required'?<><p className="helper-text wide-field">This approves the recorded weight exception only. Reduced quantities still require Sales review and retailer acceptance.</p><button className="primary-button" disabled={busy||!note.trim()} onClick={()=>void act(item.id,'override',{note})}>Approve weight override</button></>:<><label>Unavailable quantity<select value={balance} onChange={event=>setBalance(event.target.value)}><option value="Pending">Keep as linked pending order</option><option value="Cancel">Cancel unavailable quantity</option></select></label><button className="primary-button" disabled={busy||!note.trim()} onClick={()=>void act(item.id,'propose',{note,balance})}>Send revised bill for retailer acceptance</button></>}
    </div>:null}
    {permissions.canSales&&!['Recheck Required','Finalized','Financial Review'].includes(item.status)?<div className="form-grid"><label>Reason for another recheck<input value={note} onChange={event=>setNote(event.target.value)}/></label><button className="ghost-button" disabled={busy||!note.trim()} onClick={()=>void act(item.id,'recheck',{note})}>Request another recheck</button></div>:null}
    {item.status==='Awaiting Retailer'?<p role="status">Packing is on hold until the retailer accepts the proposed quantities and bill in WhatsApp.</p>:null}
    {item.status==='Ready to Finalize'&&permissions.canWarehouse?<><p className="helper-text">Recheck and approvals are complete. Final confirmation updates the bill, records unavailable stock, creates any linked pending order and prepares dispatch dockets together.</p><button className="primary-button" disabled={busy} onClick={()=>void act(item.id,'finalize',{})}>Confirm and finalize packing</button></>:null}
    {item.failed_notifications>0?<p role="alert">{item.failed_notifications} notification(s) failed. {permissions.canSales?<button className="ghost-button" disabled={busy} onClick={()=>void act(item.id,'retry',{note:'Retry packing review notifications'})}>Retry notifications</button>:null}</p>:null}
    <details><summary>Review history ({item.events.length})</summary><ul>{item.events.map(event=><li key={event.id}><strong>{event.action}</strong> / {event.actor} / {formatDateTimeIst(event.created_at)} — {event.note}</li>)}</ul></details>
  </article>;
}
export function PackingRegister({snapshot,sessionToken}:{snapshot:AppSnapshot;sessionToken:string}) {
  const [register,setRegister]=useState<Register>({cases:[],canWarehouse:false,canSales:false,canOverride:false});const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [loading,setLoading]=useState(true);const [cart,setCart]=useState('');const [filter,setFilter]=useState('');const sequence=useRef(0);const busyRef=useRef(false);
  const message=(error:unknown)=>axios.isAxiosError(error)?String(error.response?.data?.message||error.message):error instanceof Error?error.message:'The action could not be completed.';
  const refresh=useCallback(async()=>{if(busyRef.current)return;const current=++sequence.current;try{const {data}=await api.get<Register>('/whatsapp/packing-reviews',{headers:{authorization:`Bearer ${sessionToken}`}});if(current===sequence.current){setRegister(data);setError('');}}catch(error){if(current===sequence.current)setError(message(error));}finally{if(current===sequence.current)setLoading(false);}},[sessionToken]);
  useEffect(()=>{void refresh();const timer=window.setInterval(()=>void refresh(),30_000);return()=>{window.clearInterval(timer);sequence.current++;};},[refresh]);
  const act:Act=async(id,action,body)=>{busyRef.current=true;setBusy(true);++sequence.current;try{const {data}=await api.post<Register>(`/whatsapp/packing-reviews/${encodeURIComponent(id)}/${action}`,body,{headers:{authorization:`Bearer ${sessionToken}`}});setRegister(data);setError('');}catch(error){setError(message(error));}finally{busyRef.current=false;setBusy(false);}};
  const orders=Array.from(new Map(snapshot.salesOrders.filter(order=>order.status==='Booked'&&order.deliveryMode==='Delivery'&&order.note.startsWith('WhatsApp confirmed order WAD-')&&!snapshot.deliveryDockets.some(docket=>docket.salesOrderId===order.id)&&!register.cases.some(item=>item.cart_id===(order.cartId||order.id))).map(order=>[order.cartId||order.id,order])).entries());
  const visible=register.cases.filter(item=>`${item.cart_id} ${item.retailer_name} ${item.status}`.toLowerCase().includes(filter.toLowerCase()));
  return <div className="shortage-register"><Panel title="Packing rechecks" eyebrow="Warehouse findings / Sales review / Admin oversight">
    <div className="section-heading"><p><strong>{register.cases.length} reviews requiring attention</strong></p><button className="ghost-button" disabled={busy} onClick={()=>void refresh()}>Refresh packing reviews</button></div>
    <p className="helper-text">Recheck first, record the warehouse findings, approve any exception, then confirm and finalize. Open reviews remain visible regardless of order date.</p>
    {error?<p role="alert">{error}</p>:null}{loading?<p role="status">Loading packing reviews...</p>:null}
    {register.canWarehouse?<div className="form-grid"><label>Start a recheck<select value={cart} onChange={event=>setCart(event.target.value)}><option value="">Select an unpacked WhatsApp order</option>{orders.map(([id,order])=><option key={id} value={id}>{order.shopName} / {id}</option>)}</select></label><button className="ghost-button" disabled={busy||!cart} onClick={()=>void act(cart,'open',{})}>Recheck selected order</button></div>:null}
    <div className="form-grid"><label className="wide-field">Find a packing review<input value={filter} onChange={event=>setFilter(event.target.value)} placeholder="Retailer, SO reference or status"/></label></div>
    {!loading&&!register.cases.length&&!error?<p>No open packing reviews.</p>:null}
    <div className="stacked-sections">{visible.map(item=><PackingCard key={`${item.id}:${item.revision}`} item={item} permissions={register} busy={busy} act={act}/>)}</div>
  </Panel></div>;
}
