-- ─────────────────────────────────────────────────────────────
-- ARCHGrid AI — Supabase Database Schema
-- File: supabase/schema.sql
--
-- PURPOSE: Complete database setup for ARCHGrid AI.
--          Run this in Supabase Dashboard → SQL Editor → New Query
--
-- TABLES:
--   profiles       — User accounts, plan, credits
--   usage_logs     — Track AI agent usage per user
--   payment_logs   — Stripe payment events log
--   sessions       — (Handled by Supabase Auth automatically)
-- ─────────────────────────────────────────────────────────────


-- ══════════════════════════════════════════════════════════════
-- 1. PROFILES TABLE
--    Extends Supabase auth.users with plan and credits
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.profiles (
  id                      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email                   TEXT NOT NULL UNIQUE,
  full_name               TEXT,
  avatar_url              TEXT,

  -- Plan management
  plan                    TEXT NOT NULL DEFAULT 'free'
                            CHECK (plan IN ('free', 'pro', 'pro_annual', 'enterprise')),
  credits                 INTEGER NOT NULL DEFAULT 3,
  credits_reset_at        TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days'),

  -- Stripe
  stripe_customer_id      TEXT UNIQUE,
  stripe_subscription_id  TEXT,
  plan_activated_at       TIMESTAMPTZ,

  -- Metadata
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast email lookups (used by Stripe webhook)
CREATE INDEX IF NOT EXISTS profiles_email_idx ON public.profiles(email);
CREATE INDEX IF NOT EXISTS profiles_stripe_customer_idx ON public.profiles(stripe_customer_id);


-- ══════════════════════════════════════════════════════════════
-- 2. USAGE LOGS TABLE
--    Track which agents users are using and token consumption
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.usage_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  agent_id        TEXT NOT NULL,  -- 'auditor', 'roadmap', 'coach', etc.
  input_tokens    INTEGER DEFAULT 0,
  output_tokens   INTEGER DEFAULT 0,
  plan_at_time    TEXT NOT NULL DEFAULT 'free',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS usage_logs_user_idx ON public.usage_logs(user_id);
CREATE INDEX IF NOT EXISTS usage_logs_created_idx ON public.usage_logs(created_at);


-- ══════════════════════════════════════════════════════════════
-- 3. PAYMENT LOGS TABLE
--    Audit trail of all Stripe events
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.payment_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL,
  invoice_id  TEXT,
  event       TEXT NOT NULL,  -- 'payment_failed', 'subscription_cancelled', etc.
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ══════════════════════════════════════════════════════════════
-- 4. ROW LEVEL SECURITY (RLS)
--    Users can only read/write their own data
-- ══════════════════════════════════════════════════════════════

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_logs ENABLE ROW LEVEL SECURITY;

-- Profiles: users can read and update only their own row
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- Usage logs: users can insert and read only their own logs
CREATE POLICY "Users can insert own usage"
  ON public.usage_logs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own usage"
  ON public.usage_logs FOR SELECT
  USING (auth.uid() = user_id);

-- Service role (used by Stripe webhook) bypasses RLS automatically


-- ══════════════════════════════════════════════════════════════
-- 5. AUTO-CREATE PROFILE ON SIGNUP
--    Trigger: when a new user signs up via Supabase Auth,
--    automatically create their profile row
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data ->> 'full_name',
    NEW.raw_user_meta_data ->> 'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach trigger to auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ══════════════════════════════════════════════════════════════
-- 6. AUTO-RESET FREE CREDITS MONTHLY
--    Function to reset free users back to 3 credits each month
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.reset_free_credits()
RETURNS void AS $$
BEGIN
  UPDATE public.profiles
  SET
    credits = 3,
    credits_reset_at = NOW() + INTERVAL '30 days',
    updated_at = NOW()
  WHERE
    plan = 'free'
    AND credits_reset_at <= NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Schedule this via Supabase Cron (Dashboard → Database → Cron Jobs):
-- Schedule: 0 0 * * *   (runs daily at midnight, checks reset_at date)
-- Command:  SELECT public.reset_free_credits();


-- ══════════════════════════════════════════════════════════════
-- 7. UPDATED_AT TRIGGER
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ══════════════════════════════════════════════════════════════
-- 8. USEFUL VIEWS (for Supabase dashboard / analytics)
-- ══════════════════════════════════════════════════════════════

-- Active users by plan
CREATE OR REPLACE VIEW public.plan_summary AS
SELECT
  plan,
  COUNT(*) AS user_count,
  SUM(CASE WHEN created_at > NOW() - INTERVAL '30 days' THEN 1 ELSE 0 END) AS new_last_30d
FROM public.profiles
GROUP BY plan;

-- Most used agents
CREATE OR REPLACE VIEW public.agent_popularity AS
SELECT
  agent_id,
  COUNT(*) AS total_calls,
  SUM(input_tokens + output_tokens) AS total_tokens,
  COUNT(DISTINCT user_id) AS unique_users
FROM public.usage_logs
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY agent_id
ORDER BY total_calls DESC;
