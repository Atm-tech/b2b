import webpush from "web-push";
import { executeDatabaseQuery } from "./db.js";

type PushSubscriptionInput = { endpoint: string; keys: { p256dh: string; auth: string } };

function configured() {
  const publicKey = String(process.env.WEB_PUSH_VAPID_PUBLIC_KEY || "");
  const privateKey = String(process.env.WEB_PUSH_VAPID_PRIVATE_KEY || "");
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails("mailto:tech@aapoorti.com", publicKey, privateKey);
  return true;
}

export function webPushPublicKey() {
  return String(process.env.WEB_PUSH_VAPID_PUBLIC_KEY || "");
}

export async function savePushSubscription(userId: number, subscription: PushSubscriptionInput) {
  if (!subscription?.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) throw new Error("Invalid notification subscription.");
  await executeDatabaseQuery(
    `INSERT INTO web_push_subscriptions (user_id,endpoint,subscription_json,created_at,updated_at)
     VALUES ($1,$2,$3::jsonb,NOW(),NOW())
     ON CONFLICT (endpoint) DO UPDATE SET user_id=EXCLUDED.user_id,subscription_json=EXCLUDED.subscription_json,updated_at=NOW()`,
    [userId, subscription.endpoint, JSON.stringify(subscription)]
  );
}

export async function sendPushToUser(userId: number, title: string, body: string, url = "/") {
  if (!configured()) return;
  const subscriptions = await executeDatabaseQuery<{ endpoint: string; subscription_json: PushSubscriptionInput }>(
    `SELECT endpoint,subscription_json FROM web_push_subscriptions WHERE user_id=$1`, [userId]
  );
  await Promise.all(subscriptions.rows.map(async (row) => {
    try {
      await webpush.sendNotification(row.subscription_json, JSON.stringify({ title, body, url }));
    } catch (error) {
      const statusCode = typeof error === "object" && error && "statusCode" in error ? Number((error as { statusCode: unknown }).statusCode) : 0;
      if (statusCode === 404 || statusCode === 410) await executeDatabaseQuery(`DELETE FROM web_push_subscriptions WHERE endpoint=$1`, [row.endpoint]);
      else console.error("Web push delivery failed", error);
    }
  }));
}
