import type { TrainingGuide } from "@aapoorti-b2b/domain";

// Served only after server-side role or registered-WhatsApp verification.
export const trainingGuides: TrainingGuide[] = [
  {
    "slug": "retailer",
    "title": "Retailer · WhatsApp ordering",
    "steps": [
      {
        "title": "Apna pehla order seekhein.",
        "screen": "Ravi ki training shuru",
        "speech": "“Mujhe dukaan ke liye maal mangana hai. B CONNECT par kaise karun?”",
        "narration": "रवि अपनी दुकान के लिए सामान मंगाना सीख रहा है। पहले दुकान का नाम, मालिक का नाम, जी एस टी नंबर या एन ए, शहर और डिलीवरी पता भरें। सही जानकारी देखकर कन्फर्म रजिस्ट्रेशन दबाएं। एडमिन की मंजूरी के बाद ऑर्डर शुरू होगा।",
        "body": "Ravi Aapoorti ki WhatsApp chat kholta hai. Trainer bolta hai: “Pehle apni shop register karwao. Shop name, owner name, GSTIN (ya NA), city aur delivery address do. Details check karke Confirm Registration dabao.”",
        "example": "Retailer registration — example\nShop: Ravi Kirana\nOwner: Ravi Kumar\nGSTIN: NA\nCity: Bhopal\nAddress: Shop 12, Sample Market, Bhopal",
        "task": "Ravi ki sample details check karke registration submit karo.",
        "success": "Registration request submit hui. Admin approval aur salesperson mapping ke baad ordering ka welcome message aayega.",
        "choices": [
          "Confirm Registration",
          "Edit Details"
        ],
        "answer": 0
      },
      {
        "title": "Product ka naam bhejo.",
        "screen": "Product search",
        "speech": "“Main chat mein seedha product ka naam likh sakta hoon!”",
        "narration": "अब प्रोडक्ट खोजते हैं। व्हाट्सऐप चैट में प्रोडक्ट का नाम लिख सकते हैं। पूरी लिस्ट के लिए कैटलॉग भेजें। इस अभ्यास में नीचे लक्स लिखकर सेंड दबाएं।",
        "body": "Approval ke baad Ravi ko welcome message milta hai. Product dhoondhne ke liye naam type karo. Puri list ke liye catalogue aur madad ke liye help bhej sakte ho. Ab sample mein Lux dhoondhte hain.",
        "example": "Namaste Ravi! Aapoorti B Connect mein swagat hai.\nProduct ka naam bhejein — jaise Lux, Maggi ya Coke.",
        "task": "Neeche Lux type karke Send dabao.",
        "success": "Product mil gaya: Lux Soap · sample 100 g pack. Agle page par sahi pack select karo.",
        "input": {
          "expected": "Lux",
          "label": "Product name",
          "numeric": false
        }
      },
      {
        "title": "Sahi pack pehchano.",
        "screen": "Item select karo",
        "speech": "“Sirf naam nahi—pack size bhi check karunga.”",
        "narration": "एक ही नाम के कई पैक हो सकते हैं। सही पैक साइज चुनें। रवि को सौ ग्राम का साबुन चाहिए। सौ ग्राम वाला बटन दबाएं। फिर एम आर पी, अपना रेट और न्यूनतम मात्रा देखें।",
        "body": "Search mein ek jaise naam ke kai packs aa sakte hain. Ravi ko 100 g wala pack chahiye. Product select karne ke baad MRP, apna rate, saving aur minimum order quantity (MOQ) dekho.",
        "example": "Search results — training examples\n1. Lux Soap · 100 g\n2. Lux Soap · 150 g",
        "task": "Ravi ke liye 100 g wala sample select karo.",
        "success": "Sahi pack! Ab sample rate aur MOQ dekhkar quantity bharenge.",
        "choices": [
          "Lux Soap · 100 g",
          "Lux Soap · 150 g"
        ],
        "answer": 0
      },
      {
        "title": "Kitne pieces chahiye?",
        "screen": "Quantity bhejo",
        "speech": "“MOQ 6 hai. Main 12 pieces mangata hoon.”",
        "narration": "इस उदाहरण में न्यूनतम मात्रा छह पीस है। रवि को बारह पीस चाहिए। नीचे बारह लिखें और सेंड दबाएं। असली रेट, टैक्स और अंतिम रकम प्रोफार्मा में जांचें।",
        "body": "MOQ ka matlab sabse kam order quantity hai. Is example mein minimum 6 pieces hain. Ravi ko 12 chahiye. Quantity bhejne se pehle unit aur rate check karo; asli rate latest proforma mein verify karna hai.",
        "example": "Lux Soap · 100 g — sample\nMRP: ₹40 / piece\nSample rate: ₹30 / piece\nMOQ: 6 pieces\nQuantity bhejein.",
        "task": "12 type karke quantity bhejo.",
        "success": "12 pieces sample cart mein jud gaye. Base amount: 12 × ₹30 = ₹360. Final taxes aur total proforma mein dekho.",
        "input": {
          "expected": "12",
          "label": "Quantity (pieces)",
          "numeric": true
        }
      },
      {
        "title": "Cart se proforma tak.",
        "screen": "Finalize",
        "speech": "“Finalize ke baad bhi proforma check karna baaki hai.”",
        "narration": "कार्ट में सभी प्रोडक्ट देख लें। और सामान जोड़ना हो तो ऐड मोर दबाएं। कार्ट तैयार हो तो फाइनलाइज़ दबाएं। इसके बाद प्रोफार्मा आएगा। फाइनलाइज़ करने से अंतिम ऑर्डर कन्फर्म नहीं होता।",
        "body": "Aur samaan chahiye to Add more se agla item dhoondho. Sab items jud gaye hon to cart check karke Finalize dabao. Iske baad proforma aata hai, jise Ravi ko khud review aur confirm karna hai.",
        "example": "Your cart — practice\nLux Soap · 100 g × 12\nBase amount: ₹360\nFinal tax aur payable amount proforma mein check karein.",
        "task": "Sample cart tayyar hai. Finalize dabao.",
        "success": "Sample proforma tayyar! Ab View Proforma se details dekho. Finalize ko final order confirmation mat samjho.",
        "choices": [
          "Finalize",
          "Add more",
          "Clear cart"
        ],
        "answer": 0
      },
      {
        "title": "Pehle poora hisaab dekho.",
        "screen": "Proforma review",
        "speech": "“Quantity, rate, GST aur total—sab sahi hai?”",
        "narration": "व्यू प्रोफार्मा दबाएं। प्रोडक्ट, मात्रा, रेट, छूट, जी एस टी, कुल रकम, पेमेंट और डिलीवरी देखें। यह अंतिम टैक्स इनवॉइस नहीं है। बदलाव चाहिए तो रिक्वेस्ट चेंज दबाएं।",
        "body": "Proforma order ka review hai, final tax invoice nahi. View Proforma mein product, quantity, discount, GST breakup, grand total, payment aur delivery details dekho. Quantity badalni ho to Request Change chuno.",
        "example": "AAPOORTI WHOLESALE\nPROFORMA — NOT A TAX INVOICE\nTraining example: 12 pieces\nLatest details review karke hi confirm karein.",
        "task": "View Proforma dabakar sample details padho.",
        "success": "Sample proforma: Lux 100 g × 12 · ₹30 base rate · taxable ₹360 · demo GST 18% = ₹64.80 · grand total ₹424.80 · no discount · Payment: Cash · Delivery: Delivery. Yeh sirf practice calculation hai; live product ka GST aur charges alag ho sakte hain.",
        "choices": [
          "View Proforma",
          "Request Change"
        ],
        "answer": 0
      },
      {
        "title": "Ab order confirm karo.",
        "screen": "Confirm Order",
        "speech": "“Sab check kar liya. Ab Confirm Order dabata hoon.”",
        "narration": "सबसे नया प्रोफार्मा सही होने पर कन्फर्म ऑर्डर दबाएं। स्टॉक जांच जरूरी हो तो सेल्समैन का कन्फर्मेशन आने दें। ऑर्डर कन्फर्म्ड संदेश आने पर पुष्टि समझें।",
        "body": "Sample details sahi hain. Confirm Order dabane par system order process karta hai. Agar stock review chahiye, salesperson ka final confirmation pending rahega. Order confirmed ka message aane par confirmation samjho.",
        "example": "Sample proforma reviewed\nLux Soap · 100 g × 12\nSample grand total: ₹424.80\nPlease confirm or request a change.",
        "task": "Practice order confirm karo.",
        "success": "Practice: Order confirmed! Aapoorti team dispatch aur final invoice updates WhatsApp par share karegi. Agar live chat mein stock check pending aaye, final confirmation ka wait karo.",
        "choices": [
          "Confirm Order",
          "Request Change"
        ],
        "answer": 0
      },
      {
        "title": "Order ki khabar rakho.",
        "screen": "Tracking aur madad",
        "speech": "“Status, balance, ya salesman se baat—sab menu mein hai.”",
        "narration": "ट्रैक माई ऑर्डर से स्थिति देखें। बैलेंस एंड लेजर से बाकी रकम देखें। मदद के लिए चैट विद सेल्सपर्सन चुनें। प्रशिक्षण पूरा होने पर रिटर्न टू व्हाट्सऐप से अपनी चैट पर लौटें।",
        "body": "Open Menu mein Track my order se latest order status dekho. Balance & ledger se pending amount ka summary milta hai. Chat with salesperson se madad lo. Unavailable item ke liye Add to wishlist aur problem ke liye Return or damage hai.",
        "example": "Open Menu\nOrder ke baad bhi Aapoorti aapke saath hai.",
        "task": "Menu ke options dabakar unka kaam seekho.",
        "success": "Yahan latest order ka live status milta hai. Practice example: order confirmed, dispatch update ka intezar.",
        "choices": [
          "Track my order",
          "Balance & ledger",
          "Chat with salesperson"
        ],
        "answer": 0
      },
      {
        "title": "Purana order phir mangao",
        "screen": "Open Menu / Repeat last order",
        "speech": "“Purana order phir mangao”",
        "body": "Registered retailer ko pichhla completed order dobara chahiye to Repeat last order chuno. Naye order ke current rate, stock, quantity aur proforma phir se check karna zaroori hai.",
        "example": "Pichhle order ka samaan phir chahiye",
        "task": "Sahi option par practice karo.",
        "choices": [
          "Repeat last order",
          "Purana invoice hi confirm maan lo"
        ],
        "answer": 0,
        "narration": "पुराने ग्राहक को पिछला पूरा हुआ ऑर्डर फिर चाहिए तो रिपीट लास्ट ऑर्डर चुनें। मौजूदा रेट, स्टॉक और नया प्रोफार्मा दोबारा जांचकर ही कन्फर्म करें।",
        "success": "Sahi! Registered retailer ko pichhla completed order dobara chahiye to Repeat last order chuno. Naye order ke current rate, stock, quantity aur proforma phir se check karna zaroori hai."
      },
      {
        "title": "Catalogue aur offers dekho",
        "screen": "Open Menu",
        "speech": "“Catalogue aur offers dekho”",
        "body": "Browse catalogue mein products, MRP, rate aur MOQ dekho. Shop by department se category chuno. Best offers mein savings dekho; final rate aur MOQ proforma mein verify honge.",
        "example": "Department ke hisaab se products chahiye",
        "task": "Sahi option par practice karo.",
        "choices": [
          "Shop by department",
          "Track my order"
        ],
        "answer": 0,
        "narration": "कैटलॉग में प्रोडक्ट, रेट और न्यूनतम मात्रा देखें। विभाग के हिसाब से देखने के लिए शॉप बाय डिपार्टमेंट चुनें। बेस्ट ऑफर्स के बाद भी अंतिम रेट प्रोफार्मा में जांचें।",
        "success": "Sahi! Browse catalogue mein products, MRP, rate aur MOQ dekho. Shop by department se category chuno. Best offers mein savings dekho; final rate aur MOQ proforma mein verify honge."
      },
      {
        "title": "Item nahi mila? Wishlist!",
        "screen": "Add to wishlist",
        "speech": "“Item nahi mila? Wishlist!”",
        "body": "Unavailable product aur required quantity wishlist mein bhejo. Stock aane par team update kar sakti hai. Wishlist ko confirmed order mat samjho.",
        "example": "Product unavailable · 12 pieces chahiye",
        "task": "Sahi option par practice karo.",
        "choices": [
          "Add to wishlist",
          "Order confirmed maan lo"
        ],
        "answer": 0,
        "narration": "प्रोडक्ट नहीं मिल रहा तो ऐड टू विशलिस्ट चुनें और मात्रा बताएं। टीम उपलब्ध होने पर अपडेट कर सकती है। विशलिस्ट कन्फर्म ऑर्डर नहीं है।",
        "success": "Sahi! Unavailable product aur required quantity wishlist mein bhejo. Stock aane par team update kar sakti hai. Wishlist ko confirmed order mat samjho."
      },
      {
        "title": "Return ya damage ki madad",
        "screen": "Return or damage",
        "speech": "“Return ya damage ki madad”",
        "body": "Menu mein Return or damage chuno, ya return/damage bhejo. Order number, product, quantity aur problem batao. Request shuru hone ke baad photo/document attach karo; team review karegi.",
        "example": "Delivered packet damaged hai",
        "task": "Sahi option par practice karo.",
        "choices": [
          "Return or damage",
          "Naya order bina bataye"
        ],
        "answer": 0,
        "narration": "नुकसान या वापसी के लिए रिटर्न ऑर डैमेज चुनें। ऑर्डर नंबर, प्रोडक्ट, मात्रा और समस्या बताएं। अनुरोध शुरू होने के बाद फोटो जोड़ें। टीम जांच करेगी।",
        "success": "Sahi! Menu mein Return or damage chuno, ya return/damage bhejo. Order number, product, quantity aur problem batao. Request shuru hone ke baad photo/document attach karo; team review karegi."
      },
      {
        "title": "Ab WhatsApp par kaam karo",
        "screen": "Training complete",
        "speech": "“Ab WhatsApp par kaam karo”",
        "body": "Naye retailer ko pehle registration approval chahiye. Purana retailer product search se order kar sakta hai. Finalize ke baad latest proforma review aur Confirm Order yaad rakho. Neeche Return to WhatsApp se apni chat kholo.",
        "example": "Finalize ke baad kya karna hai?",
        "task": "Sahi option par practice karo.",
        "choices": [
          "Latest proforma check, phir Confirm Order",
          "Order automatically final"
        ],
        "answer": 0,
        "narration": "प्रशिक्षण पूरा हुआ। नए रिटेलर को पहले रजिस्ट्रेशन मंजूरी चाहिए। पुराने रिटेलर सीधे प्रोडक्ट खोज सकते हैं। फाइनलाइज़ के बाद नया प्रोफार्मा जांचकर कन्फर्म ऑर्डर करें। अब रिटर्न टू व्हाट्सऐप दबाकर अपनी चैट पर लौटें।",
        "success": "Sahi! Naye retailer ko pehle registration approval chahiye. Purana retailer product search se order kar sakta hai. Finalize ke baad latest proforma review aur Confirm Order yaad rakho. Neeche Return to WhatsApp se apni chat kholo."
      }
    ]
  },
  {
    "slug": "warehouse-manager",
    "title": "Warehouse Manager",
    "steps": [
      {
        "title": "Apna warehouse dekho",
        "screen": "Stock",
        "speech": "“Apna warehouse dekho — saath mein practice karein.”",
        "narration": "अपने वेयरहाउस का स्टॉक खोलें। उपलब्ध, रिजर्व और ब्लॉक स्टॉक अलग हैं। डिस्पैच के लिए उपलब्ध मात्रा देखें।",
        "body": "Login ke baad assigned warehouse ka stock dekho. Available, reserved aur blocked quantity alag hoti hai. Dispatch ke liye available stock dekho.",
        "example": "Sample: available 80 · reserved 15 · blocked 5",
        "task": "Is situation mein sahi action chuno.",
        "choices": [
          "Blocked stock",
          "Available stock",
          "Total ko available maan lo"
        ],
        "answer": 1,
        "success": "Sahi! Login ke baad assigned warehouse ka stock dekho. Available, reserved aur blocked quantity alag hoti hai. Dispatch ke liye available stock dekho."
      },
      {
        "title": "Maal ki receipt check karo",
        "screen": "WhatsApp: IN / RECEIVE",
        "speech": "“Maal ki receipt check karo — saath mein practice karein.”",
        "narration": "रसीद जांच में पहले खरीद ऑर्डर और वेयरहाउस मिलाएं। सौ में से छियानवे यूनिट मिले तो छियानवे दर्ज करें। नुकसान, वजन और अंतर भी नोट करें।",
        "body": "Apne registered WhatsApp se IN type karo. PO ke last digits verify karo, weight photo bhejo, phir RECEIVE <PO last6> <SKU> <qty> <gross weight kg> type karo. Sirf jitna maal mila utna record hota hai.",
        "example": "PO: 100 units · actual received: 96 units",
        "task": "Is situation mein sahi action chuno.",
        "choices": [
          "100",
          "96",
          "0"
        ],
        "answer": 1,
        "success": "Sahi! Purchase order aur warehouse match karo. Ordered aur actual received quantity gino; damage, weight aur variance bhi note karo. Sirf jitna maal mila utna enter karo."
      },
      {
        "title": "Damage alag rakho",
        "screen": "Receipts",
        "speech": "“Damage alag rakho — saath mein practice karein.”",
        "narration": "छियानवे मिले और दो खराब हैं तो चौरानवे स्वीकार करें। खराब माल और उसका कारण दर्ज करें। पूरा चेक होने से पहले सब सही मत मानें।",
        "body": "Actual accepted quantity aur damage ki entry sachchi honi chahiye. Receipt note/proof se mismatch samjhao. Received status bina poora check kiye mat maano.",
        "example": "96 received · 2 damaged · 94 accepted",
        "task": "Is situation mein sahi action chuno.",
        "choices": [
          "96 accepted",
          "94 accepted",
          "100 accepted"
        ],
        "answer": 1,
        "success": "Sahi! Actual accepted quantity aur damage ki entry sachchi honi chahiye. Receipt note/proof se mismatch samjhao. Received status bina poora check kiye mat maano."
      },
      {
        "title": "Packing ke baad Ready",
        "screen": "WhatsApp: OUT / READY / DCO",
        "speech": "“Packing ke baad Ready — saath mein practice karein.”",
        "narration": "सेल्स ऑर्डर के मुताबिक सही माल पैक करें। मात्रा और वेयरहाउस मिलाएं। पैकिंग पूरी होने पर डॉकिट रेडी करें। अभी डिलीवर्ड नहीं करना है।",
        "body": "WhatsApp par OUT se order dekho. Packing/weight photo bhejo, READY <SO last6> type karke docket banao. Multiple ready orders ke liye DCO <SO last6,SO last6> type karo.",
        "example": "Docket: Pending Packing → packing checked",
        "task": "Is situation mein sahi action chuno.",
        "choices": [
          "Delivered",
          "Ready",
          "Closed"
        ],
        "answer": 1,
        "success": "Sahi! Sales order ke items, quantity aur warehouse match karke packing karo. Docket ready hone par assigned dispatch flow mein aage badhao."
      },
      {
        "title": "Handover ka trail rakho",
        "screen": "Delivery",
        "speech": "“Handover ka trail rakho — saath mein practice karein.”",
        "narration": "सही डिलीवरी व्यक्ति को माल सौंपें। वेयरहाउस से निकलने पर आउट फॉर डिलीवरी है। ग्राहक को पहुंचने के बाद ही डिलीवर्ड है।",
        "body": "Sahi delivery person/consignment ko packed maal handover karo. Pickup ke baad Out for Delivery aur customer handover ke baad Delivered ka trail follow karo.",
        "example": "Maal warehouse se pickup ho gaya",
        "task": "Is situation mein sahi action chuno.",
        "choices": [
          "Delivered bina customer handover",
          "Out for Delivery",
          "Dobara receipt banao"
        ],
        "answer": 1,
        "success": "Sahi! Sahi delivery person/consignment ko packed maal handover karo. Pickup ke baad Out for Delivery aur customer handover ke baad Delivered ka trail follow karo."
      }
    ]
  },
  {
    "slug": "purchaser",
    "title": "Purchaser",
    "steps": [
      {
        "title": "Supplier aur warehouse chuno",
        "screen": "Purchase",
        "speech": "“Supplier aur warehouse chuno — saath mein practice karein.”",
        "narration": "परचेज खोलें। सही सप्लायर और माल लेने वाला वेयरहाउस चुनें। पहले से दर्ज सप्लायर का ही रिकॉर्ड लें। डुप्लिकेट न बनाएं।",
        "body": "Purchase shuru karte waqt sahi supplier aur receiving warehouse chuno. Supplier details pehle se hain to wahi record use karo.",
        "example": "Supplier already exists in Parties",
        "task": "Is situation mein sahi action chuno.",
        "choices": [
          "Duplicate supplier banao",
          "Existing supplier",
          "Customer shop chuno"
        ],
        "answer": 1,
        "success": "Sahi! Purchase shuru karte waqt sahi supplier aur receiving warehouse chuno. Supplier details pehle se hain to wahi record use karo."
      },
      {
        "title": "Product aur quantity jodo",
        "screen": "Purchase / Catalogue",
        "speech": "“Product aur quantity jodo — saath mein practice karein.”",
        "narration": "प्रोडक्ट, यूनिट, मात्रा और खरीद रेट जांचें। बीस यूनिट का रेट सौ रुपये है तो मूल रकम दो हजार रुपये है। टैक्स अलग से जांचें।",
        "body": "SKU, unit, quantity aur negotiated purchase rate check karo. Pack size aur MRP ko supplier invoice se match karo.",
        "example": "Sample: 20 units × ₹100 base rate",
        "task": "Is situation mein sahi action chuno.",
        "choices": [
          "₹100 base",
          "₹2000 base",
          "₹20 base"
        ],
        "answer": 1,
        "success": "Sahi! SKU, unit, quantity aur negotiated purchase rate check karo. Pack size aur MRP ko supplier invoice se match karo."
      },
      {
        "title": "Cart review karo",
        "screen": "Checkout",
        "speech": "“Cart review karo — saath mein practice karein.”",
        "narration": "कार्ट में लाइनें और रकम जांचें। सप्लायर खुद माल भेजेगा तो डीलर डिलीवरी चुनें। अपनी गाड़ी से लाना है तो सेल्फ कलेक्शन चुनें।",
        "body": "Add & open cart ke baad lines aur amounts check karo. Dealer Delivery ya Self Collection wahi chuno jo supplier se tay hua hai.",
        "example": "Supplier apne vehicle se maal bhejega",
        "task": "Is situation mein sahi action chuno.",
        "choices": [
          "Self Collection",
          "Dealer Delivery",
          "Delivered"
        ],
        "answer": 1,
        "success": "Sahi! Add & open cart ke baad lines aur amounts check karo. Dealer Delivery ya Self Collection wahi chuno jo supplier se tay hua hai."
      },
      {
        "title": "Payment sachcha darj karo",
        "screen": "Checkout / Payments",
        "speech": "“Payment sachcha darj karo — saath mein practice karein.”",
        "narration": "एडवांस दिया हो तभी रकम और भुगतान विवरण दर्ज करें। प्रूफ भेजने के बाद भी अकाउंट्स की जांच बाकी है। सबमिटेड और वेरिफाइड अलग हैं।",
        "body": "Advance diya ho tabhi amount, mode aur reference/proof bharo. Proof submit hona aur accounts verification alag steps hain.",
        "example": "Payment proof bheja; accounts check abhi baaki",
        "task": "Is situation mein sahi action chuno.",
        "choices": [
          "Verified maan lo",
          "Submitted",
          "Doosri payment banao"
        ],
        "answer": 1,
        "success": "Sahi! Advance diya ho tabhi amount, mode aur reference/proof bharo. Proof submit hona aur accounts verification alag steps hain."
      },
      {
        "title": "Summary se order banao",
        "screen": "Checkout / Summary",
        "speech": "“Summary se order banao — saath mein practice karein.”",
        "narration": "अंतिम सारांश में सप्लायर, वेयरहाउस, मात्रा, टैक्स, डिलीवरी और पेमेंट जांचें। सही होने पर कंटिन्यू एंड फाइनलाइज़ दबाएं। ऑर्डर नंबर संभालें।",
        "body": "Supplier, warehouse, quantity, tax, delivery aur payment dobara check karo. Continue and finalize se order banta hai; order number sambhal kar rakho.",
        "example": "Summary sahi hai",
        "task": "Is situation mein sahi action chuno.",
        "choices": [
          "Naya supplier banao",
          "Continue and finalize",
          "Received mark karo"
        ],
        "answer": 1,
        "success": "Sahi! Supplier, warehouse, quantity, tax, delivery aur payment dobara check karo. Continue and finalize se order banta hai; order number sambhal kar rakho."
      },
      {
        "title": "Receipt tak follow-up",
        "screen": "Purchases",
        "speech": "“Receipt tak follow-up — saath mein practice karein.”",
        "narration": "परचेज सूची में डिलीवरी और रसीद की स्थिति देखें। सौ में से नब्बे स्वीकार हुए तो आंशिक प्राप्ति है। कमी या खराब माल का फॉलो अप करें।",
        "body": "Delivery aur warehouse receipt status follow karo. Short ya damaged material ko note ke saath resolve karo; full received assume mat karo.",
        "example": "100 ordered · 90 accepted",
        "task": "Is situation mein sahi action chuno.",
        "choices": [
          "Received",
          "Partially Received",
          "Closed"
        ],
        "answer": 1,
        "success": "Sahi! Delivery aur warehouse receipt status follow karo. Short ya damaged material ko note ke saath resolve karo; full received assume mat karo."
      }
    ]
  },
  {
    "slug": "sales",
    "title": "Sales",
    "steps": [
      {
        "title": "Sahi shop se shuru",
        "screen": "Sales",
        "speech": "“Sahi shop se shuru — saath mein practice karein.”",
        "narration": "सेल्स खोलकर सही दुकान चुनें। पहले से दर्ज दुकान का रिकॉर्ड लें। मोबाइल और डिलीवरी पता जांचें। नई दुकान हो तभी नया रिकॉर्ड बनाएं।",
        "body": "Existing shop dhoondho; customer naya ho tabhi new shop banao. Mobile aur delivery address verify karo.",
        "example": "Ravi Kirana pehle se registered hai",
        "task": "Is situation mein sahi action chuno.",
        "choices": [
          "Duplicate shop",
          "Existing shop",
          "Supplier purchase"
        ],
        "answer": 1,
        "success": "Sahi! Existing shop dhoondho; customer naya ho tabhi new shop banao. Mobile aur delivery address verify karo."
      },
      {
        "title": "Stock aur pack dekho",
        "screen": "Sales / Catalogue",
        "speech": "“Stock aur pack dekho — saath mein practice karein.”",
        "narration": "सही प्रोडक्ट और पैक चुनें। अपने वेयरहाउस का उपलब्ध स्टॉक देखें। बारह चाहिए और बीस उपलब्ध हैं तो बारह मात्रा भरें।",
        "body": "Product, pack size, warehouse aur available quantity match karo. Stock se zyada order mein warning/review aa sakta hai.",
        "example": "12 required · 20 available · correct pack",
        "task": "Is situation mein sahi action chuno.",
        "choices": [
          "120 units",
          "12 units",
          "Doosra pack"
        ],
        "answer": 1,
        "success": "Sahi! Product, pack size, warehouse aur available quantity match karo. Stock se zyada order mein warning/review aa sakta hai."
      },
      {
        "title": "Rate aur cart check",
        "screen": "Add & open cart",
        "speech": "“Rate aur cart check — saath mein practice karein.”",
        "narration": "रेट, एम आर पी, छूट और जी एस टी जांचें। सब सही हो तो ऐड एंड ओपन कार्ट दबाएं। रेट की चेतावनी आए तो पढ़कर आगे बढ़ें।",
        "body": "Rate, MRP, discount aur GST check karke Add & open cart karo. Unusual rate warning ko padhkar hi aage badho.",
        "example": "Pack aur agreed rate dono sahi",
        "task": "Is situation mein sahi action chuno.",
        "choices": [
          "Rate bina dekhe finalize",
          "Add & open cart",
          "Cart clear karo"
        ],
        "answer": 1,
        "success": "Sahi! Rate, MRP, discount aur GST check karke Add & open cart karo. Unusual rate warning ko padhkar hi aage badho."
      },
      {
        "title": "Delivery aur payment",
        "screen": "Checkout",
        "speech": "“Delivery aur payment — saath mein practice karein.”",
        "narration": "ग्राहक को माल पहुंचाना है तो डिलीवरी चुनें और सही पता जांचें। एडवांस मिला है तो असली रकम और प्रूफ दर्ज करें।",
        "body": "Delivery/Self Collection aur sahi address chuno. Advance mila ho to uski actual amount aur proof darj karo.",
        "example": "Customer ghar/dukaan par delivery chahta hai",
        "task": "Is situation mein sahi action chuno.",
        "choices": [
          "Self Collection",
          "Delivery",
          "Payment Verified"
        ],
        "answer": 1,
        "success": "Sahi! Delivery/Self Collection aur sahi address chuno. Advance mila ho to uski actual amount aur proof darj karo."
      },
      {
        "title": "Order finalize karo",
        "screen": "Summary",
        "speech": "“Order finalize karo — saath mein practice karein.”",
        "narration": "अंतिम सारांश पढ़ें। दुकान, माल, मात्रा, रकम और डिलीवरी सही हो तो कंटिन्यू एंड फाइनलाइज़ दबाएं। सेल्स ऑर्डर्स में आगे की स्थिति देखें।",
        "body": "Shop, items, quantity, total aur delivery details check karo. Continue and finalize ke baad SalesOrders mein order track karo.",
        "example": "Summary checked",
        "task": "Is situation mein sahi action chuno.",
        "choices": [
          "Delivered",
          "Continue and finalize",
          "Received"
        ],
        "answer": 1,
        "success": "Sahi! Shop, items, quantity, total aur delivery details check karo. Continue and finalize ke baad SalesOrders mein order track karo."
      },
      {
        "title": "Retailer ko training bhejo",
        "screen": "Profile / Share training",
        "speech": "“Retailer ko training bhejo — saath mein practice karein.”",
        "narration": "प्रोफाइल में शेयर ट्रेनिंग खोलें। अपना मैप किया हुआ रिटेलर चुनें और लिंक बनाएं। रिटेलर की सार्वजनिक गाइड कोई भी खोल सकता है।",
        "body": "Share training mein apna mapped retailer chuno aur link banao. Copy ya Share se bhejo. Retailer ka public guide koi bhi khol sakta hai.",
        "example": "Ravi Kirana is mapped to you",
        "task": "Is situation mein sahi action chuno.",
        "choices": [
          "Admin guide",
          "Retailer guide",
          "Kisi aur salesman ka retailer"
        ],
        "answer": 1,
        "success": "Sahi! Share training mein apna mapped retailer chuno aur link banao. Copy ya Share se bhejo. Retailer ka public guide koi bhi khol sakta hai."
      }
    ]
  },
  {
    "slug": "accounts",
    "title": "Accounts",
    "steps": [
      {
        "title": "Order se payment match",
        "screen": "Payments",
        "speech": "“Order se payment match — saath mein practice karein.”",
        "narration": "पेमेंट में सही ऑर्डर, रकम, माध्यम और रेफरेंस को प्रूफ से मिलाएं। अंतर हो तो पहले जांच करें।",
        "body": "Sales/Purchase side, order ID, amount, mode aur reference ko proof/bank entry se match karo.",
        "example": "Proof aur order ka reference alag hai",
        "task": "Is situation mein sahi action chuno.",
        "choices": [
          "Verified",
          "Mismatch investigate",
          "Ignore"
        ],
        "answer": 1,
        "success": "Sahi! Sales/Purchase side, order ID, amount, mode aur reference ko proof/bank entry se match karo."
      },
      {
        "title": "Verification ka matlab",
        "screen": "Payments",
        "speech": "“Verification ka matlab — saath mein practice karein.”",
        "narration": "प्रूफ सही और रकम मिलती हो तो वेरिफाइड करें। गलत प्रूफ को स्वीकार न करें। अंतर को विवाद प्रक्रिया में जांचें।",
        "body": "Proof accept hone par Verified. Invalid proof ko reject aur mismatch ko dispute flow mein handle karo.",
        "example": "Proof valid aur amount matched",
        "task": "Is situation mein sahi action chuno.",
        "choices": [
          "Pending rehne do",
          "Verified",
          "Duplicate payment"
        ],
        "answer": 1,
        "success": "Sahi! Proof accept hone par Verified. Invalid proof ko reject aur mismatch ko dispute flow mein handle karo."
      },
      {
        "title": "Ledger ka balance dekho",
        "screen": "Ledger",
        "speech": "“Ledger ka balance dekho — saath mein practice karein.”",
        "narration": "लेजर में कुल रकम और वेरिफाइड भुगतान मिलाएं। हजार में छह सौ मिले तो चार सौ बाकी और स्थिति आंशिक है।",
        "body": "Order value aur verified payment ke baad pending/partial/settled status dekho.",
        "example": "Order ₹1000 · verified ₹600 · pending ₹400",
        "task": "Is situation mein sahi action chuno.",
        "choices": [
          "Settled",
          "Partial",
          "Zero due"
        ],
        "answer": 1,
        "success": "Sahi! Order value aur verified payment ke baad pending/partial/settled status dekho."
      },
      {
        "title": "Collection reconcile karo",
        "screen": "Payments / Collection",
        "speech": "“Collection reconcile karo — saath mein practice karein.”",
        "narration": "कैश कलेक्ट होना और उसका मिलान अलग काम हैं। प्रूफ और लेजर से मिलान पूरा करके ही रिकन्साइल करें।",
        "body": "Collected cash ko proof aur ledger se match karne ke baad Reconciled karo.",
        "example": "Cash collected, matching abhi baaki",
        "task": "Is situation mein sahi action chuno.",
        "choices": [
          "Already reconciled",
          "Pehle matching",
          "Naya order"
        ],
        "answer": 1,
        "success": "Sahi! Collected cash ko proof aur ledger se match karne ke baad Reconciled karo."
      }
    ]
  },
  {
    "slug": "delivery-manager",
    "title": "Delivery Manager",
    "steps": [
      {
        "title": "Sahi direction chuno",
        "screen": "Delivery",
        "speech": "“Sahi direction chuno — saath mein practice karein.”",
        "narration": "डिलीवरी में पहले दिशा चुनें। सप्लायर से वेयरहाउस आना परचेज इनबाउंड है। ग्राहक तक जाना सेल्स आउटबाउंड है।",
        "body": "Purchase inbound aur Sales outbound alag hain. Pehle correct side, order aur warehouse chuno.",
        "example": "Supplier se warehouse maal aana hai",
        "task": "Is situation mein sahi action chuno.",
        "choices": [
          "Sales outbound",
          "Purchase inbound",
          "Collection only"
        ],
        "answer": 1,
        "success": "Sahi! Purchase inbound aur Sales outbound alag hain. Pehle correct side, order aur warehouse chuno."
      },
      {
        "title": "Assignment tayyar karo",
        "screen": "Delivery / New Assignment",
        "speech": "“Assignment tayyar karo — saath mein practice karein.”",
        "narration": "सही डिलीवरी व्यक्ति को काम दें। ऑर्डर, वाहन, पिकअप और पता जांचें। व्यक्ति तय हुए बिना डिलीवर्ड मत करें।",
        "body": "Assigned person, transport, pickup/drop aur order links verify karo. External transport mein vehicle/freight bhi bharo.",
        "example": "Sales delivery ka person abhi assign nahi",
        "task": "Is situation mein sahi action chuno.",
        "choices": [
          "Mark Delivered",
          "Assign correct person",
          "Close order"
        ],
        "answer": 1,
        "success": "Sahi! Assigned person, transport, pickup/drop aur order links verify karo. External transport mein vehicle/freight bhi bharo."
      },
      {
        "title": "Pickup se dispatch",
        "screen": "Delivery",
        "speech": "“Pickup se dispatch — saath mein practice karein.”",
        "narration": "रेडी डॉकिट का माल और कंसाइनमेंट मिलाएं। माल वेयरहाउस में है तो पिकअप बाकी है। निकलने पर आउट फॉर डिलीवरी है।",
        "body": "Ready docket ko consignment se match karo. Pickup pending aur Out for Delivery ko actual movement ke hisaab se update karo.",
        "example": "Maal abhi warehouse mein hai",
        "task": "Is situation mein sahi action chuno.",
        "choices": [
          "Delivered",
          "Pending Pickup",
          "Closed"
        ],
        "answer": 1,
        "success": "Sahi! Ready docket ko consignment se match karo. Pickup pending aur Out for Delivery ko actual movement ke hisaab se update karo."
      },
      {
        "title": "Delivery proof aur payment",
        "screen": "Delivery",
        "speech": "“Delivery proof aur payment — saath mein practice karein.”",
        "narration": "ग्राहक को माल देकर हैंडओवर का प्रूफ लें। कैश कलेक्शन दिया गया हो तो मिली हुई रकम दर्ज करें। अंतिम पेमेंट जांच अकाउंट्स करेगा।",
        "body": "Customer handover ka proof lo. Cash collection assigned ho to actual received amount record karo; final payment verification accounts karega.",
        "example": "Maal diya, proof mil gaya",
        "task": "Is situation mein sahi action chuno.",
        "choices": [
          "Payment bina mile collected",
          "Complete handover record",
          "Delete assignment"
        ],
        "answer": 1,
        "success": "Sahi! Customer handover ka proof lo. Cash collection assigned ho to actual received amount record karo; final payment verification accounts karega."
      }
    ]
  },
  {
    "slug": "delivery",
    "title": "Delivery Executive",
    "steps": [
      {
        "title": "Assigned task kholo",
        "screen": "WhatsApp: READ",
        "speech": "“Assigned task kholo — saath mein practice karein.”",
        "narration": "अपना असाइन किया हुआ काम खोलें। खरीद पिकअप है या ग्राहक डिलीवरी, सही ऑर्डर और पता देखें।",
        "body": "Apne registered WhatsApp par READ type karo. Assigned DCO, task ke last 6 digits aur retailer stop number wahi reply mein milte hain.",
        "example": "Task aapko assigned hai",
        "task": "Is situation mein sahi action chuno.",
        "choices": [
          "Kisi aur ka task",
          "Task details dekho",
          "Skip details"
        ],
        "answer": 1,
        "success": "Sahi! Apna assigned task padho. Purchase pickup ya sales delivery ka order, address aur person verify karo."
      },
      {
        "title": "Pickup par maal gino",
        "screen": "WhatsApp: DELIVERED",
        "speech": "“Pickup par maal gino — saath mein practice karein.”",
        "narration": "पिकअप पर माल गिनें। दस की जगह नौ मिले तो नौ और कमी का नोट लिखें। बिना मिले दस दर्ज न करें।",
        "body": "Pickup par product aur quantity match karo. Kam ya damaged maal ho to note/proof ke saath manager ko batao.",
        "example": "10 packets expected · 9 mile",
        "task": "Is situation mein sahi action chuno.",
        "choices": [
          "10 received",
          "9 actual + shortage note",
          "Delivered"
        ],
        "answer": 1,
        "success": "Sahi! Pickup par product aur quantity match karo. Kam ya damaged maal ho to note/proof ke saath manager ko batao."
      },
      {
        "title": "Handover aur proof",
        "screen": "Current Delivery",
        "speech": "“Handover aur proof — saath mein practice karein.”",
        "narration": "सही व्यक्ति को सामान सौंपें और प्रूफ रखें। सिर्फ चल पड़ने से डिलीवरी पूरी नहीं होती।",
        "body": "Retailer ko maal dene ke baad clear photo bhejo, phir DELIVERED <task last6> <stop no> type karo. Delivery ke baad system collection instruction bhejta hai.",
        "example": "Maal recipient tak nahi pahuncha",
        "task": "Is situation mein sahi action chuno.",
        "choices": [
          "Delivered",
          "In transit",
          "Closed"
        ],
        "answer": 1,
        "success": "Sahi! Sahi recipient ko maal do; proof aur actual status record karo. Sirf nikalne se Delivered nahi hota."
      },
      {
        "title": "Cash ka sahi record",
        "screen": "WhatsApp: COLLECT",
        "speech": "“Cash ka sahi record — saath mein practice karein.”",
        "narration": "पेमेंट का काम मिला है तो जितना पैसा सच में लिया या दिया उतना लिखें। हजार बाकी था और छह सौ मिला तो छह सौ दर्ज करें।",
        "body": "Payment proof photo bhejo, phir COLLECT <task last6> <stop no> <amount> CASH|UPI|CHEQUE|LATER type karo. Later, partial aur cheque retailer privilege par depend karte hain.",
        "example": "₹1000 due · ₹600 actually received",
        "task": "Is situation mein sahi action chuno.",
        "choices": [
          "₹1000",
          "₹600",
          "₹0"
        ],
        "answer": 1,
        "success": "Sahi! Collect Payment ya Deliver Payment assigned ho to actual money movement record karo. Proof/reference attach karo."
      }
    ]
  },
  {
    "slug": "collection",
    "title": "Collection Agent",
    "steps": [
      {
        "title": "Apni collection dekho",
        "screen": "Payments / Collection",
        "speech": "“Apni collection dekho — saath mein practice karein.”",
        "narration": "अपनी असाइन की हुई कलेक्शन में सही ग्राहक और ऑर्डर की बाकी रकम देखें।",
        "body": "Assigned sales order aur outstanding dekho. Sahi customer aur order se collection match karo.",
        "example": "Ravi order par ₹400 pending",
        "task": "Is situation mein sahi action chuno.",
        "choices": [
          "₹1000 dobara collect",
          "₹400 pending",
          "Wrong shop"
        ],
        "answer": 1,
        "success": "Sahi! Assigned sales order aur outstanding dekho. Sahi customer aur order se collection match karo."
      },
      {
        "title": "Actual amount lo",
        "screen": "Collection",
        "speech": "“Actual amount lo — saath mein practice karein.”",
        "narration": "जितनी रकम मिली उतनी दर्ज करें। चार सौ में से दो सौ पचास मिले तो दो सौ पचास ही भरें।",
        "body": "Jo amount mila wahi record karo. Payment mode, reference aur proof bharo.",
        "example": "₹400 due · ₹250 received",
        "task": "Is situation mein sahi action chuno.",
        "choices": [
          "₹400",
          "₹250",
          "Mark settled"
        ],
        "answer": 1,
        "success": "Sahi! Jo amount mila wahi record karo. Payment mode, reference aur proof bharo."
      },
      {
        "title": "Accounts ko trail do",
        "screen": "Collection / Payments",
        "speech": "“Accounts ko trail do — saath mein practice karein.”",
        "narration": "पैसा मिलने पर कलेक्टेड है। अकाउंट्स के मिलान के बाद रिकन्साइल्ड होगा। प्रूफ पूरा रखें।",
        "body": "Collected status ke baad accounts matching karega. Proof complete rakho; Reconciled ko collection se alag samjho.",
        "example": "Money received, accounts matching pending",
        "task": "Is situation mein sahi action chuno.",
        "choices": [
          "Reconciled",
          "Collected",
          "Settled automatically"
        ],
        "answer": 1,
        "success": "Sahi! Collected status ke baad accounts matching karega. Proof complete rakho; Reconciled ko collection se alag samjho."
      }
    ]
  },
  {
    "slug": "analyst",
    "title": "Data Analyst",
    "steps": [
      {
        "title": "Sahi scope lagao",
        "screen": "Stock / Reports",
        "speech": "“Sahi scope lagao — saath mein practice karein.”",
        "narration": "रिपोर्ट देखने से पहले वेयरहाउस, समय और प्रोडक्ट का दायरा चुनें।",
        "body": "Warehouse, period aur product filters check karke report padho.",
        "example": "Report sirf Bhopal warehouse ke liye",
        "task": "Is situation mein sahi action chuno.",
        "choices": [
          "All warehouses assume",
          "Bhopal filter",
          "Wrong period"
        ],
        "answer": 1,
        "success": "Sahi! Warehouse, period aur product filters check karke report padho."
      },
      {
        "title": "Stock ko samjho",
        "screen": "Stock",
        "speech": "“Stock ko samjho — saath mein practice karein.”",
        "narration": "कुल स्टॉक ही बेचने लायक स्टॉक नहीं है। सौ में दस ब्लॉक और बीस रिजर्व हों तो सत्तर उपलब्ध हैं।",
        "body": "Available, reserved aur blocked stock ko alag compare karo. Total stock ko sellable mat samjho.",
        "example": "Total 100 · blocked 10 · reserved 20",
        "task": "Is situation mein sahi action chuno.",
        "choices": [
          "100 available",
          "70 available",
          "90 available"
        ],
        "answer": 1,
        "success": "Sahi! Available, reserved aur blocked stock ko alag compare karo. Total stock ko sellable mat samjho."
      },
      {
        "title": "Report share karne se pehle",
        "screen": "Reports",
        "speech": "“Report share karne se pehle — saath mein practice karein.”",
        "narration": "रिपोर्ट एक्सपोर्ट करने से पहले तारीखें और कुल रकम जांचें। गलत फ़िल्टर सुधारें, फिर संबंधित रिपोर्ट निकालें।",
        "body": "Date range, totals aur selected filters verify karo. Relevant export ko hi authorised team ke saath share karo.",
        "example": "Date range galat selected hai",
        "task": "Is situation mein sahi action chuno.",
        "choices": [
          "Export immediately",
          "Filter correct karo",
          "Change live orders"
        ],
        "answer": 1,
        "success": "Sahi! Date range, totals aur selected filters verify karo. Relevant export ko hi authorised team ke saath share karo."
      }
    ]
  },
  {
    "slug": "admin",
    "title": "Admin",
    "steps": [
      {
        "title": "User ko sahi role do",
        "screen": "Users",
        "speech": "“User ko sahi role do — saath mein practice karein.”",
        "narration": "नया यूज़र बनाते समय नाम, मोबाइल, भूमिका और वेयरहाउस सही दें। वेयरहाउस कर्मचारी को वेयरहाउस मैनेजर भूमिका दें।",
        "body": "User name, mobile, role aur warehouse scope set karo. Har user ko uske kaam ke roles do.",
        "example": "Naya employee warehouse sambhalega",
        "task": "Is situation mein sahi action chuno.",
        "choices": [
          "Admin sabko",
          "Warehouse Manager",
          "Purchaser"
        ],
        "answer": 1,
        "success": "Sahi! User name, mobile, role aur warehouse scope set karo. Har user ko uske kaam ke roles do."
      },
      {
        "title": "Masters ready rakho",
        "screen": "Warehouses / Products / Parties",
        "speech": "“Masters ready rakho — saath mein practice karein.”",
        "narration": "वेयरहाउस, प्रोडक्ट और पार्टियों के मास्टर सही रखें। पहले से दर्ज दुकान का रिकॉर्ड दोबारा न बनाएं।",
        "body": "Warehouses, products aur suppliers/shops complete karo. SKU, unit, GST aur allowed warehouses verify karo.",
        "example": "Same shop pehle se present",
        "task": "Is situation mein sahi action chuno.",
        "choices": [
          "Duplicate record",
          "Existing record use",
          "Random warehouse"
        ],
        "answer": 1,
        "success": "Sahi! Warehouses, products aur suppliers/shops complete karo. SKU, unit, GST aur allowed warehouses verify karo."
      },
      {
        "title": "Retailer mapping",
        "screen": "WhatsApp / Retailers",
        "speech": "“Retailer mapping — saath mein practice karein.”",
        "narration": "व्हाट्सऐप रजिस्ट्रेशन की जानकारी जांचें। सही सेल्समैन और डिफॉल्ट वेयरहाउस चुनकर अप्रूव एंड मैप रिटेलर करें।",
        "body": "Pending registration ki details check karo. Sahi salesperson aur default warehouse map karke approve karo.",
        "example": "Registration checked, salesperson selected",
        "task": "Is situation mein sahi action chuno.",
        "choices": [
          "Ignore salesperson",
          "Approve & map retailer",
          "Create sales order first"
        ],
        "answer": 1,
        "success": "Sahi! Pending registration ki details check karo. Sahi salesperson aur default warehouse map karke approve karo."
      },
      {
        "title": "Hidden guides share karo",
        "screen": "Profile / Share training",
        "speech": "“Hidden guides share karo — saath mein practice karein.”",
        "narration": "शेयर ट्रेनिंग में यूज़र चुनें। उसके रजिस्टर्ड रोल की ही गाइड भेजें। दोनों एडमिन सभी प्रशिक्षण देख सकते हैं। सेल्समैन अपने रिटेलर की गाइड साझा कर सकता है।",
        "body": "Main admin aur WhatsApp admin sab training dekh sakte hain. Staff ko uske role ki guide share karo. Salesman retailer ka public link naye ya purane retailer ko bhej sakta hai.",
        "example": "Purchaser user ko training bhejni hai",
        "task": "Is situation mein sahi action chuno.",
        "choices": [
          "Admin guide",
          "Purchaser guide",
          "Warehouse guide"
        ],
        "answer": 1,
        "success": "Sahi! Main admin aur WhatsApp admin sab training dekh sakte hain. Staff ko uske role ki guide share karo. Salesman retailer ka public link naye ya purane retailer ko bhej sakta hai."
      }
    ]
  },
  {
    "slug": "delivery-collection",
    "title": "Delivery + Collection",
    "steps": [
      {
        "title": "Assigned task kholo",
        "screen": "Current Delivery / New Assignment",
        "speech": "“Assigned task kholo — saath mein practice karein.”",
        "narration": "अपना असाइन किया हुआ काम खोलें। खरीद पिकअप है या ग्राहक डिलीवरी, सही ऑर्डर और पता देखें।",
        "body": "Apna assigned task padho. Purchase pickup ya sales delivery ka order, address aur person verify karo.",
        "example": "Task aapko assigned hai",
        "task": "Is situation mein sahi action chuno.",
        "choices": [
          "Kisi aur ka task",
          "Task details dekho",
          "Skip details"
        ],
        "answer": 1,
        "success": "Sahi! Apna assigned task padho. Purchase pickup ya sales delivery ka order, address aur person verify karo."
      },
      {
        "title": "Pickup par maal gino",
        "screen": "Current Delivery",
        "speech": "“Pickup par maal gino — saath mein practice karein.”",
        "narration": "पिकअप पर माल गिनें। दस की जगह नौ मिले तो नौ और कमी का नोट लिखें। बिना मिले दस दर्ज न करें।",
        "body": "Pickup par product aur quantity match karo. Kam ya damaged maal ho to note/proof ke saath manager ko batao.",
        "example": "10 packets expected · 9 mile",
        "task": "Is situation mein sahi action chuno.",
        "choices": [
          "10 received",
          "9 actual + shortage note",
          "Delivered"
        ],
        "answer": 1,
        "success": "Sahi! Pickup par product aur quantity match karo. Kam ya damaged maal ho to note/proof ke saath manager ko batao."
      },
      {
        "title": "Handover aur proof",
        "screen": "Current Delivery",
        "speech": "“Handover aur proof — saath mein practice karein.”",
        "narration": "सही व्यक्ति को सामान सौंपें और प्रूफ रखें। सिर्फ चल पड़ने से डिलीवरी पूरी नहीं होती।",
        "body": "Sahi recipient ko maal do; proof aur actual status record karo. Sirf nikalne se Delivered nahi hota.",
        "example": "Maal recipient tak nahi pahuncha",
        "task": "Is situation mein sahi action chuno.",
        "choices": [
          "Delivered",
          "In transit",
          "Closed"
        ],
        "answer": 1,
        "success": "Sahi! Sahi recipient ko maal do; proof aur actual status record karo. Sirf nikalne se Delivered nahi hota."
      },
      {
        "title": "Cash ka sahi record",
        "screen": "Current Delivery / Payment",
        "speech": "“Cash ka sahi record — saath mein practice karein.”",
        "narration": "पेमेंट का काम मिला है तो जितना पैसा सच में लिया या दिया उतना लिखें। हजार बाकी था और छह सौ मिला तो छह सौ दर्ज करें।",
        "body": "Collect Payment ya Deliver Payment assigned ho to actual money movement record karo. Proof/reference attach karo.",
        "example": "₹1000 due · ₹600 actually received",
        "task": "Is situation mein sahi action chuno.",
        "choices": [
          "₹1000",
          "₹600",
          "₹0"
        ],
        "answer": 1,
        "success": "Sahi! Collect Payment ya Deliver Payment assigned ho to actual money movement record karo. Proof/reference attach karo."
      },
      {
        "title": "Actual amount lo",
        "screen": "Collection",
        "speech": "“Actual amount lo — saath mein practice karein.”",
        "narration": "जितनी रकम मिली उतनी दर्ज करें। चार सौ में से दो सौ पचास मिले तो दो सौ पचास ही भरें।",
        "body": "Jo amount mila wahi record karo. Payment mode, reference aur proof bharo.",
        "example": "₹400 due · ₹250 received",
        "task": "Is situation mein sahi action chuno.",
        "choices": [
          "₹400",
          "₹250",
          "Mark settled"
        ],
        "answer": 1,
        "success": "Sahi! Jo amount mila wahi record karo. Payment mode, reference aur proof bharo."
      },
      {
        "title": "Accounts ko trail do",
        "screen": "Collection / Payments",
        "speech": "“Accounts ko trail do — saath mein practice karein.”",
        "narration": "पैसा मिलने पर कलेक्टेड है। अकाउंट्स के मिलान के बाद रिकन्साइल्ड होगा। प्रूफ पूरा रखें।",
        "body": "Collected status ke baad accounts matching karega. Proof complete rakho; Reconciled ko collection se alag samjho.",
        "example": "Money received, accounts matching pending",
        "task": "Is situation mein sahi action chuno.",
        "choices": [
          "Reconciled",
          "Collected",
          "Settled automatically"
        ],
        "answer": 1,
        "success": "Sahi! Collected status ke baad accounts matching karega. Proof complete rakho; Reconciled ko collection se alag samjho."
      }
    ]
  }
];
