// ─────────────────────────────────────────────────────────────
// ARCHGrid AI — Netlify Serverless Function
// File: netlify/functions/chat.js
//
// PURPOSE: Secure proxy between the browser and Anthropic API.
// Your ANTHROPIC_API_KEY stays on the server — never in the browser.
//
// SETUP:
//   1. Deploy this file to Netlify (auto-detected in netlify/functions/)
//   2. In Netlify Dashboard → Site Settings → Environment Variables → Add:
//        ANTHROPIC_API_KEY = sk-ant-xxxxxxxxxxxxxxxx
//   3. In your HTML, change the fetch URL to: /.netlify/functions/chat
// ─────────────────────────────────────────────────────────────

exports.handler = async (event, context) => {

  // ── CORS headers (allow your domain only in production) ──
  const headers = {
    'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  // Handle preflight OPTIONS request
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  // ── Parse request body ──
  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Invalid JSON body' }),
    };
  }

  const { messages, system, userId, plan } = body;

  // ── Basic validation ──
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'messages array is required' }),
    };
  }

  // ── Rate limiting by plan ──
  // Free users: max 10 messages/hour (enforced via Supabase — see rate-limit.js)
  // Pro users: unlimited
  // This is a basic check — full rate limiting is in Supabase Edge Function
  if (plan === 'free' && messages.length > 20) {
    return {
      statusCode: 429,
      headers,
      body: JSON.stringify({ error: 'Free plan limit reached. Upgrade to Pro.' }),
    };
  }

  // ── Call Anthropic API ──
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        system: system || 'You are a helpful enterprise architecture assistant.',
        messages: messages.slice(-10), // last 10 messages for context window
      }),
    });

    if (!response.ok) {
      const errData = await response.json();
      console.error('Anthropic API error:', errData);
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({ error: 'AI service error. Please try again.' }),
      };
    }

    const data = await response.json();

    // ── Return only what the frontend needs ──
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        content: data.content,
        usage: data.usage, // input_tokens + output_tokens for cost tracking
      }),
    };

  } catch (error) {
    console.error('Function error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server error. Please try again.' }),
    };
  }
};
