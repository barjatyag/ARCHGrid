// ─────────────────────────────────────────────────────────────
// ARCHGrid AI — Stripe Webhook Handler
// File: netlify/functions/stripe-webhook.js
//
// PURPOSE: Listens to Stripe payment events and activates/
//          deactivates Pro plan in Supabase automatically.
//
// SETUP:
//   1. In Netlify Environment Variables, add:
//        STRIPE_SECRET_KEY       = sk_live_xxxxxxxxxxxxxxxx
//        STRIPE_WEBHOOK_SECRET   = whsec_xxxxxxxxxxxxxxxx
//        SUPABASE_URL            = https://xxxx.supabase.co
//        SUPABASE_SERVICE_KEY    = eyJxxxxxxxxxxxxxxxx  (service role key)
//
//   2. In Stripe Dashboard → Webhooks → Add endpoint:
//        URL: https://your-site.netlify.app/.netlify/functions/stripe-webhook
//        Events to listen for:
//          ✓ checkout.session.completed
//          ✓ customer.subscription.created
//          ✓ customer.subscription.updated
//          ✓ customer.subscription.deleted
//          ✓ invoice.payment_failed
//
//   3. Copy the Webhook Signing Secret from Stripe → paste as STRIPE_WEBHOOK_SECRET
// ─────────────────────────────────────────────────────────────

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

// Supabase admin client (service role — bypasses RLS)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── Plan mapping from Stripe Price IDs ──
// Set these Price IDs after creating products in Stripe Dashboard
const PLAN_MAP = {
  [process.env.STRIPE_PRICE_PRO_MONTHLY]:  { plan: 'pro',        credits: 99999 },
  [process.env.STRIPE_PRICE_PRO_ANNUAL]:   { plan: 'pro_annual', credits: 99999 },
  [process.env.STRIPE_PRICE_ENTERPRISE]:   { plan: 'enterprise', credits: 99999 },
};

exports.handler = async (event) => {

  // Only accept POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // ── Verify Stripe signature ──
  // This ensures the request is genuinely from Stripe, not a fake request
  const sig = event.headers['stripe-signature'];
  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  console.log(`Processing Stripe event: ${stripeEvent.type}`);

  // ── Handle events ──
  try {
    switch (stripeEvent.type) {

      // ── Payment completed (one-time or first subscription) ──
      case 'checkout.session.completed': {
        const session = stripeEvent.data.object;
        const customerEmail = session.customer_email || session.customer_details?.email;
        const priceId = session.line_items?.data?.[0]?.price?.id;

        if (customerEmail) {
          await activatePlan(customerEmail, priceId, session.customer, session.subscription);
        }
        break;
      }

      // ── Subscription created or updated ──
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = stripeEvent.data.object;
        const priceId = sub.items?.data?.[0]?.price?.id;
        const customer = await stripe.customers.retrieve(sub.customer);
        const email = customer.email;

        if (sub.status === 'active' || sub.status === 'trialing') {
          await activatePlan(email, priceId, sub.customer, sub.id);
        } else if (sub.status === 'canceled' || sub.status === 'unpaid') {
          await deactivatePlan(email);
        }
        break;
      }

      // ── Subscription cancelled ──
      case 'customer.subscription.deleted': {
        const sub = stripeEvent.data.object;
        const customer = await stripe.customers.retrieve(sub.customer);
        await deactivatePlan(customer.email);
        break;
      }

      // ── Payment failed ──
      case 'invoice.payment_failed': {
        const invoice = stripeEvent.data.object;
        const customer = await stripe.customers.retrieve(invoice.customer);
        console.warn(`Payment failed for: ${customer.email}`);
        // Optional: send email warning, don't deactivate immediately
        // Stripe retries automatically — deactivate only on subscription.deleted
        await logPaymentIssue(customer.email, invoice.id);
        break;
      }

      default:
        console.log(`Unhandled event type: ${stripeEvent.type}`);
    }

    return { statusCode: 200, body: JSON.stringify({ received: true }) };

  } catch (error) {
    console.error('Webhook processing error:', error);
    return { statusCode: 500, body: 'Internal server error' };
  }
};

// ── Activate Pro plan in Supabase ──
async function activatePlan(email, priceId, stripeCustomerId, subscriptionId) {
  const planData = PLAN_MAP[priceId] || { plan: 'pro', credits: 99999 };

  const { error } = await supabase
    .from('profiles')
    .update({
      plan: planData.plan,
      credits: planData.credits,
      stripe_customer_id: stripeCustomerId,
      stripe_subscription_id: subscriptionId,
      plan_activated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('email', email);

  if (error) {
    console.error('Supabase update error (activate):', error);
    throw error;
  }

  console.log(`✅ Activated ${planData.plan} for: ${email}`);
}

// ── Downgrade back to free plan ──
async function deactivatePlan(email) {
  const { error } = await supabase
    .from('profiles')
    .update({
      plan: 'free',
      credits: 3,
      stripe_subscription_id: null,
      plan_activated_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('email', email);

  if (error) {
    console.error('Supabase update error (deactivate):', error);
    throw error;
  }

  console.log(`🔽 Downgraded to free: ${email}`);
}

// ── Log payment failure (optional — extend to send email) ──
async function logPaymentIssue(email, invoiceId) {
  await supabase
    .from('payment_logs')
    .insert({
      email,
      invoice_id: invoiceId,
      event: 'payment_failed',
      created_at: new Date().toISOString(),
    });
}
