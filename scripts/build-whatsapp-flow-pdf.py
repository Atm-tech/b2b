"""Generate the current operating flow. Requires reportlab; no production access."""
from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/pdf/aapoorti-b-connect-whatsapp-order-flow-updated.pdf'
INK = colors.HexColor('#193B40')
TEAL = colors.HexColor('#087F7A')
MINT = colors.HexColor('#E9F5F2')
GRAY = colors.HexColor('#587074')
LINE = colors.HexColor('#D6E5E4')
AMBER = colors.HexColor('#FFF3DA')
W = 174 * mm
styles = {
    'title': ParagraphStyle('title', fontName='Helvetica-Bold', fontSize=24, leading=28, textColor=INK, spaceAfter=12),
    'sub': ParagraphStyle('sub', fontName='Helvetica', fontSize=10.3, leading=15, textColor=GRAY, spaceAfter=12),
    'h': ParagraphStyle('h', fontName='Helvetica-Bold', fontSize=12.5, leading=16, textColor=TEAL, spaceBefore=12, spaceAfter=7),
    'body': ParagraphStyle('body', fontName='Helvetica', fontSize=9.4, leading=13.4, textColor=INK, spaceAfter=5),
    'small': ParagraphStyle('small', fontName='Helvetica', fontSize=8.4, leading=11.6, textColor=INK),
    'white': ParagraphStyle('white', fontName='Helvetica-Bold', fontSize=8.4, leading=11.6, textColor=colors.white),
    'arrow': ParagraphStyle('arrow', fontName='Helvetica-Bold', fontSize=10, leading=13, textColor=TEAL, alignment=TA_CENTER),
}

def p(text, style='body'):
    return Paragraph(text, styles[style])

story = []
def heading(number, title, subtitle):
    if story:
        story.append(PageBreak())
    story.extend([p(f'OPERATING FLOW / {number:02d}', 'h'), p(title, 'title'), p(subtitle, 'sub')])

def section(title, body=None):
    story.append(p(title, 'h'))
    if body:
        story.append(p(body))

def note(title, text, warning=False):
    table = Table([[p(f'<b>{title}</b><br/>{text}')]], colWidths=[W])
    table.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),AMBER if warning else MINT),('BOX',(0,0),(-1,-1),.5,LINE),('LEFTPADDING',(0,0),(-1,-1),11),('RIGHTPADDING',(0,0),(-1,-1),11),('TOPPADDING',(0,0),(-1,-1),9),('BOTTOMPADDING',(0,0),(-1,-1),6)]))
    story.extend([Spacer(1,6),table,Spacer(1,5)])

def table(headers, rows, widths):
    data = [[p(v,'white') for v in headers]] + [[p(v,'small') for v in row] for row in rows]
    t = Table(data, colWidths=[W*x for x in widths], repeatRows=1, hAlign='LEFT')
    t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),TEAL),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,colors.HexColor('#F4F8F7')]),('VALIGN',(0,0),(-1,-1),'TOP'),('LINEBELOW',(0,0),(-1,-1),.4,LINE),('LEFTPADDING',(0,0),(-1,-1),8),('RIGHTPADDING',(0,0),(-1,-1),8),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6)]))
    story.append(t)

def flow(steps):
    for i,(owner,title,detail) in enumerate(steps):
        t=Table([[p(owner,'white'),p(f'<b>{title}</b><br/>{detail}','small')]],colWidths=[33*mm,W-33*mm])
        t.setStyle(TableStyle([('BACKGROUND',(0,0),(0,0),TEAL),('BACKGROUND',(1,0),(1,0),MINT),('VALIGN',(0,0),(-1,-1),'MIDDLE'),('LEFTPADDING',(0,0),(-1,-1),9),('RIGHTPADDING',(0,0),(-1,-1),9),('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8)]))
        story.append(t)
        if i<len(steps)-1:
            story.append(p('v','arrow'))

heading(1,'WhatsApp order to final closure','AAPOORTI B CONNECT | Updated 19 September 2026<br/>Current operating guide, including stock, returns, credit, refunds and Admin follow-up.')
flow([
 ('Retailer / Sales','1. Submit and review demand','Check products, quantities, rates and stock. Preserve the full requested demand.'),
 ('Sales / Purchaser','2. Resolve shortages','Available now, wait for full supply, or cancel the balance. Keep replenishment and retailer demand linked. See page 2.'),
 ('Retailer','3. Accept current confirmation','Create the sales order (SO) once. No reply remains a dated Sales follow-up.'),
 ('Warehouse','4. Recheck and finalize packing','Verify quantity and weight. Resolve damage, shortage or scale override before dispatch. See page 3.'),
 ('Delivery agent','5. Record delivery outcome','Report closed shop or item-wise returns with photos. Seller approves the revised bill. See page 4.'),
 ('Agent / Warehouse','6. Reconcile goods and collection','Collect only the approved delivered bill balance. Physically receive and inspect returned goods. See page 5.'),
 ('Sales / Accounts','7. Reconcile money','Apply verified credit; track later/partial collection and verification; process requested refunds. See page 6.'),
 ('System / Admin','8. Check final completion','All linked demand, delivery, goods custody, money and notifications must be resolved. See page 7.'),
])
note('Order Created is not Completed','A confirmed SO stays open while any linked obligation remains. Admin can see unresolved cases of every age.')

heading(2,'Stock shortage & retailer confirmation','Sales owns the retailer decision. Purchaser approval never substitutes for retailer acceptance.')
note('Working example','Retailer requests <b>60</b> units. <b>24</b> are available and <b>36</b> are short. Confirm the available portion and communicate the pending portion separately, according to the chosen fulfilment option.')
section('Offer all three choices')
table(['Retailer choice','Available 24','Remaining 36'],[
 ('Available now; balance later','Send confirmation and fulfil after acceptance.','Keep linked pending demand. Confirm after stock becomes available.'),
 ('Wait for all 60','Hold the available portion for the full-order decision.','Replenish, then send confirmation for the complete quantity.'),
 ('Available now; cancel balance','Send confirmation for 24.','Record explicit balance cancellation; no later collection for those units.'),
],[.29,.34,.37])
section('Replenishment branch')
flow([
 ('System','Shortage detected','Create the draft purchase request and alert Purchaser for approval.'),
 ('Purchaser','Approve or cancel procurement','Approve: record supply decision / expected date and track actual receipt. Cancel: return the demand decision to Sales.'),
 ('Sales / System','Resolve and release the pending portion','Confirm only stock that is received and available. Keep every released portion linked to the original demand.'),
])
section('If the retailer does not respond')
story.append(p('Keep <b>Awaiting Retailer</b> visible. Sales sets a future follow-up date and note, resends with a new date, or explicitly cancels the unconfirmed portion with a reason. Overdue alerts go to Sales and WhatsApp Admin. There is no automatic cancellation.'))
note('Collection boundary','Delivery of 24 creates a bill for 24. The other 36 are collected on their later delivery, if supplied. Cancelling a supplier PO does not silently cancel retailer demand.',True)

heading(3,'Packing: recheck before override','Warehouse records the facts; Sales resolves commercial changes; the retailer accepts the revised bill.')
flow([
 ('Warehouse','1. Select Recheck','Record actual product quantities, measured weight and missing/damaged reasons. Packing and dispatch stay on hold.'),
 ('Warehouse / Admin','2. Resolve the measurement issue','Recount or reweigh first. A broken scale or out-of-tolerance weight requires WhatsApp Admin override with a reason.'),
 ('Sales','3. Decide the quantity change','Keep the short balance pending or explicitly cancel it. Prepare the revised bill; an override alone does not approve a quantity change.'),
 ('Retailer','4. Accept the current amendment','Accept the proposed revised bill. Rejection returns the case to Sales for correction or another recheck.'),
 ('Warehouse','5. Review and confirm finalization','After required approvals, finalize quantities, proportional discounts/tax, ledger and dispatch dockets together.'),
])
section('What happens to the balance?')
table(['Finding','Recorded outcome'],[
 ('Missing or damaged stock','Hold the affected stock from reuse. Do not create sellable stock from a billing reduction.'),
 ('Balance kept pending','Create a linked balance draft; it remains part of final-order closure.'),
 ('Balance cancelled','Keep the cancelled quantity and reason in history.'),
 ('Prepaid bill reduced','Verify the payment, retain excess as retailer ledger credit, then reconcile the packing financial review.'),
],[.30,.70])
note('Final confirmation is required','Warehouse explicitly finalizes the review. Old acceptance buttons and replayed finalization cannot apply an older bill or create duplicate dispatch records.')

heading(4,'At the shop: report, approve, collect','The agent can report through WhatsApp or BConnect. Seller decisions are available through either channel.')
flow([
 ('Delivery agent','1. Open the assigned delivery stop','Choose Shop closed or Returned. For returns, select products, quantities and reasons, including Other.'),
 ('Delivery agent','2. Attach evidence and review','Closed shop: visit photo. Returned/damaged stock: photo for every selected product. Edit the draft before confirming.'),
 ('Delivery agent','3. Confirm and send to seller','Submission locks the report. The seller may request a correction, approve the return, or schedule a dated retry for a closed shop.'),
 ('Seller','4. Review the accepted goods and revised bill','Approval immediately updates accepted quantities and the invoice. Pending approval blocks collection against that stop.'),
 ('Delivery agent','5. Collect the adjusted outstanding balance now','Deduct existing receipts and applied credit. Collect for accepted delivered goods only; submit the receipt for Accounts verification.'),
])
section('The two remaining goods paths')
table(['Seller decision','Next path','Case stays open until'],[
 ('Retry a closed shop','Record the next delivery date and carry the goods under assigned custody.','Successful delivery or a completed physical return.'),
 ('Approve item/full return','Present goods at the warehouse with handover evidence.','Warehouse inspection and financial reconciliation finish.'),
],[.24,.42,.34])
note('No waiting for warehouse receipt to amend the collection','Seller approval unlocks the adjusted bill at the shop. A full return has a zero delivery bill. Stock is restored only after the later physical warehouse receipt.',True)
story.append(p('<b>WhatsApp entry:</b> open the assigned stop or use EXCEPTIONS for existing reports. The approved-bill notification supplies the collection action. Provider delivery delays remain tracked as message failures.','small'))

heading(5,'Return custody & warehouse evidence','Seller approval changes billing. Warehouse Manager confirmation changes physical stock.')
flow([
 ('Delivery agent','1. Present the goods','Upload a warehouse handover photo and confirm presentation. The agent retains custody until Warehouse Manager receipt.'),
 ('Warehouse Manager','2. Count every returned product','Record sellable, damaged and missing quantities against the authorized return. Add receiving/condition photos for every product.'),
 ('Warehouse Manager','3. Save, review and decide','Recount any excess quantity. Record findings and explicitly resolve missing units where applicable.'),
 ('Warehouse Manager','4. Confirm physical receipt','Create linked return records once. Restore sellable stock; block damaged stock. Do not credit the already-amended bill again.'),
 ('System / Accounts','5. Reconcile the financial status','Close the return after receipt and financial checks. Otherwise retain Warehouse Received for collection, verification or refund follow-up.'),
])
section('Stock disposition example')
table(['Authorized return: 10','Stock result','Required record'],[
 ('7 sellable','7 units become available.','Receiving count and product photo.'),
 ('2 damaged','2 units remain blocked.','Condition findings and damage evidence.'),
 ('1 missing','No stock restoration for the missing unit.','Explicit Warehouse Manager missing-unit decision.'),
],[.29,.31,.40])
note('Who can finalize?','The Warehouse Manager must be scoped to the originating warehouse and a WhatsApp-origin order. An Admin role alone does not authorize physical receipt. Non-WhatsApp SOs remain hidden from Warehouse Manager access.')
story.append(p('Evidence and final counts are retained with the case. Repeated confirmation cannot restore stock twice. Financial follow-up remains visible to the responsible staff and WhatsApp Admin.','small'))

heading(6,'Credit, later collection & refunds','Money already received is counted once. A pending product quantity is not an amount due today.')
section('A. Verified advance becomes retailer credit')
note('Rs.1,000 paid; final delivered bill Rs.700','Retain <b>Rs.300</b> as retailer ledger credit. Automatically apply available credit to the oldest delivered unpaid bill first, then a dispatched bill. A later bill of Rs.500 therefore requires only <b>Rs.200</b> additional collection if the full Rs.300 remains available.')
story.append(p('Unverified excess cannot be spent. Credit transfers are recorded separately from actual cash/UPI receipts. Pending or booked balance demand receives no allocation. Documented unused credit can remain in the ledger after the original order is completed.'))
section('B. Delivered goods with later or partial payment')
flow([
 ('Sales','Create and own the follow-up','A delivered stop with a balance or verification pending stays tracked, even if the rest of the route is unfinished. Default deadline: next day.'),
 ('Sales / Collector','Assign, schedule and collect','Sales can assign an active collector and change the date with a note. Record the actual receipt against the delivered order; overdue cases alert the owner and Admin.'),
 ('Accounts','Verify the receipt','Submitted receipts reduce the amount to collect but do not complete verification. A zero collection balance can still mean verification pending.'),
])
section('C. Refund only when the retailer requests it')
table(['Stage','Owner / required action'],[
 ('Request','Record amount and retailer request. Reserve the available credit against further spending.'),
 ('Approve / reject','Seller records the decision. A requested or approved refund may be cancelled before payout.'),
 ('Record payout','Accounts records the completed payment reference and evidence. A paid refund cannot be cancelled.'),
 ('Verify and close','Accounts verifies the payout. Only verified refunds reduce ledger credit; WhatsApp Admin can perform these actions.'),
],[.25,.75])
story.append(Spacer(1,8))
story.append(p('<b>Controls:</b> receipt references and refund request keys prevent replay; concurrent credit/refund actions cannot spend the same balance twice. An open refund blocks final completion. Reconciliation problems stay visible for staff action.','small'))

heading(7,'Admin oversight & the closure gate','Use WhatsApp Admin Home for All unresolved cases. Old work stays visible without the normal seven-day order filter.')
section('Who owns the next step?')
table(['Role','Operational responsibility'],[
 ('Sales / seller','Retailer confirmation and shortage choices; commercial amendments; return/refund approval; collection ownership.'),
 ('Purchaser','Purchase approval/cancellation and replenishment. Supplier cancellation never closes retailer demand.'),
 ('Delivery / collector','Assigned visits, product return reports and photos, custody/handover, and actual collection receipts.'),
 ('Warehouse Manager','WhatsApp packing and rechecks; return photos, count/condition decisions and physical receipt.'),
 ('Accounts','Payment verification, refund payout records and refund verification. Credit is reconciled in the retailer ledger.'),
 ('WhatsApp Admin','All-age case monitoring, owner/deadline/next-action assignment, escalations and permitted overrides.'),
],[.25,.75])
section('WhatsApp failure is a tracked branch')
story.append(p('Messages enter a persistent retry queue. After five failed attempts, staff can retry later or save a manual follow-up note. Only failed messages show the fallback prompt. A note alone does not resolve delivery: staff must explicitly confirm communication through another channel. Message retry never creates another SO or payment.'))
note('Failure-only prompt','WhatsApp delivery failed. Record a manual follow-up note and retry later.')
section('Final completion requires every check')
table(['Check','Required outcome'],[
 ('Demand and delivery','Every linked portion is delivered or explicitly cancelled; no unresolved stock, confirmation or packing balance.'),
 ('Physical goods','Returned goods are received and counted; damaged/missing goods have a recorded disposition.'),
 ('Money','Delivered bills are settled and verified; credit is documented; no open refund or ledger mismatch.'),
 ('Communication','Required notifications are sent or explicitly resolved through confirmed manual communication.'),
],[.25,.75])
story.append(Spacer(1,8))
story.append(p('<b>Result:</b> Complete only after every check passes; later failures can reopen it. Queue assignment never bypasses closure. Finance: BConnect Overview/Ledger. Assigned collectors: Overview/Current Delivery.','small'))

def frame(canvas, doc):
    width,height=A4
    canvas.saveState()
    canvas.setFillColor(TEAL);canvas.rect(0,height-14*mm,width,14*mm,fill=1,stroke=0)
    canvas.setFillColor(colors.white);canvas.setFont('Helvetica-Bold',10)
    canvas.drawString(18*mm,height-9*mm,'AAPOORTI B CONNECT')
    canvas.setFont('Helvetica',8);canvas.drawRightString(width-18*mm,height-9*mm,'WHATSAPP / ORDER OPERATIONS')
    canvas.setStrokeColor(LINE);canvas.line(18*mm,15*mm,width-18*mm,15*mm)
    canvas.setFillColor(GRAY);canvas.setFont('Helvetica',7.5)
    canvas.drawString(18*mm,10*mm,'Updated 19 Sep 2026 | Operating rules through release 9493ad5')
    canvas.drawRightString(width-18*mm,10*mm,f'{doc.page} / 7')
    canvas.restoreState()

if __name__=='__main__':
    OUT.parent.mkdir(parents=True,exist_ok=True)
    doc=SimpleDocTemplate(str(OUT),pagesize=A4,rightMargin=18*mm,leftMargin=18*mm,topMargin=22*mm,bottomMargin=22*mm,title='AAPOORTI B CONNECT - Updated WhatsApp Order Flow',author='AAPOORTI',subject='Order, exception, return, credit, collection and refund operations')
    doc.build(story,onFirstPage=frame,onLaterPages=frame)
    print(OUT)
