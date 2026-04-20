# ARCHGrid AI — Complete Deployment Guide

## What's in this package

```
archgrid-backend/
├── netlify.toml                          ← Netlify config (put in repo root)
├── index.html                            ← Your main app (archgrid-spark.html renamed)
├── netlify/
│   └── functions/
│       ├── package.json                  ← Dependencies for functions
│       ├── chat.js                       ← AI proxy (keeps API key secret)
│       ├── create-checkout.js            ← Stripe checkout session creator
│       └── stripe-webhook.js             ← Stripe event handler
├── src/
│   └── auth.js                           ← Supabase auth client
└── supabase/
    └── schema.sql                        ← Database setup (run once)
```

---

## STEP 1 — Create Accounts (All Free to Start)

| Service | URL | Time |
|---|---|---|
| GitHub | github.com | 2 min |
| Netlify | netlify.com | 2 min |
| Supabase | supabase.com | 3 min |
| Stripe | stripe.com | 10 min |
| Namecheap (domain) | namecheap.com | 5 min |

---

## STEP 2 — Setup Supabase (Database + Auth)

### 2a. Create project
1. Go to supabase.com → New Project
2. Name: `archgrid-ai`
3. Database password: save this somewhere safe
4. Region: **Middle East (Bahrain)** — closest to UAE users

### 2b. Run the database schema
1. Supabase Dashboard → SQL Editor → New Query
2. Paste entire contents of `supabase/schema.sql`
3. Click Run — you should see "Success" for all statements

### 2c. Get your API keys
Go to Settings → API and copy:
- **Project URL** → `https://xxxxx.supabase.co`
- **anon/public key** → `eyJxxxxx` (safe for browser)
- **service_role key** → `eyJxxxxx` (server-only — never in browser)

### 2d. Enable Google Auth (optional)
1. Supabase → Authentication → Providers → Google → Enable
2. Follow the Google Cloud Console steps shown
3. Add your domain to the redirect URLs

### 2e. Update auth.js
Open `src/auth.js` and replace:
```javascript
const SUPABASE_URL      = 'https://YOUR_PROJECT_ID.supabase.co';
const SUPABASE_ANON_KEY = 'eyJYOUR_ANON_KEY_HERE';
```

---

## STEP 3 — Setup Stripe (Payments)

### 3a. Create your products
1. Stripe Dashboard → Products → Add Product
2. Create 3 products:

| Product | Price | Billing |
|---|---|---|
| ARCHGrid Pro | AED 149 | Monthly recurring |
| ARCHGrid Pro Annual | AED 1,290 | Yearly recurring |
| ARCHGrid Enterprise | AED 599 | Monthly recurring |

3. Copy each **Price ID** (starts with `price_`) — you'll need these

### 3b. Create webhook endpoint
1. Stripe → Developers → Webhooks → Add Endpoint
2. URL: `https://YOUR-SITE.netlify.app/.netlify/functions/stripe-webhook`
3. Select events:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
4. Copy the **Signing Secret** (starts with `whsec_`)

---

## STEP 4 — Deploy to Netlify

### 4a. Create GitHub repository
```bash
# On your computer:
git init archgrid-ai
cd archgrid-ai

# Copy all files from this package into the folder
# Rename archgrid-spark.html to index.html

git add .
git commit -m "Initial ARCHGrid AI deployment"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/archgrid-ai.git
git push -u origin main
```

### 4b. Connect to Netlify
1. Netlify → Add New Site → Import from GitHub
2. Select your `archgrid-ai` repository
3. Build settings:
   - Build command: `cd netlify/functions && npm install`
   - Publish directory: `.`
4. Click Deploy

### 4c. Add Environment Variables
Netlify Dashboard → Site Settings → Environment Variables → Add:

```
ANTHROPIC_API_KEY         = sk-ant-xxxxxxxxxxxxxxxxxxxx
STRIPE_SECRET_KEY         = sk_live_xxxxxxxxxxxxxxxxxxxx
STRIPE_WEBHOOK_SECRET     = whsec_xxxxxxxxxxxxxxxxxxxx
STRIPE_PRICE_PRO_MONTHLY  = price_xxxxxxxxxxxxxxxxxxxx
STRIPE_PRICE_PRO_ANNUAL   = price_xxxxxxxxxxxxxxxxxxxx
STRIPE_PRICE_ENTERPRISE   = price_xxxxxxxxxxxxxxxxxxxx
SUPABASE_URL              = https://xxxx.supabase.co
SUPABASE_SERVICE_KEY      = eyJxxxxxxxxxxxxxxxxxxxx
YOUR_DOMAIN               = https://archgrid.io
ALLOWED_ORIGIN            = https://archgrid.io
```

### 4d. Update your HTML
In `index.html`, find the fetch call and change:
```javascript
// FROM:
const res = await fetch('https://api.anthropic.com/v1/messages', {

// TO:
const res = await fetch('/.netlify/functions/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    messages: chatHistory.slice(-10),
    system: agents[currentAgent].system,
    userId: currentUser?.id,
    plan: currentProfile?.plan || 'free'
  })
});
```

Also add the Supabase CDN script to your HTML `<head>`:
```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
```

---

## STEP 5 — Connect Your Domain

### 5a. Buy domain
- Go to namecheap.com → search `archgrid.io` → ~$13/year
- Or `archgrid.ae` on aeda.ae → ~AED 200/year (needs trade license)

### 5b. Connect to Netlify
1. Netlify → Domain Management → Add Custom Domain
2. Enter `archgrid.io`
3. Follow the DNS instructions (update nameservers at Namecheap)
4. SSL certificate is auto-generated (Let's Encrypt) — takes ~10 minutes

---

## STEP 6 — Test Everything

### Checklist before going live:
- [ ] Open site → AI agents respond (Netlify function working)
- [ ] Create test account → profile appears in Supabase dashboard
- [ ] Click "Upgrade to Pro" → Stripe checkout opens
- [ ] Use Stripe test card `4242 4242 4242 4242` → payment succeeds
- [ ] Check Supabase profiles table → plan changed to 'pro'
- [ ] Sign out → sign back in → still shows Pro plan
- [ ] Free user hits 3 credits → upgrade prompt appears

### Stripe test cards:
```
Success:        4242 4242 4242 4242
Card declined:  4000 0000 0000 0002
Requires auth:  4000 0025 0000 3155
Expiry: any future date  CVC: any 3 digits
```

---

## COST SUMMARY

### One-time setup costs:
| Item | Cost |
|---|---|
| Domain (archgrid.io) | ~$13/yr |
| UAE Trade License (for .ae + Stripe) | ~AED 5,750/yr |
| Development time | Your time |

### Monthly running costs (launch stage):
| Service | Cost |
|---|---|
| Netlify (free tier) | $0 |
| Supabase (free tier) | $0 |
| Anthropic API (~500 calls) | ~$15–30 |
| **Total** | **~$15–30/mo** |

### Break-even:
- **1 Pro subscriber** (AED 149/mo ≈ $40) covers all costs
- Everything above that is profit

---

## GOING LIVE CHECKLIST

- [ ] All environment variables set in Netlify
- [ ] Supabase schema.sql executed successfully
- [ ] Stripe products created with correct AED prices
- [ ] Stripe webhook endpoint added and verified
- [ ] Domain connected and SSL active
- [ ] End-to-end test completed (signup → use agent → upgrade → verify Pro)
- [ ] Privacy Policy page added (required by Stripe)
- [ ] Terms of Service page added
- [ ] Test on mobile device

---

## SUPPORT & NEXT STEPS

After launch, consider adding:
1. **Email notifications** — Resend.com (free tier: 100 emails/day)
   - Welcome email on signup
   - Payment confirmation
   - Credit low warning

2. **Analytics** — PostHog or Plausible (privacy-friendly)
   - Track which agents are most used
   - Monitor conversion free → pro

3. **Error monitoring** — Sentry free tier
   - Get alerts when functions fail

4. **Admin dashboard** — Supabase Table Editor shows all users, plans, usage

---

*ARCHGrid AI — Built for GCC Enterprise Architecture professionals*
*Dubai, UAE | archgrid.io*
