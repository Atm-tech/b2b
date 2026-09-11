import { allowedGuideSlugs, guideModules, normalizeGuideSlug, type UserRole } from "@aapoorti-b2b/domain";

export function trainingUrl(slug = "") {
  const origin = new URL(process.env.PUBLIC_WEB_URL || "https://b2b-api-theta.vercel.app").origin;
  return `${origin}/guide${slug ? `/${slug}` : ""}`;
}

export function trainingLinkReply(command: string, roles: readonly UserRole[] = [], admin = false) {
  const match = command.trim().match(/^\/?guide(?:\s+(.+))?$/i);
  if (!match) return null;
  const requested = match[1] ? normalizeGuideSlug(match[1].toLowerCase().replace(/\s+/g, "-")) : "";
  const allowed = allowedGuideSlugs(roles, admin);
  if (requested && requested !== "retailer" && !allowed.includes(requested as typeof allowed[number])) {
    return "Yeh training aapke registered module ke liye available nahi hai. Apni training ke liye guide likhein.";
  }
  if (requested) return `WhatsApp chat training:\n${trainingUrl(requested)}${requested === "retailer" ? "\nRetailer training sabke liye khuli hai." : "\nApne staff account se login karein."}`;
  if (admin || roles.includes("Admin")) return `Saare modules ki training:\n${trainingUrl()}\nApne admin account se login karein.`;
  const guides = allowed.length ? guideModules.filter(g => allowed.includes(g.slug)) : [guideModules[0]];
  return `WhatsApp chat training:\n${guides.map(g => `${g.title}: ${trainingUrl(g.slug)}`).join("\n")}\n${allowed.length ? "Apne registered staff account se login karein." : "Naye aur purane retailers, bina registration bhi seekh sakte hain."}`;
}

export function trainingBroadcastMessage() {
  return `Namaste {retailer}! Aapoorti B CONNECT par WhatsApp se order karna seekhein. Cartoon training mein har step ke saath audio aur replay hai. Naye aur purane retailers, sabke liye:\n${trainingUrl("retailer")}\nTraining ke baad Return to WhatsApp dabayein.`;
}

export function prepareTrainingBroadcast(input: { message: string; training?: boolean; templateName?: string; templateParameters?: string[] }) {
  const link = trainingUrl("retailer");
  const parameters = input.templateParameters?.map(p => p.replaceAll("{guide_link}", link));
  if (input.training && input.templateName?.trim() && !parameters?.some(p => p.slice(0, 1024).includes(link))) {
    throw new Error("Training template mein {guide_link} parameter zaroor daalein, approved template ke sahi parameter order mein.");
  }
  return { message: input.training ? trainingBroadcastMessage() : input.message.trim(), parameters };
}
