from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output" / "pdf"
OUT.mkdir(parents=True, exist_ok=True)

GREEN = colors.HexColor("#087f73")
NAVY = colors.HexColor("#183653")
MINT = colors.HexColor("#e6f5f1")
PALE = colors.HexColor("#f7fbfa")
ORANGE = colors.HexColor("#fff1d7")
RED = colors.HexColor("#fff0ef")

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name="CoverTitle", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=26, leading=31, textColor=NAVY, spaceAfter=10))
styles.add(ParagraphStyle(name="CoverSub", parent=styles["BodyText"], fontName="Helvetica", fontSize=12, leading=17, textColor=colors.HexColor("#506d7b")))
styles.add(ParagraphStyle(name="Section", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=15, leading=19, textColor=NAVY, spaceBefore=12, spaceAfter=7))
styles.add(ParagraphStyle(name="Body2", parent=styles["BodyText"], fontName="Helvetica", fontSize=10.3, leading=14.5, textColor=colors.HexColor("#203b52"), spaceAfter=5))
styles.add(ParagraphStyle(name="Tiny", parent=styles["BodyText"], fontName="Helvetica", fontSize=8.5, leading=11, textColor=colors.HexColor("#55717b")))
styles.add(ParagraphStyle(name="Step", parent=styles["BodyText"], fontName="Helvetica", fontSize=10.5, leading=15, textColor=colors.HexColor("#183653")))
styles.add(ParagraphStyle(name="Say", parent=styles["BodyText"], fontName="Helvetica-Oblique", fontSize=10.1, leading=14, textColor=colors.HexColor("#5b4220")))

def footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(colors.HexColor("#d6e8e3"))
    canvas.line(18*mm, 14*mm, 192*mm, 14*mm)
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#55717b"))
    canvas.drawString(18*mm, 9.5*mm, "AAPOORTI B CONNECT - Training script")
    canvas.drawRightString(192*mm, 9.5*mm, f"Page {doc.page}")
    canvas.restoreState()

def para(text, style="Body2"):
    return Paragraph(text.replace("&", "&amp;"), styles[style])

def checklist(items, fill=PALE):
    data = [[para(f"<b>{idx + 1}.</b> {item}", "Step")] for idx, item in enumerate(items)]
    table = Table(data, colWidths=[174*mm], hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), fill),
        ("BOX", (0, 0), (-1, -1), 0.4, colors.HexColor("#cfe3dd")),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#dcece8")),
        ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    return table

def callout(title, text, tone="note"):
    fill = ORANGE if tone == "warn" else RED if tone == "stop" else MINT
    edge = colors.HexColor("#dca84a") if tone == "warn" else colors.HexColor("#db766f") if tone == "stop" else colors.HexColor("#87c9bd")
    tab = Table([[para(f"<b>{title}</b><br/>{text}", "Body2")]], colWidths=[174*mm])
    tab.setStyle(TableStyle([("BACKGROUND", (0,0),(-1,-1),fill), ("BOX", (0,0),(-1,-1),0.6,edge), ("LEFTPADDING",(0,0),(-1,-1),9), ("RIGHTPADDING",(0,0),(-1,-1),9), ("TOPPADDING",(0,0),(-1,-1),8), ("BOTTOMPADDING",(0,0),(-1,-1),8)]))
    return tab

def title_page(title, role, goal, first_sentence):
    return [Spacer(1, 28*mm), para("AAPOORTI WHOLESALE", "Tiny"), Spacer(1, 4*mm), para(title, "CoverTitle"), para(role, "CoverSub"), Spacer(1, 12*mm), callout("Aaj ka target", goal), Spacer(1, 8*mm), para("Trainer ko bolna hai", "Section"), para(f'"{first_sentence}"', "Say"), Spacer(1, 10*mm), para("Rule: har step ke baad screen par dekh kar bolo - Done. Samajh na aaye to ruk jao, galat button mat dabao.", "Body2"), PageBreak()]

def make_pdf(filename, title, role, goal, first_sentence, blocks):
    story = title_page(title, role, goal, first_sentence)
    for heading, intro, steps, note in blocks:
        story += [para(heading, "Section"), para(intro)]
        if steps:
            story += [checklist(steps), Spacer(1, 6*mm)]
        if note:
            kind, note_title, note_text = note
            story += [callout(note_title, note_text, kind), Spacer(1, 6*mm)]
    story += [Spacer(1, 4*mm), callout("Training complete", "Trainer ke saamne ek sample transaction karke dikhao. Galti ho to note banao; khud se delete ya final cancel mat karo.")]
    doc = SimpleDocTemplate(str(OUT / filename), pagesize=A4, rightMargin=18*mm, leftMargin=18*mm, topMargin=17*mm, bottomMargin=20*mm, title=title, author="Aapoorti B CONNECT")
    doc.build(story, onFirstPage=footer, onLaterPages=footer)

make_pdf("01_Admin_User_Registration.pdf", "ADMIN - USER REGISTRATION", "For: WhatsApp Admin / Main Admin", "Har staff ka correct role, mobile number aur warehouse scope record hona chahiye.", "Pehle user banao, phir role do. Galat role dena galat password dene se bhi zyada dangerous hai.", [
    ("Before you start", "Ek list haath mein rakho: staff name, mobile, role, warehouse, and temporary password.", ["Login as Admin or WhatsApp Admin.", "WhatsApp Wholesale kholo, phir Team tab kholo.", "Staff ke paas uska own WhatsApp number hona chahiye."], ("warn", "Do not guess", "Mobile number ya role guess karke mat bharo. Staff se confirm karke hi save karo.")),
    ("Create one user", "Har employee ke liye same script follow karo.", ["Name mein staff ka poora naam likho.", "Username simple likho, jaise sales.raj ya warehouse.panvel.", "WhatsApp number country code ke saath likho: 919xxxxxxxxx.", "Operational role select karo: Sales, Purchaser, Warehouse Manager, Delivery, ya Collection Agent.", "Warehouse select karo. Ek hi wholesale warehouse hai to wahi select karo.", "Temporary password do aur Create operational user dabao.", "Directory mein name aur mobile dikh raha hai, tab hi next user banao."], ("note", "What to say", "Aapka login ban gaya hai. Password pehle login ke baad safe jagah rakhiye. Kisi aur ko share mat kariye.")),
    ("Role check", "User ko sirf uska kaam dikhna chahiye.", ["Sales user ko Sales, Sales Orders aur WhatsApp chat dikhna chahiye.", "Warehouse Manager ko Warehouse IN and OUT dikhna chahiye.", "Delivery + Collection agent ko Current Delivery aur collection actions dikhne chahiye.", "Purchaser ko Purchase module dikhna chahiye."], ("stop", "If wrong module appears", "User se kaam mat karvao. Admin ko bolo and role correct karvao.")),
])

make_pdf("02_Purchase_User_Guide.pdf", "PURCHASE - SIMPLE GUIDE", "For: Purchaser", "Supplier se PO banana aur supplier delivery/pickup ko clearly record karna.", "Purchase ka kaam stock lena nahi hai. Aap PO banate ho; warehouse baad mein inward receive karta hai.", [
    ("Make a purchase order", "Supplier, product, quantity, rate aur warehouse carefully choose karo.", ["Purchase kholo.", "Supplier search karke select karo.", "Warehouse select karo.", "Product search karo, quantity aur purchase rate bharo.", "MRP/GST verify karo.", "Aur product ho to Add item karke next line banao.", "Delivery mode choose karo: Dealer Delivery ya Self Collection.", "Save / Create PO karo and PO number likh lo."], ("warn", "Before final save", "Rate aur quantity supplier confirmation ke bina final mat karo.")),
    ("After PO", "PO ka kaam warehouse ke paas jayega.", ["PO ke last 4 digits warehouse ko batao.", "Supplier delivery aaye to warehouse ko bolo IN mein PO open kare.", "Self Collection ho to delivery side pickup flow follow karega.", "PO ka physical maal aane se pehle received mat bolo."], ("note", "Remember", "Purchaser PO banata hai. Warehouse photo, weight aur actual received quantity record karta hai.")),
    ("If supplier sends less material", "Partial receipt warehouse ke saamne hoga.", ["Supplier ko call karke short quantity confirm karo.", "Warehouse item-wise actual quantity enter karega.", "Open PO active rahega jab tak remaining material pending hai.", "New PO bina zarurat mat banao."], None),
])

make_pdf("03_Sales_User_Guide.pdf", "SALES - RETAILER ORDER GUIDE", "For: Salesperson", "Retailer ka order sahi product, right quantity aur right rate ke saath book karna.", "Pehle retailer suno. Phir screen par order repeat karke confirm karo.", [
    ("Create a sales order", "One retailer, one cart. Sab products ek hi order mein add karo.", ["Sales kholo.", "Retailer search karke select karo.", "Warehouse Wholesale Warehouse hi check karo.", "Product search karo and correct pack/size choose karo.", "Quantity enter karo. MOQ se kam ho to retailer ko batao.", "Rate screen par check karo. CD/TOD only when approved.", "Aur product ho to Add item karo.", "Payment mode aur delivery mode select karo.", "Submit karke SO number note karo."], ("warn", "Never do this", "Retailer ke bolne par random rate ya discount enter mat karo. Approval ke bina rate change nahi.")),
    ("WhatsApp order / chat", "Chat retailer ka support channel hai; order context wahi se create ho sakta hai.", ["WhatsApp Wholesale kholo, Chats tab kholo.", "Retailer ka message padho, reply do.", "Order create karna ho to Create order use karo.", "Required product aur quantity type karvao; rate change request accept mat karo.", "Proforma send hone ke baad retailer confirmation ka wait karo."], ("note", "What to say", "Aap required quantity type karein. Final stock aur rate confirmation ke baad order process hoga.")),
    ("Handover to warehouse", "Confirmed SO warehouse OUT queue mein dikhega.", ["SO ke last 4 digits warehouse ko do.", "Customer delivery address and payment mode check karo.", "Order ready hai ya not, warehouse/delivery screen se status dekho.", "Retailer ko only confirmed information do."], None),
])

make_pdf("04_Warehouse_IN_OUT_Guide.pdf", "WAREHOUSE - WHATSAPP IN / OUT", "For: Warehouse Manager", "WhatsApp se stock inward, sales dispatch aur DCO banana. Har action ka actual record B CONNECT mein banta hai.", "Apne registered WhatsApp se command type karo: IN, OUT, READY aur DCO.", [
    ("IN - purchase stock receive", "Purchase ka maal aaya? Warehouse WhatsApp par active PO dekho aur actual receipt record karo.", ["Apne registered WhatsApp se IN type karo.", "PO list mein supplier aur last 6 digits check karo: IN 482516 type kar sakte ho.", "Weight photo WhatsApp par bhejo.", "Type karo: RECEIVE 482516 SKU 12 8.4. SKU, actual quantity aur gross weight likho.", "System receipt aur stock record karega.", "Kam maal ho to actual received quantity hi type karo; PO pending rahega."], ("warn", "Photo and actual quantity", "Photo ke bina RECEIVE nahi karna. Supplier invoice quantity ko actual received quantity mat samjho.")),
    ("SO packing, DCO and handover", "Warehouse outbound WhatsApp flow: SO select karo, weight photo verify karo, phir packed SO ko DCO mein bundle karke agent ko handover karo.", ["SO type karo. List mein dispatch-ready sales order select karo.", "Order ki product list dekho. Packed weight photo bhejo.", "System photo se visible scale weight read karke expected weight aur tolerance se compare karega.", "Weight match ho to Packed dabao. Mismatch ho to Change dabao, product select karo aur CHANGE SO SKU newqty type karo. Qty 0 se product remove hoga.", "DCO type karo. Packed SO ek-ek karke select karo, Add another se multiple SO jodo, phir Create DCO dabao.", "Delivery + Collection agent select karo. DCO ready rahega, lekin agent ko abhi visible nahi hoga.", "Physical bundle agent ko dene ke baad type karo: HANDOVER 482516. Multiple DCO ke liye comma use karo.", "Reply mein handover success check karo; tab agent ko WhatsApp message aur LIST task milega."], ("stop", "Do not dispatch", "Weight mismatch, wrong retailer, wrong quantity, ya different warehouse orders ko ek DCO mein mat bhejo.")),
    ("End of shift", "Day end par queue clear check karo.", ["IN pending, partial POs aur OUT ready dockets dekho.", "DCO list aur assigned delivery agent verify karo.", "Koi physical stock difference ho to note bana kar admin ko bhejo."], None),
])

make_pdf("05_Delivery_Collection_Guide.pdf", "DELIVERY + COLLECTION - WHATSAPP", "For: One Delivery and Collection Agent", "WhatsApp par assigned DCO dekhna, proof ke saath delivery karna aur permitted collection record karna.", "Aap ek hi agent ho. LIST se shuru karo; delivery ke baad buttons follow karo.", [
    ("Start delivery from WhatsApp", "Sirf apne registered WhatsApp number se kaam karo.", ["WhatsApp chat mein LIST type karo.", "DCO select karo; phir retailer list khulegi.", "Retailer select karke address, contact aur order amount check karo.", "Stock handover karne ke baad Done dabao.", "Parcel ke saath clear delivery photo isi chat mein bhejo.", "System privilege ke hisaab se collection buttons bhejega."], ("warn", "Proof is compulsory", "Photo ke bina next collection step nahi khulega. Photo mein parcel aur shop context clear hona chahiye.")),
    ("Collection from WhatsApp", "Buttons sirf retailer ke approved privileges ke hisaab se dikhte hain.", ["Allowed ho to Collect now ya Collect later choose karo.", "Collect now par Full/Partial sirf approved retailer ke liye aayega.", "Cash/UPI/Cheque options mein cheque sirf privileged retailer ko milega.", "Cash: system Rs.500, Rs.200, Rs.100, Rs.50, Rs.20, Rs.10 aur coins ek-ek karke poochega. Sirf quantity likho, total check karo aur Confirm cash dabao.", "UPI: QR aayega; payment proof photo bhejo, phir Confirm amount button dabao.", "Cheque: cheque photo bhejo, phir Confirm amount button dabao.", "System amount aur tolerance check karke collection record karega."], ("stop", "Money safety", "Short cash, unauthorised cheque ya proof missing ho to collection record mat karo; Contact WhatsApp Admin.")),
    ("Office settlement", "Office pahunchne par aaj ka collection tally karo.", ["SUM type karo: last settlement ke baad Cash, UPI, Cheque aur grand total milega.", "LIST COLLECTION type karo: retailer-wise amount aur MOP milega.", "Cash/UPI slips tally karo.", "Sab sahi ho to Settle button dabao.", "Agla SUM sirf is settlement ke baad ki nayi collection dikhayega."], None),
])

make_pdf("06_Accounts_Guide.pdf", "ACCOUNTS - CHECK AND CLOSE GUIDE", "For: Accounts User", "Payment proof, ledger and pending balances ko check karke clean record rakhna.", "Accounts ka rule simple hai: proof dekho, amount milao, phir verify karo.", [
    ("Daily payment check", "Sales, purchase and delivery collection payments list mein aayenge.", ["Payments kholo.", "New Submitted payment filter karo.", "Order number, retailer/supplier, amount and mode check karo.", "UPI/cheque/photo proof kholo.", "Amount correct ho to Verified karo.", "Proof ya amount wrong ho to reject / note karo; khud se amount change mat karo."], ("warn", "No proof", "Proof missing hai to Verified mat dabao. Staff se proof mangao.")),
    ("Ledger check", "Ledger se pending and paid status samajh aata hai.", ["Ledger kholo.", "Sales or Purchase order search karo.", "Invoice total, paid amount and pending amount milao.", "Partial collection ho to remaining balance clearly note karo.", "Date range filter use karo; purana data default mein load karne ki zarurat nahi."], None),
    ("Escalation", "Mismatch ko hide nahi karna hai.", ["Cash denomination total mismatch ho to admin ko raise karo.", "Cheque allowed nahi tha ya proof unclear hai to hold karo.", "Round-off tolerance ke bahar difference ho to WhatsApp Admin approval ka wait karo."], None),
])

make_pdf("07_WhatsApp_Admin_Chat_Guide.pdf", "WHATSAPP ADMIN - CHAT GOVERNANCE", "For: WhatsApp Admin", "Retailer onboarding, mapping, live chat routing and service governance ek control room se chalana.", "WhatsApp message channel hai; final record B CONNECT ke andar hota hai.", [
    ("Retailer registration", "New retailer registration approval ke bina active nahi hoga.", ["WhatsApp Wholesale kholo, Retailers tab kholo.", "Pending registration open karo.", "Shop name, owner, mobile, address and city check karo.", "Salesperson and Wholesale Warehouse map karo.", "Approve and map retailer dabao.", "Retailer ko welcome/order guide message jana check karo."], ("warn", "Consent", "Marketing active sirf consent wale retailer ke liye rakho.")),
    ("Chat governance", "Chat ko correct salesperson ke paas route karo.", ["Chats tab kholo.", "Unread retailer message select karo and pehle full context padho.", "Reply do ya correct salesperson ko transfer karo.", "Order chahiye to chat se draft create karo.", "Chat solve ho to close karo. Retailer ko agent bhejkar reopen karne ka message milega."], ("note", "Chat rule", "Rate change chat par promise mat karo. Required quantity mangwao; final verification system/sales se hoga.")),
    ("Team setup", "Operational team ka mobile/role yahin register hota hai.", ["Team tab kholo.", "Name, username, WhatsApp number, role and warehouse bharo.", "Directory mein entry verify karo.", "Sales/Purchase/Warehouse/Delivery/Collection roles correct rakho."], None),
    ("Collection exception approval", "Short, unauthorised partial, ya privilege mismatch collection ko WhatsApp Admin decide karega.", ["Team tab mein Collection approval alerts kholo.", "Retailer, bill due, received amount aur difference padho.", "Valid exception ho to Approve exception dabao. Delivery agent phir collection retry kar sakta hai.", "Galat ya unclear ho to Reject dabao aur agent ko Contact Admin bolo.", "Decision ke baad alert pending list se hat jayega. Payment proof Accounts verification ke liye Submitted rahega."], ("warn", "Approval rule", "Approve sirf actual proof aur retailer agreement dekh kar karo. Approval amount receive hone ka proof nahi hai.")),
])

make_pdf("08_Marketing_Insights_Guide.pdf", "MARKETING AND INSIGHTS GUIDE", "For: Admin / Marketing Owner", "Offers aur broadcasts ko consent, audience and performance ke saath chalana.", "Marketing tabhi bhejo jab retailer consent aur Meta message-window rule allow kare.", [
    ("Create an offer", "Only wholesale warehouse available products offer mein dikhne chahiye.", ["Marketing and Insights kholo, Offers tab kholo.", "Retailers ko tag, salesperson, department ya search se choose karo.", "Product, rate, MOQ and max quantity fill karo. Max 0 means unlimited.", "Expiry check karo.", "Send offer dabane se pehle selected retailer count padho."], ("warn", "Price discipline", "Offer rate galat ho to send mat karo. Private rate and CD/TOD only approved policy ke hisaab se.")),
    ("Broadcast", "Festival, feature or service announcement campaign ke roop mein bhejo.", ["Broadcast tab kholo.", "Campaign title likho.", "Inside 24-hour active chat normal text chalega; outside window approved Meta template name use karo.", "Audience filters use karo and Select all matching only after count check.", "Review and send announcement dabao.", "Sent, skipped and failed report read karo."], ("stop", "Never blast blindly", "Template missing or consent off retailers ko marketing send mat karo.")),
    ("Insights", "Campaign result se next action decide karo.", ["Insights tab kholo.", "Sent, delivered, read, failed and conversations dekho.", "Failed message ka reason note karo.", "Best offer/product response ko sales team ke saath share karo."], None),
])

print(f"Created 8 PDFs in {OUT}")
