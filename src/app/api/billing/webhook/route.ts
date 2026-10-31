import { NextResponse } from "next/server";
import { appMode, localDb, supabaseService } from "@/lib/store";
import { processStripeEvent, stripe } from "@/lib/billing";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !secret)
    return NextResponse.json({ error: "Webhook is not configured" }, { status: 400 });
  let event;
  try {
    event = stripe().webhooks.constructEvent(await request.text(), signature, secret);
  } catch {
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 400 });
  }
  try {
    let claimed = false;
    if (appMode() === "supabase") {
      const { data, error } = await supabaseService().rpc("claim_webhook_event", {
        p_id: event.id,
      });
      if (error) throw error;
      claimed = data === true;
    } else {
      const db = localDb();
      claimed = Boolean(
        db
          .prepare(
            "INSERT INTO webhook_events VALUES(?,'processing',?) ON CONFLICT(id)DO UPDATE SET status='processing',updated_at=excluded.updated_at WHERE webhook_events.status='failed' OR(webhook_events.status='processing' AND webhook_events.updated_at<?)",
          )
          .run(event.id, new Date().toISOString(), new Date(Date.now() - 300000).toISOString())
          .changes,
      );
    }
    if (!claimed) {
      let status: string | undefined;
      if (appMode() === "supabase") {
        const { data, error } = await supabaseService()
          .from("webhook_events")
          .select("status")
          .eq("id", event.id)
          .maybeSingle();
        if (error) throw error;
        status = data?.status;
      } else
        status = (
          localDb().prepare("SELECT status FROM webhook_events WHERE id=?").get(event.id) as
            { status: string } | undefined
        )?.status;
      return NextResponse.json(
        { received: status === "processed", duplicate: true },
        { status: status === "processed" ? 200 : 503 },
      );
    }
    try {
      await processStripeEvent(event);
      if (appMode() === "supabase") {
        const { error } = await supabaseService()
          .from("webhook_events")
          .update({ status: "processed", updated_at: new Date().toISOString() })
          .eq("id", event.id);
        if (error) throw error;
      } else
        localDb()
          .prepare("UPDATE webhook_events SET status='processed',updated_at=? WHERE id=?")
          .run(new Date().toISOString(), event.id);
    } catch (error) {
      if (appMode() === "supabase")
        await supabaseService()
          .from("webhook_events")
          .update({ status: "failed", updated_at: new Date().toISOString() })
          .eq("id", event.id);
      else localDb().prepare("UPDATE webhook_events SET status='failed' WHERE id=?").run(event.id);
      throw error;
    }
    return NextResponse.json({ received: true });
  } catch {
    return NextResponse.json(
      { error: "Webhook processing failed; Stripe should retry" },
      { status: 500 },
    );
  }
}
