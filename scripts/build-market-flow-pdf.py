"""Generate the current operating flow. Requires reportlab; no production access."""
from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/pdf/aapoorti-delivery-collection-market-flow.pdf'
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

heading(1,'Delivery + collection: full market flow','AAPOORTI B CONNECT | 7 October 2026 | Role-wise operating guide')
flow([
 ('Warehouse','1. Prepare and hand over DCO','Confirm packed SOs, create DCO, select an active agent and confirm physical handover.'),
 ('Delivery agent','2. Record each shop outcome','Delivered, Shop closed, or Returned. One shop outcome never replaces the outcomes of other shops.'),
 ('Agent / Sales','3. Resolve goods and money separately','Record actual receipts or an exact payment promise. Seller decides return approval or retry date.'),
 ('Warehouse / Accounts','4. Receive goods and cash','Warehouse counts returned goods with evidence. Accounts acknowledges cash custody and verifies receipts.'),
 ('System / Admin','5. Verify final closure','All demand, delivery, custody, payment verification and communication obligations must be resolved.'),
])
note('Three separate responsibilities','Goods outcome, customer payment and agent custody must be tracked separately. A delivered order can still have payment pending. A collected cash receipt can still have cash handover pending. A return approval does not restore stock.')
section('Status of this release','New additions: remaining-DCO return drafts and exact-time payment promises through authenticated APIs and WhatsApp commands. Existing product returns, shop-closed retries, warehouse receiving, payment verification and overdue escalation are reused. This guide does not imply that every proposed market branch is already implemented; see page 6.')
heading(2,'At each shop: delivery decisions','Delivery agent owns the report. Sales owns commercial decisions.')
table(['Scenario','Agent action','Required next step'],[
 ('All goods accepted','Delivered + handover photo.','Record payment or an allowed payment promise.'),
 ('Shop closed','Shop closed + visit photo. Keep goods under custody.','Seller chooses a future retry time or authorized return.'),
 ('Partial acceptance / damage','Returned: product, quantity, reason and individual photos. Review and submit.','Seller approves revised bill; collect accepted goods. Return custody remains open.'),
 ('Full order refused','Returned: select every dispatched product and full quantity; record refusal reason and photos.','Seller approves return. Warehouse later counts and receives goods.'),
],[.24,.39,.37])
section('Seller decision','Correction reopens the report for agent edits. Retry requires a future date/time and currently applies to Shop closed. Return approval changes the accepted bill; stock changes only on physical warehouse receipt.')
note('Evidence and permissions','Only the assigned agent edits the report. Only the assigned seller or authorized Admin decides. Warehouse receiving remains scoped to the originating warehouse. Repeated actions cannot duplicate stock or financial records.')
heading(3,'Return the remaining DCO','Bulk action applies only to undelivered goods. Delivered shops and recorded receipts are preserved.')
flow([
 ('Agent','1. Open assigned DCO','Use LIST, select the DCO and review its shops.'),
 ('Agent','2. Draft the remaining returns','Send RETURN DCO task-id | reason. The system creates full-product return drafts for undelivered stops in one transaction.'),
 ('Agent','3. Review each report','Open EXCEPTIONS. Existing shop reports are preserved. Attach product photos, review quantities/reasons and submit each draft.'),
 ('Sales','4. Decide each shop','Authorize return or request corrections. Shop-closed reports may receive a retry date.'),
 ('Agent / Warehouse','5. Handover and receive','Agent uploads warehouse handover evidence. Warehouse records sellable, damaged and missing quantities with product evidence, then confirms receipt.'),
])
note('Whole DCO versus remaining DCO','If no shop has been delivered, this covers the whole DCO. After some deliveries, only the remaining goods are included. Drafting returns does not cancel orders, mark delivery complete, approve returns or restore stock.')
heading(4,'Payment now, partial or later','Record actual money only. A promise is not a receipt.')
table(['Payment outcome','Steps'],[
 ('Full cash','Enter denomination counts and coins, review total, then Confirm cash. Current WhatsApp tolerance is Rs.5 for assigned ordinary delivery collections.'),
 ('UPI received','Record actual received amount and transaction evidence/reference where available; confirm. Accounts verifies actual receipt.'),
 ('Partial payment','If permitted, record the actual receipt. Record an exact promise for the unpaid delivered balance.'),
 ('Evening UPI / pay later','Choose Collect later. Send the displayed PAY LATER command with future IST date/time and reason. Existing retailer permission is required.'),
 ('Payment refused','Do not mark paid. Record the issue with Sales and arrange an authorized follow-up. A dedicated refusal action is not included in this release.'),
],[.29,.71])
section('Exact-time promise command')
note('WhatsApp syntax','PAY LATER task-id order-id YYYY-MM-DD HH:mm | reason<br/>Example time: 2026-10-07 18:00. Times use IST. The command validates agent assignment, delivered unpaid balance, retailer permission and a future time. The promise is persistent; no payment is created.')
section('Follow-up ownership','Sales remains the owner; the reporting agent is assigned as collector. Sales can reassign/reschedule through the finance API. At overdue time, existing durable alerts notify the owner and Admin. A pre-due reminder is not part of this release.')
heading(5,'Handover, verification and closure','The agent visit, DCO route and final customer order have different completion requirements.')
flow([
 ('Agent','1. Finish the visits','Every shop needs a recorded outcome. Later-payment follow-ups remain open separately; returned goods remain under recorded custody.'),
 ('Warehouse','2. Clear goods custody','Receive authorized returns, count conditions and explicitly resolve missing goods. Restore only sellable received stock.'),
 ('Agent / Accounts','3. Clear cash custody','Hand over actual retained cash. Accounts counts and acknowledges physical receipt. UPI is verified against bank receipt.'),
 ('Accounts','4. Reconcile money','Verify submitted receipts, approved adjustments, credit and refunds. Never recollect a submitted receipt without reviewing its status.'),
 ('Admin / System','5. Check final completion','Resolve pending demand, delivery/return, money verification and required notifications. Completed is allowed only after closure checks pass.'),
])
note('WhatsApp list is not financial completion','Paid shops disappear from the pending delivery/collection list. Their Accounts verification and custody obligations remain. A settlement summary is not, by itself, evidence that Accounts received the cash.')
section('Existing test example','SAMAN Dal: Rs.1,933 cash receipt recovered against Rs.1,932.84 bill; Accounts verification and cash handover remain. Ankuj Salt: Rs.212 UPI submitted against Rs.212.40 bill. Final ledger tolerance treatment must be checked separately; collection acceptance does not automatically prove final financial closure.')
heading(6,'Module map and remaining gaps','Use backend APIs on demand; detailed registers are not mounted on WhatsApp Admin Home.')
table(['Module','Entry / responsibility'],[
 ('Delivery exceptions','POST /delivery-dcos/:id/return-remaining with reason; :id is the delivery task ID. Returns draft reports, then existing evidence/submission/approval/receiving endpoints apply.'),
 ('Payment promise','POST /delivery-dcos/:id/payment-promise with orderId, dueAt (ISO timestamp), note. Assigned agent only; persistent follow-up and audit.'),
 ('Collection finance','GET /whatsapp/finance; scheduling/receipt/refund APIs preserve role and retailer scope.'),
 ('Admin oversight','GET /whatsapp/open-cases and /whatsapp/message-failures on demand. Resolve real obligations, not a generic close button.'),
],[.25,.75])
section('Branches that still need implementation or further validation')
table(['Gap','Current behavior / next requirement'],[
 ('Rounded cash and change','Accepting within Rs.5 tolerance is implemented for ordinary assigned collections. A dedicated cash received / change returned confirmation is still pending.'),
 ('Tolerance and final ledger closure','Receipt acceptance and Collected status do not implement an authorized ledger write-off for every small difference. Verify and add the final reconciliation policy.'),
 ('Payment refusal / unauthorized later','Sales escalation is required. A dedicated persisted refusal/approval request branch remains pending.'),
 ('Pre-due reminders','Exact time and overdue escalation exist. A scheduled reminder before the due time remains pending.'),
 ('Retry route completion','Existing shop-closed retry preserves custody. End-to-end new-route reassignment after warehouse receiving needs dedicated validation.'),
],[.30,.70])
note('Release validation','API build passed. 31 isolated PostgreSQL integration tests and 10 WhatsApp collection tests passed, including new remaining-return and payment-promise scenarios. New code must be deployed before the new commands are available live.')

def frame(canvas, doc):
    width,height=A4
    canvas.saveState()
    canvas.setFillColor(TEAL);canvas.rect(0,height-14*mm,width,14*mm,fill=1,stroke=0)
    canvas.setFillColor(colors.white);canvas.setFont('Helvetica-Bold',10)
    canvas.drawString(18*mm,height-9*mm,'AAPOORTI B CONNECT')
    canvas.setFont('Helvetica',8);canvas.drawRightString(width-18*mm,height-9*mm,'WHATSAPP / ORDER OPERATIONS')
    canvas.setStrokeColor(LINE);canvas.line(18*mm,15*mm,width-18*mm,15*mm)
    canvas.setFillColor(GRAY);canvas.setFont('Helvetica',7.5)
    canvas.drawString(18*mm,10*mm,'7 Oct 2026 | Delivery and collection market flow')
    canvas.drawRightString(width-18*mm,10*mm,f'{doc.page} / 6')
    canvas.restoreState()

if __name__=='__main__':
    OUT.parent.mkdir(parents=True,exist_ok=True)
    doc=SimpleDocTemplate(str(OUT),pagesize=A4,rightMargin=18*mm,leftMargin=18*mm,topMargin=22*mm,bottomMargin=22*mm,title='AAPOORTI B CONNECT - Delivery and Collection Market Flow',author='AAPOORTI',subject='Order, exception, return, credit, collection and refund operations')
    doc.build(story,onFirstPage=frame,onLaterPages=frame)
    print(OUT)
