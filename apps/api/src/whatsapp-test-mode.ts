type Message = Record<string, unknown>;
type TestOrder = { id: string; shop: string; product: string; quantity: number; photo: boolean; packed: boolean };
export type WhatsAppTestState = { version: 1; orders: TestOrder[]; selected?: string; changing?: boolean; handedOver?: boolean };

// These are simulation fixtures only. Never insert them into sales, stock or ledgers.
export function createWhatsAppTestState(): WhatsAppTestState {
  return {
    version: 1,
    orders: [1, 2, 3].map((number) => ({
      id: `TEST-SO-${number}`, shop: `Test Shop ${number}`, product: "Dummy training pack",
      quantity: number * 2, photo: false, packed: false
    }))
  };
}

function reply(body: string): Message {
  return { type: "text", text: { body: `*TEST MODE — practice only*\n${body}` } };
}

function buttons(body: string, choices: Array<[string, string]>): Message {
  return { type: "interactive", interactive: {
    type: "button", body: { text: `*TEST MODE — practice only*\n${body}` },
    action: { buttons: choices.map(([id, title]) => ({ type: "reply", reply: { id: `wa-test:${id}`, title } })) }
  } };
}

function orderList(state: WhatsAppTestState): Message {
  return { type: "interactive", interactive: {
    type: "list", body: { text: "TEST MODE: Test Shop 1, 2, 3 ke dummy SO. Real stock/accounts par koi asar nahi. SO/LIST se yeh list; TEST RESET se dobara practice." },
    action: { button: "View test SO", sections: [{ title: "Test orders only", rows: state.orders.map((order) => ({
      id: `wa-test:order:${order.id}`, title: order.shop,
      description: `${order.id} | ${order.quantity} dummy packs | ${order.packed ? "Packed" : "Pending"}`
    })) }] }
  } };
}

function orderButtons(order: TestOrder): Message {
  return buttons(`${order.id}\n${order.shop}\n${order.product} x ${order.quantity}\nPractice photo bhejein, phir Packed. Photo sirf practice proof hai; OCR/weight verification nahi hota.`, [
    [`packed:${order.id}`, "Packed"], [`change:${order.id}`, "Change qty"]
  ]);
}

/** Pure simulator: no business database, inventory, payment or outbound-message access. */
export function handleWhatsAppTestMessage(current: WhatsAppTestState | undefined, message: Message): { state?: WhatsAppTestState; response?: Message; handled: boolean } {
  const command = String((message.text as Message | undefined)?.body || "").trim().toUpperCase().replace(/\s+/g, " ");
  const interactive = message.interactive as Message | undefined;
  const action = String(((interactive?.button_reply || interactive?.list_reply) as Message | undefined)?.id || "");
  if (command === "TEST" || command === "TEST RESET") {
    const state = command === "TEST RESET" || !current ? createWhatsAppTestState() : structuredClone(current);
    return { state, response: orderList(state), handled: true };
  }
  if (!current) {
    if (action.startsWith("wa-test:")) return { handled: true, response: reply("Test session active nahi hai. TEST type karein.") };
    return { handled: false };
  }
  const state = structuredClone(current);
  const result = (response: Message) => ({ state, response, handled: true });
  // Every message in an active test session is consumed; old live buttons must
  // never fall through to the production order handlers.
  if (command === "TEST EXIT") {
    return result(buttons("Test mode band karne ke baad SO mein REAL orders aayenge. Confirm karein.", [["exit", "Exit to live"], ["list", "Stay in test"]]));
  }
  if (action === "wa-test:exit") return { state: undefined, handled: true, response: reply("Test mode band. Ab SO/LIST LIVE data dikhayenge. Practice ke liye TEST type karein.") };
  if (["SO", "LIST", "MENU", "HELP", "START", "BACK"].includes(command) || action === "wa-test:list") {
    state.selected = undefined;
    state.changing = false;
    return result(orderList(state));
  }
  if (command === "DCO" || action === "wa-test:dco") {
    const packed = state.orders.filter((order) => order.packed);
    if (!packed.length) return result(reply("Pehle ek test SO pack karein. SO type karein."));
    return result(buttons(`TEST-DCO-1\n${packed.map((order) => `${order.shop}: ${order.quantity} dummy packs`).join("\n")}\nSimulated handover practice. Koi real dispatch nahi hoga.`, [["handover", "Test handover"], ["list", "Test SO list"]]));
  }
  if (action === "wa-test:handover") {
    if (!state.orders.some((order) => order.packed)) return result(reply("Pehle test SO pack karein."));
    state.handedOver = true;
    return result(reply("Test handover complete. Real stock, dispatch, delivery ya payment record nahi bana. TEST RESET se dobara practice karein."));
  }
  if (action.startsWith("wa-test:order:")) {
    const order = state.orders.find((item) => item.id === action.slice("wa-test:order:".length));
    if (!order) return result(reply("Test SO nahi mila. SO type karein."));
    state.selected = order.id;
    state.changing = false;
    return result(orderButtons(order));
  }
  const selected = state.orders.find((order) => order.id === state.selected);
  if (message.type === "image") {
    if (!selected) return result(reply("Pehle SO type karke test order select karein."));
    selected.photo = true;
    return result(buttons(`${selected.shop}: practice photo received. Weight/OCR verify nahi kiya gaya.`, [[`packed:${selected.id}`, "Packed"], [`change:${selected.id}`, "Change qty"]]));
  }
  if (action.startsWith("wa-test:packed:") || action.startsWith("wa-test:change:")) {
    if (!selected || action.split(":")[2] !== selected.id) return result(reply("Pehle SO se wahi test order select karein."));
    if (action.startsWith("wa-test:change:")) {
      state.changing = true;
      return result(reply(`${selected.shop}: nayi dummy quantity 1 se 100 type karein. BACK se cancel.`));
    }
    if (!selected.photo) return result(reply("Isi selected test SO ke liye pehle practice photo bhejein."));
    selected.packed = true;
    state.changing = false;
    return result(buttons(`${selected.shop}: TEST packed. Real stock change nahi hua.`, [["list", "Next test SO"], ["dco", "Test DCO"]]));
  }
  if (state.changing && selected && message.type === "text") {
    const quantity = Number(command);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) return result(reply("Dummy quantity 1 se 100 ka whole number bhejein."));
    selected.quantity = quantity;
    selected.photo = false;
    selected.packed = false;
    state.changing = false;
    return result(orderButtons(selected));
  }
  return result(reply("Test mode active hai. SO/LIST: dummy orders; DCO: test handover; TEST RESET: restart; TEST EXIT: live mode par jaane ki confirmation. Purane live order buttons yahan kaam nahi karte."));
}
