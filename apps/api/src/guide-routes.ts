import express from "express";
import { allowedGuideSlugs, guideModules, normalizeGuideSlug, type AppUser, type UserRole } from "@aapoorti-b2b/domain";
import type { executeDatabaseQuery, getUserBySessionToken } from "./db.js";
import { trainingGuides } from "./guide-content.js";

type Dependencies = { isAdmin: (user: AppUser) => boolean; query: typeof executeDatabaseQuery; getUserByToken: typeof getUserBySessionToken };
class GuideError extends Error { constructor(public status: number, message: string) { super(message); } }
export function createGuideRouter({ isAdmin, query: executeDatabaseQuery, getUserByToken: getUserBySessionToken }: Dependencies) {
  const router = express.Router();
  router.use((_req, res, next) => { res.set("Cache-Control", "no-store"); res.set("X-Robots-Tag", "noindex, nofollow"); next(); });
  const route = (handler: (req: express.Request) => Promise<unknown>) => async (req: express.Request, res: express.Response) => {
    try { res.json(await handler(req)); }
    catch (error) { if (!(error instanceof GuideError)) console.error("Guide request failed", error); res.status(error instanceof GuideError ? error.status : 500).json({ message: error instanceof GuideError ? error.message : "Training load nahi hui. Dobara try karein." }); }
  };
  const staff = async (req: express.Request) => {
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    return token ? getUserBySessionToken(token) : null;
  };
  const mustStaff = async (req: express.Request) => { const user = await staff(req); if (!user) throw new GuideError(401, "Apne registered staff account se login karein."); return user; };
  const whatsappUrl = (message = "") => {
    const phone = (process.env.WHATSAPP_DISPLAY_PHONE || process.env.WHATSAPP_BUSINESS_PHONE || "").replace(/\D/g, "");
    return phone ? `https://wa.me/${phone}${message ? `?text=${encodeURIComponent(message)}` : ""}` : "https://wa.me/";
  };
  router.get("/catalog", route(async (req) => {
    const user = await mustStaff(req);
    return { name: user.fullName, allGuides: isAdmin(user), canShare: isAdmin(user) || user.roles.includes("Sales"), guides: guideModules.filter(g => g.slug === "retailer" || allowedGuideSlugs(user.roles, isAdmin(user)).includes(g.slug)), whatsappUrl: whatsappUrl() };
  }));
  router.get("/recipients", route(async (req) => {
    const user = await mustStaff(req); const admin = isAdmin(user);
    if (!admin && !user.roles.includes("Sales")) throw new GuideError(403, "Training links share karne ka access nahi hai.");
    const retailers = await executeDatabaseQuery(`SELECT r.counterparty_id AS id,p.name,r.phone_e164 AS phone
      FROM whatsapp_retailers r JOIN counterparties p ON p.id=r.counterparty_id
      WHERE r.active=TRUE AND ($1::boolean OR r.salesman_id=$2) ORDER BY p.name`, [admin, user.id]);
    const users = admin ? await executeDatabaseQuery<{ id: number; name: string; phone: string; role: UserRole; roles: UserRole[] }>(`SELECT id,full_name AS name,mobile_number AS phone,role,roles_json AS roles FROM users WHERE active=TRUE ORDER BY full_name`) : { rows: [] };
    return { retailers: retailers.rows, users: users.rows.map(u => ({ id: u.id, name: u.name, phone: u.phone, guides: allowedGuideSlugs(u.roles.length ? u.roles : [u.role]) })) };
  }));
  router.get("/:slug", route(async (req) => {
    const slug = normalizeGuideSlug(String(req.params.slug));
    const guide = trainingGuides.find(g => g.slug === slug);
    if (!guide) throw new GuideError(404, "Yeh training guide nahi mili.");
    if (slug === "retailer") return { guide, whatsappUrl: whatsappUrl(), name: "Sabhi retailers ke liye" };
    const user = await staff(req);
    if (user && allowedGuideSlugs(user.roles, isAdmin(user)).includes(guide.slug)) return { guide, whatsappUrl: whatsappUrl(), name: user.fullName };
    throw new GuideError(user ? 403 : 401, user ? "Yeh guide aapke registered role ke liye nahi hai." : "Is guide ke liye apni identity verify karein.");
  }));
  return router;
}
