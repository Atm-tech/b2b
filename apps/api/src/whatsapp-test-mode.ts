type Message = Record<string, unknown>;
type TestOrder = { id: string; shop: string; product: string; quantity: number; photo: boolean; packed: boolean };
export type TestAgent = { username: string; fullName: string; active: boolean; role: string; roles: string[] };
type TestDco = { id: string; orderIds: string[]; assignedTo?: string; handedOver?: boolean };
export type WhatsAppTestState = { version: 1; orders: TestOrder[]; selected?: string; changing?: boolean; handedOver?: boolean; dcos?: TestDco[]; chosenSos?: string[]; selectedDco?: string; selectedAgent?: string };

export function isDeliveryCollectionAgent(agent: TestAgent) {
  return agent.active && [agent.role, ...agent.roles].some((role) => role === "Delivery" || role === "Out Delivery");
}

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
  const pending = state.orders.filter((order) => !order.packed);
  if (!pending.length) return buttons("Saare test SO packed hain. DCO se inhe bundle karein.", [["dco", "Test DCO"]]);
  return { type: "interactive", interactive: {
    type: "list", body: { text: "TEST MODE: Test Shop 1, 2, 3 ke dummy SO. Real stock/accounts par koi asar nahi. SO/LIST se yeh list; TEST RESET se dobara practice." },
    action: { button: "View test SO", sections: [{ title: "Pending packing", rows: pending.map((order) => ({
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
export function handleWhatsAppTestMessage(current: WhatsAppTestState | undefined, message: Message, users: TestAgent[] = []): { state?: WhatsAppTestState; response?: Message; handled: boolean } {
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
  const dcos = state.dcos || [];
  const chosen = state.chosenSos || [];
  const available = state.orders.filter((order) => order.packed && !dcos.some((dco) => dco.orderIds.includes(order.id)));
  const list = (body: string, label: string, rows: Array<{ id: string; title: string; description?: string }>) => ({ type: "interactive", interactive: { type: "list", body: { text: `TEST MODE: ${body}` }, action: { button: label, sections: [{ title: "Practice only", rows }] } } });
  if (command === "DCO" || action === "wa-test:dco") {
    return result(buttons("Multiple packed SO select karke ek DCO banayein. Phir Handover > active agent > Send. Assignment yahan simulated hai.", [["dco-new", "Create DCO"], ["dco-ready", "Handover DCO"]]));
  }
  if (action === "wa-test:dco-new" || action === "wa-test:dco-more") {
    if (action === "wa-test:dco-new") state.chosenSos = [];
    const remaining = available.filter((order) => !(state.chosenSos || []).includes(order.id));
    if (!remaining.length) return result((state.chosenSos || []).length ? buttons("Saare available test SO select ho gaye.", [["dco-create", "Create DCO"]]) : reply("Pehle test SO pack karein. Ek SO ek hi DCO mein jayega."));
    return result(list("Ek SO select karein; Add another se aur SO jodein.", "Packed test SO", remaining.map((order) => ({ id: `wa-test:dco-add:${order.id}`, title: order.shop, description: `${order.id} | ${order.quantity} packs` }))));
  }
  if (action.startsWith("wa-test:dco-add:")) {
    const orderId = action.slice("wa-test:dco-add:".length);
    if (!available.some((order) => order.id === orderId)) return result(reply("Test SO ready nahi hai ya pehle se DCO mein hai."));
    state.chosenSos = [...new Set([...chosen, orderId])];
    return result(buttons(`${state.chosenSos.length} SO selected: ${state.chosenSos.join(", ")}`, [["dco-more", "Add another"], ["dco-create", "Create DCO"]]));
  }
  if (action === "wa-test:dco-create") {
    if (!chosen.length || chosen.some((id) => !available.some((order) => order.id === id))) return result(reply("Packed SO dobara select karein. DCO type karein."));
    const dco: TestDco = { id: `TEST-DCO-${dcos.length + 1}`, orderIds: [...chosen] };
    state.dcos = [...dcos, dco]; state.chosenSos = [];
    return result(reply(`${dco.id} created with ${chosen.length} SO. Agent abhi assign nahi hua. Ab DCO > Handover DCO select karein.`));
  }
  if (action === "wa-test:dco-ready") {
    const ready = dcos.filter((dco) => !dco.handedOver);
    return result(ready.length ? list("Handover ke liye test DCO select karein.", "Ready test DCO", ready.map((dco) => ({ id: `wa-test:dco-open:${dco.id}`, title: dco.id, description: `${dco.orderIds.length} SO` }))) : reply("Handover ke liye test DCO nahi hai. Pehle Create DCO karein."));
  }
  if (action.startsWith("wa-test:dco-open:")) {
    const dco = dcos.find((item) => item.id === action.slice("wa-test:dco-open:".length) && !item.handedOver);
    if (!dco) return result(reply("Test DCO ab ready nahi hai. DCO type karein."));
    state.selectedDco = dco.id; state.selectedAgent = undefined;
    return result(buttons(`${dco.id}\n${dco.orderIds.join("\n")}`, [[`dco-handover:${dco.id}`, "Handover"]]));
  }
  if (action.startsWith("wa-test:dco-handover:") || action.startsWith("wa-test:dco-agent:") || action.startsWith("wa-test:dco-send:")) {
    const parts = action.split(":");
    const dco = dcos.find((item) => item.id === parts[2] && item.id === state.selectedDco && !item.handedOver);
    if (!dco) return result(reply("Test DCO dobara select karein."));
    const agents = users.filter(isDeliveryCollectionAgent);
    if (parts[1] === "dco-handover") {
      state.selectedAgent = undefined;
      const page = Math.max(0, Number(parts[3]) || 0);
      const rows = agents.slice(page * 9, page * 9 + 9).map((agent) => ({ id: `wa-test:dco-agent:${dco.id}:${encodeURIComponent(agent.username)}`, title: agent.fullName.slice(0, 24), description: agent.username.slice(0, 72) }));
      if (!rows.length) return result(reply("Active Delivery + Collection agent nahi mila."));
      if (agents.length > page * 9 + 9) rows.push({ id: `wa-test:dco-handover:${dco.id}:${page + 1}`, title: "Next agents", description: "Aur active agents" });
      return result(list("Active agent select karein. Test assignment se real agent ko task/message nahi jayega.", "Select agent", rows));
    }
    const username = decodeURIComponent(parts[3] || "");
    const agent = agents.find((item) => item.username === username);
    if (!agent) return result(reply("Agent ab active nahi hai. Handover se dobara select karein."));
    if (parts[1] === "dco-agent") {
      state.selectedAgent = agent.username;
      return result(buttons(`${dco.id} (${dco.orderIds.length} SO)\nAgent: ${agent.fullName}\nSend se TEST assignment confirm hoga.`, [[`dco-send:${dco.id}:${encodeURIComponent(agent.username)}`, "Send"], [`dco-handover:${dco.id}`, "Change agent"]]));
    }
    if (state.selectedAgent !== agent.username) return result(reply("Agent dobara select karein; purana Send button hai."));
    dco.assignedTo = agent.username; dco.handedOver = true; state.dcos = dcos;
    state.selectedAgent = undefined;
    return result(reply(`${dco.id}: ${dco.orderIds.length} SO ka simulated handover ${agent.fullName} ko complete. Live flow mein yahin agent ki delivery/collection LIST shuru hogi. Is test mein real task/message nahi bheja gaya.`));
  }
  if (action.startsWith("wa-test:order:")) {
    const order = state.orders.find((item) => item.id === action.slice("wa-test:order:".length));
    if (!order) return result(reply("Test SO nahi mila. SO type karein."));
    if (order.packed) return result(reply("Yeh test SO already packed hai. DCO type karke bundle karein."));
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
    if (dcos.some((dco) => dco.orderIds.includes(selected.id))) return result(reply("Yeh SO DCO mein bundle ho chuka hai. Practice dobara karne ke liye TEST RESET karein."));
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
