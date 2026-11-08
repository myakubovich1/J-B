import Stripe from "stripe";
import { entity, type Subscription } from "./contracts";
import { getStore, utcMonthStart } from "./store";

export type PlanId = "free" | "pro" | "autonomous";
function quota(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 0 || value > 100000)
    throw new Error(`Invalid quota configuration: ${name}`);
  return value;
}
export function planLimits(): Record<PlanId, number> {
  return {
    free: quota("PLAN_FREE_LIMIT", 5),
    pro: quota("PLAN_PRO_LIMIT", 100),
    autonomous: quota("PLAN_AUTONOMOUS_LIMIT", 300),
  };
}
export type PlanState = {
  plan: PlanId;
  limit: number;
  used: number;
  reserved: number;
  discovery: boolean;
  subscription: Subscription | null;
};
export async function getPlanState(userId: string): Promise<PlanState> {
  const store = getStore();
  const [subscriptions, usage] = await Promise.all([
    store.list("subscriptions", userId),
    store.list("usage_events", userId),
  ]);
  const subscription = subscriptions[0] || null;
  const entitled =
    subscription &&
    ["active", "trialing"].includes(subscription.status) &&
    (!subscription.periodEnd || new Date(subscription.periodEnd).getTime() > Date.now());
  const plan: PlanId = entitled ? subscription.plan : "free";
  const events = usage.filter(
    (x) => new Date(x.createdAt).getTime() >= new Date(utcMonthStart()).getTime(),
  );
  const verified = new Set(
    events.filter((x) => x.kind === "verified_submission").map((x) => x.applicationId),
  );
  const reserved = new Set(
    events
      .filter((x) => x.kind === "reservation" && !verified.has(x.applicationId))
      .map((x) => x.applicationId),
  );
  return {
    plan,
    limit: planLimits()[plan],
    used: verified.size,
    reserved: reserved.size,
    discovery: plan === "autonomous",
    subscription,
  };
}
let stripeClient: Stripe | undefined;
export function stripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("Stripe is not configured");
  stripeClient ||= new Stripe(process.env.STRIPE_SECRET_KEY);
  return stripeClient;
}
export function stripeReady(): boolean {
  return Boolean(
    process.env.STRIPE_SECRET_KEY &&
    process.env.STRIPE_WEBHOOK_SECRET &&
    process.env.STRIPE_PRO_PRICE_ID &&
    process.env.STRIPE_AUTONOMOUS_PRICE_ID,
  );
}
function planFromPrice(price: string): PlanId {
  if (price === process.env.STRIPE_AUTONOMOUS_PRICE_ID) return "autonomous";
  if (price === process.env.STRIPE_PRO_PRICE_ID) return "pro";
  return "free";
}
export async function reconcileSubscription(subscription: Stripe.Subscription): Promise<void> {
  const userId = subscription.metadata.career_user_id;
  if (!userId || !/^[a-zA-Z0-9_-]{1,100}$/.test(userId)) return;
  const store = getStore();
  const existing = (await store.list("subscriptions", userId))[0];
  // One record tracks the customer's current subscription. A late or retried event for a
  // replaced subscription (e.g. the cancellation of a previous one) must not overwrite it;
  // a different subscription takes over only once Stripe reports it as entitled.
  if (
    existing?.subscriptionId &&
    existing.subscriptionId !== subscription.id &&
    !["active", "trialing"].includes(subscription.status)
  )
    return;
  const item = subscription.items.data[0];
  const periodEnd = item?.current_period_end;
  const record: Subscription = {
    ...(existing || entity(userId)),
    plan: planFromPrice(item?.price.id || ""),
    status: subscription.status,
    customerId:
      typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id,
    subscriptionId: subscription.id,
    periodEnd: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
  };
  await store.save("subscriptions", record);
}
export async function createCheckout(
  userId: string,
  email: string,
  plan: Exclude<PlanId, "free">,
): Promise<string> {
  if (!stripeReady())
    throw new Error(
      "Stripe billing is not configured. Set the server keys, webhook secret, and plan price IDs.",
    );
  const state = await getPlanState(userId);
  if (
    state.subscription?.subscriptionId &&
    !["canceled", "incomplete_expired"].includes(state.subscription.status)
  )
    return createPortal(userId);
  const client = stripe();
  const customer =
    state.subscription?.customerId ||
    (
      await client.customers.create(
        { email, metadata: { career_user_id: userId } },
        { idempotencyKey: `customer-${userId}` },
      )
    ).id;
  const session = await client.checkout.sessions.create(
    {
      mode: "subscription",
      customer,
      client_reference_id: userId,
      line_items: [
        {
          price:
            plan === "pro"
              ? process.env.STRIPE_PRO_PRICE_ID!
              : process.env.STRIPE_AUTONOMOUS_PRICE_ID!,
          quantity: 1,
        },
      ],
      subscription_data: { metadata: { career_user_id: userId } },
      success_url: `${process.env.APP_URL || "http://127.0.0.1:3000"}/?billing=success#settings`,
      cancel_url: `${process.env.APP_URL || "http://127.0.0.1:3000"}/?billing=cancelled#settings`,
    },
    { idempotencyKey: `checkout-${userId}-${plan}-${Math.floor(Date.now() / 300000)}` },
  );
  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  return session.url;
}
export async function createPortal(userId: string): Promise<string> {
  const state = await getPlanState(userId);
  if (!state.subscription?.customerId) throw new Error("No billing account is connected");
  const session = await stripe().billingPortal.sessions.create({
    customer: state.subscription.customerId,
    return_url: `${process.env.APP_URL || "http://127.0.0.1:3000"}/#settings`,
  });
  return session.url;
}
export async function processStripeEvent(event: Stripe.Event): Promise<void> {
  if (event.type.startsWith("customer.subscription.")) {
    const received = event.data.object as Stripe.Subscription;
    // Retrieve the current object: an old webhook delivered late cannot restore an obsolete plan.
    const current = await stripe().subscriptions.retrieve(received.id);
    await reconcileSubscription(current);
  } else if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (typeof session.subscription === "string")
      await reconcileSubscription(await stripe().subscriptions.retrieve(session.subscription));
  }
}
