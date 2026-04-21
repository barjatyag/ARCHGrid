// ─────────────────────────────────────────────────────────────
// ARCHGrid AI — Stripe Checkout Function
// File: netlify/functions/create-checkout.js
//
// PURPOSE: Creates a Stripe Checkout Session when user clicks
//          "Upgrade to Pro". Returns a checkout URL to redirect to.
//
// SETUP:
//   Environment variables needed (Netlify Dashboard):
//     STRIPE_SECRET_KEY           = sk_live_xxxxxxx
//     STRIPE_PRICE_PRO_MONTHLY    = price_xxxxxxx  (from Stripe Dashboard)
//     STRIPE_PRICE_PRO_ANNUAL     = price_xxxxxxx
//     STRIPE_PRICE_ENTERPRISE     = price_xxxxxxx
//     YOUR_DOMAIN                 = https://archgrid.io
//
// USAGE in frontend (replace openPayment() function):
//   async function openPayment(planId = 'pro_monthly') {
//     const res = await fetch('/.netlify/functions/create-checkout', {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/json' },
//       body: JSON.stringify({ planId, email: currentUser.email })
//     });
//     const { url } = await res.json();
//     window.location.href = url;  // redirect to Stripe hosted checkout
//   }
// ─────────────────────────────────────────────────────────────

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const PRICE_IDS = {
  pro_monthly:  process.env.STRIPE_PRICE_PRO_MONTHLY,
  pro_annual:   process.env.STRIPE_PRICE_PRO_ANNUAL,
  enterprise:   process.env.STRIPE_PRICE_ENTERPRISE,
};

const PLAN_NAMES = {
  pro_monthly:  'ARCHGrid Pro — Monthly',
  pro_annual:   'ARCHGrid Pro — Annual (Save 28%)',
  enterprise:   'ARCHGrid Enterprise',
};

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': process.env.YOUR_DOMAIN || '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method Not Allowed' };

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const { planId = 'pro_monthly', email, userId } = body;

  if (!email) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email is required' }) };
  }

  const priceId = PRICE_IDS[planId];
  if (!priceId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid plan ID' }) };
  }

  try {
    // ── Create Stripe Checkout Session ──
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',

      line_items: [{
        price: priceId,
        quantity: 1,
      }],

      // Pre-fill customer email
      customer_email: email,

      // Pass user metadata for webhook processing
      metadata: {
        userId:  userId || '',
        email:   email,
        planId:  planId,
      },

      // Success/cancel redirect URLs
      success_url: `${process.env.YOUR_DOMAIN}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${process.env.YOUR_DOMAIN}/?payment=cancelled`,

      // UAE VAT — collect billing address
      billing_address_collection: 'required',
      tax_id_collection: { enabled: true },

      // Allow promo codes
      allow_promotion_codes: true,

      // Subscription trial (optional — remove if not offering trial)
      // subscription_data: { trial_period_days: 7 },
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        url: session.url,
        sessionId: session.id,
      }),
    };

  } catch (error) {
    console.error('Stripe checkout error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to create checkout session' }),
    };
  }
};
