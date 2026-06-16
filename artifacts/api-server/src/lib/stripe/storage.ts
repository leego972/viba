import { db, subscribersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";

export function generateAccessToken(): string {
  return `viba_${crypto.randomBytes(24).toString("hex")}`;
}

export async function getSubscriberByToken(token: string) {
  const [sub] = await db
    .select()
    .from(subscribersTable)
    .where(eq(subscribersTable.accessToken, token));
  return sub ?? null;
}

export async function getSubscriberByCustomerId(customerId: string) {
  const [sub] = await db
    .select()
    .from(subscribersTable)
    .where(eq(subscribersTable.stripeCustomerId, customerId));
  return sub ?? null;
}

export async function createSubscriber(data: {
  email: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  status: string;
  trialEnd?: Date | null;
  currentPeriodEnd?: Date | null;
}) {
  const token = generateAccessToken();
  const [sub] = await db
    .insert(subscribersTable)
    .values({ ...data, accessToken: token })
    .onConflictDoUpdate({
      target: subscribersTable.stripeCustomerId,
      set: {
        stripeSubscriptionId: data.stripeSubscriptionId,
        status: data.status,
        trialEnd: data.trialEnd ?? null,
        currentPeriodEnd: data.currentPeriodEnd ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();
  return sub!;
}

export async function updateSubscriberBySubscriptionId(
  subscriptionId: string,
  updates: {
    status?: string;
    trialEnd?: Date | null;
    currentPeriodEnd?: Date | null;
  },
) {
  const [sub] = await db
    .update(subscribersTable)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(subscribersTable.stripeSubscriptionId, subscriptionId))
    .returning();
  return sub ?? null;
}
