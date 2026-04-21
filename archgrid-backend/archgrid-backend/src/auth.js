// ─────────────────────────────────────────────────────────────
// ARCHGrid AI — Supabase Auth Client
// File: src/auth.js
//
// PURPOSE: Drop-in auth module. Paste into your HTML <script> 
//          or import as a module. Replaces the localStorage-based
//          auth in archgrid-spark.html with real Supabase auth.
//
// SETUP:
//   1. Go to supabase.com → New Project
//   2. Settings → API → copy Project URL and anon key
//   3. Replace SUPABASE_URL and SUPABASE_ANON_KEY below
//   4. Run supabase/schema.sql in your Supabase SQL Editor
//   5. In Supabase: Authentication → Providers → enable Google (optional)
// ─────────────────────────────────────────────────────────────

// ── CONFIG — replace these with your actual values ──
const SUPABASE_URL      = 'https://YOUR_PROJECT_ID.supabase.co';
const SUPABASE_ANON_KEY = 'eyJYOUR_ANON_KEY_HERE';

// Load Supabase client (add this script tag to your HTML <head>):
// <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ══════════════════════════════════════════════════════════════
// AUTH STATE
// ══════════════════════════════════════════════════════════════

let currentUser = null;
let currentProfile = null;

// Listen for auth state changes (login, logout, token refresh)
supabase.auth.onAuthStateChange(async (event, session) => {
  if (event === 'SIGNED_IN' && session?.user) {
    currentUser = session.user;
    currentProfile = await fetchProfile(session.user.id);
    onAuthSuccess(currentProfile);
  } else if (event === 'SIGNED_OUT') {
    currentUser = null;
    currentProfile = null;
    onAuthSignOut();
  }
});

// ══════════════════════════════════════════════════════════════
// SIGN UP with Email + Password
// ══════════════════════════════════════════════════════════════

async function signUp(email, password, fullName) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: window.location.origin,  // confirmation link redirect
    },
  });

  if (error) throw error;

  // Profile is auto-created by the Supabase trigger (handle_new_user)
  // Show "check your email" message if email confirmation is required
  if (data.user && !data.session) {
    return { needsEmailConfirmation: true };
  }

  return { user: data.user };
}

// ══════════════════════════════════════════════════════════════
// SIGN IN with Email + Password
// ══════════════════════════════════════════════════════════════

async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

// ══════════════════════════════════════════════════════════════
// SIGN IN with Google OAuth
// ══════════════════════════════════════════════════════════════

async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin,
    },
  });
  if (error) throw error;
}

// ══════════════════════════════════════════════════════════════
// SIGN OUT
// ══════════════════════════════════════════════════════════════

async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

// ══════════════════════════════════════════════════════════════
// PASSWORD RESET
// ══════════════════════════════════════════════════════════════

async function sendPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/reset-password',
  });
  if (error) throw error;
}

// ══════════════════════════════════════════════════════════════
// FETCH USER PROFILE (plan, credits, name)
// ══════════════════════════════════════════════════════════════

async function fetchProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (error) {
    console.error('Error fetching profile:', error);
    return null;
  }
  return data;
}

// ══════════════════════════════════════════════════════════════
// DEDUCT A CREDIT (free users only)
// ══════════════════════════════════════════════════════════════

async function deductCredit(userId, agentId, inputTokens, outputTokens) {
  // 1. Log the usage
  await supabase.from('usage_logs').insert({
    user_id: userId,
    agent_id: agentId,
    input_tokens: inputTokens || 0,
    output_tokens: outputTokens || 0,
    plan_at_time: currentProfile?.plan || 'free',
  });

  // 2. Deduct credit if on free plan
  if (currentProfile?.plan === 'free') {
    const newCredits = Math.max(0, (currentProfile.credits || 0) - 1);

    const { error } = await supabase
      .from('profiles')
      .update({ credits: newCredits, updated_at: new Date().toISOString() })
      .eq('id', userId);

    if (!error) {
      currentProfile.credits = newCredits;
    }

    return newCredits;
  }

  return 99999; // Pro users — effectively unlimited
}

// ══════════════════════════════════════════════════════════════
// CHECK IF USER HAS CREDITS
// ══════════════════════════════════════════════════════════════

function hasCredits() {
  if (!currentProfile) return false;
  if (currentProfile.plan !== 'free') return true;
  return (currentProfile.credits || 0) > 0;
}

function getCredits() {
  if (!currentProfile) return 0;
  if (currentProfile.plan !== 'free') return Infinity;
  return currentProfile.credits || 0;
}

function isPro() {
  return currentProfile?.plan === 'pro' ||
         currentProfile?.plan === 'pro_annual' ||
         currentProfile?.plan === 'enterprise';
}

// ══════════════════════════════════════════════════════════════
// CHECK SESSION ON PAGE LOAD
// ══════════════════════════════════════════════════════════════

async function initAuth() {
  const { data: { session } } = await supabase.auth.getSession();

  if (session?.user) {
    currentUser = session.user;
    currentProfile = await fetchProfile(session.user.id);
    return { loggedIn: true, profile: currentProfile };
  }

  return { loggedIn: false };
}

// ══════════════════════════════════════════════════════════════
// CALLBACKS — wire these to your UI
// Replace the function bodies with your actual UI update code
// ══════════════════════════════════════════════════════════════

function onAuthSuccess(profile) {
  // Called when user logs in or session is restored
  // Connect to your UI: hide auth screen, show main app, set user name etc.
  console.log('Auth success:', profile);

  // Example: enter the main app
  // document.getElementById('auth-screen').classList.add('hidden');
  // document.getElementById('main-app').style.display = 'grid';
  // document.getElementById('dash-name').textContent = profile.full_name?.split(' ')[0] || 'there';
  // updateCreditsUI(profile);
}

function onAuthSignOut() {
  // Called when user signs out
  // Connect to your UI: show auth screen, clear state etc.
  console.log('Signed out');

  // Example:
  // document.getElementById('auth-screen').classList.remove('hidden');
  // document.getElementById('main-app').style.display = 'none';
}

// ══════════════════════════════════════════════════════════════
// EXAMPLE: Full login form handler
// Drop this into your login button's onclick
// ══════════════════════════════════════════════════════════════

async function handleLoginForm(email, password, buttonEl) {
  buttonEl.disabled = true;
  buttonEl.textContent = 'Signing in…';

  try {
    await signIn(email, password);
    // onAuthStateChange will fire and call onAuthSuccess automatically
  } catch (error) {
    buttonEl.disabled = false;
    buttonEl.textContent = 'Sign In';

    // Map Supabase errors to user-friendly messages
    const msgs = {
      'Invalid login credentials': 'Incorrect email or password.',
      'Email not confirmed': 'Please confirm your email address first.',
      'User not found': 'No account found with this email.',
    };
    const msg = msgs[error.message] || 'Sign in failed. Please try again.';
    alert(msg); // Replace with your UI error display
  }
}

async function handleRegisterForm(email, password, fullName, buttonEl) {
  buttonEl.disabled = true;
  buttonEl.textContent = 'Creating account…';

  try {
    const result = await signUp(email, password, fullName);

    if (result.needsEmailConfirmation) {
      alert('Account created! Please check your email to confirm your address.');
      buttonEl.disabled = false;
      buttonEl.textContent = 'Create Account';
    }
    // If no email confirmation needed, onAuthStateChange fires automatically
  } catch (error) {
    buttonEl.disabled = false;
    buttonEl.textContent = 'Create Account';

    const msgs = {
      'User already registered': 'An account with this email already exists.',
      'Password should be at least 6 characters': 'Password must be at least 6 characters.',
    };
    alert(msgs[error.message] || error.message);
  }
}

// Export for use as a module (if using bundler)
// export { supabase, signUp, signIn, signInWithGoogle, signOut,
//          sendPasswordReset, fetchProfile, deductCredit,
//          hasCredits, getCredits, isPro, initAuth };
