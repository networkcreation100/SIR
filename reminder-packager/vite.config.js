import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

function loadAgentEnv() {
  const envPath = path.resolve(process.cwd(), '../.agents/.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [key, ...rest] = trimmed.split('=');
    if (!process.env[key]) process.env[key] = rest.join('=').replace(/^['"]|['"]$/g, '');
  }
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (error) { reject(error); }
    });
    req.on('error', reject);
  });
}

function centsFromAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 1 || amount > 10000) return null;
  return Math.round(amount * 100);
}


async function stripeConfig(_req, res) {
  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY;
  if (!publishableKey) return sendJson(res, 500, { ok: false, error: 'Stripe publishable key is not configured.' });
  return sendJson(res, 200, { ok: true, publishable_key: publishableKey });
}

async function createStripePaymentIntent(req, res) {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) return sendJson(res, 500, { ok: false, error: 'Stripe is not configured in this preview.' });
  let body = {};
  try { body = await readJson(req); } catch (_) { return sendJson(res, 400, { ok: false, error: 'Invalid JSON body.' }); }
  const amountCents = centsFromAmount(body.amount);
  const email = String(body.email || '').trim();
  const name = String(body.name || '').trim();
  const phone = String(body.phone || '').trim();
  const country = String(body.country || 'US').trim().toUpperCase();
  const postalCode = String(body.postalCode || '').trim();
  if (!amountCents) return sendJson(res, 400, { ok: false, error: 'Invalid donation amount.' });
  if (!/^\S+@\S+\.\S+$/.test(email)) return sendJson(res, 400, { ok: false, error: 'Valid receipt email is required.' });
  if (!name || name.length < 2) return sendJson(res, 400, { ok: false, error: 'Cardholder name is required.' });
  const params = new URLSearchParams();
  params.set('amount', String(amountCents));
  params.set('currency', 'usd');
  params.set('receipt_email', email);
  params.set('description', 'SIR Premium Supporter');
  params.set('automatic_payment_methods[enabled]', 'true');
  params.set('metadata[app]', 'SIR');
  params.set('metadata[product]', 'premium_supporter');
  params.set('metadata[supporter_name]', name);
  params.set('metadata[supporter_email]', email);
  if (phone) params.set('metadata[supporter_phone]', phone);
  if (country) params.set('metadata[country]', country);
  if (postalCode) params.set('metadata[postal_code]', postalCode);
  const stripeRes = await fetch('https://api.stripe.com/v1/payment_intents', { method: 'POST', headers: { Authorization: `Bearer ${stripeSecretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: params });
  const result = await stripeRes.json().catch(() => ({}));
  if (!stripeRes.ok) return sendJson(res, 502, { ok: false, error: result?.error?.message || 'Stripe PaymentIntent failed.', stripe_status: stripeRes.status });
  return sendJson(res, 200, { ok: true, client_secret: result.client_secret, payment_intent: result.id });
}

async function verifyStripePaymentIntent(req, res) {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) return sendJson(res, 500, { ok: false, error: 'Stripe is not configured in this preview.' });
  let body = {};
  try { body = await readJson(req); } catch (_) { return sendJson(res, 400, { ok: false, error: 'Invalid JSON body.' }); }
  const paymentIntent = String(body.payment_intent || '').trim();
  if (!/^pi_[A-Za-z0-9_]+/.test(paymentIntent)) return sendJson(res, 400, { ok: false, error: 'Valid Stripe PaymentIntent ID is required.' });
  const stripeRes = await fetch(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(paymentIntent)}`, { headers: { Authorization: `Bearer ${stripeSecretKey}` } });
  const result = await stripeRes.json().catch(() => ({}));
  if (!stripeRes.ok) return sendJson(res, 502, { ok: false, error: result?.error?.message || 'Stripe payment verification failed.', stripe_status: stripeRes.status });
  if (result.status !== 'succeeded') return sendJson(res, 402, { ok: false, paid: false, error: 'Stripe payment has not succeeded yet.', payment_status: result.status });
  return sendJson(res, 200, { ok: true, paid: true, payment_intent: result.id, amount: typeof result.amount_received === 'number' ? result.amount_received / 100 : result.amount / 100, currency: result.currency, supporter_name: result.metadata?.supporter_name || '', supporter_email: result.metadata?.supporter_email || result.receipt_email || '' });
}

async function createStripeCheckout(req, res) {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) return sendJson(res, 500, { ok: false, error: 'Stripe is not configured in this preview.' });
  let body = {};
  try { body = await readJson(req); } catch (_) { return sendJson(res, 400, { ok: false, error: 'Invalid JSON body.' }); }
  const amountCents = centsFromAmount(body.amount);
  const email = String(body.email || '').trim();
  const name = String(body.name || '').trim();
  if (!amountCents) return sendJson(res, 400, { ok: false, error: 'Invalid donation amount.' });
  if (!/^\S+@\S+\.\S+$/.test(email)) return sendJson(res, 400, { ok: false, error: 'Valid receipt email is required.' });
  if (!name || name.length < 2) return sendJson(res, 400, { ok: false, error: 'Supporter name is required.' });
  const origin = req.headers.origin || `http://${req.headers.host}`;
  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('success_url', `${origin}/?sir_payment=stripe_success&session_id={CHECKOUT_SESSION_ID}`);
  params.set('cancel_url', `${origin}/?sir_payment=stripe_cancelled`);
  params.set('customer_email', email);
  params.set('client_reference_id', email);
  params.set('metadata[app]', 'SIR');
  params.set('metadata[product]', 'premium_supporter');
  params.set('metadata[supporter_name]', name);
  params.set('metadata[supporter_email]', email);
  params.set('payment_intent_data[metadata][app]', 'SIR');
  params.set('payment_intent_data[metadata][product]', 'premium_supporter');
  params.set('line_items[0][quantity]', '1');
  params.set('line_items[0][price_data][currency]', 'usd');
  params.set('line_items[0][price_data][unit_amount]', String(amountCents));
  params.set('line_items[0][price_data][product_data][name]', 'SIR Premium Supporter');
  params.set('line_items[0][price_data][product_data][description]', 'Support this app and become a premium supporter.');
  const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: { Authorization: `Bearer ${stripeSecretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: params });
  const result = await stripeRes.json().catch(() => ({}));
  if (!stripeRes.ok) return sendJson(res, 502, { ok: false, error: result?.error?.message || 'Stripe Checkout failed.', stripe_status: stripeRes.status });
  return sendJson(res, 200, { ok: true, checkout_url: result.url, session_id: result.id });
}

async function verifyStripeCheckout(req, res) {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) return sendJson(res, 500, { ok: false, error: 'Stripe is not configured in this preview.' });
  let body = {};
  try { body = await readJson(req); } catch (_) { return sendJson(res, 400, { ok: false, error: 'Invalid JSON body.' }); }
  const sessionId = String(body.session_id || '').trim();
  if (!/^cs_(test|live)_[A-Za-z0-9_]+/.test(sessionId)) return sendJson(res, 400, { ok: false, error: 'Valid Stripe Checkout session ID is required.' });
  const stripeRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, { headers: { Authorization: `Bearer ${stripeSecretKey}` } });
  const result = await stripeRes.json().catch(() => ({}));
  if (!stripeRes.ok) return sendJson(res, 502, { ok: false, error: result?.error?.message || 'Stripe session verification failed.', stripe_status: stripeRes.status });
  if (result.payment_status !== 'paid' || result.status !== 'complete') return sendJson(res, 402, { ok: false, paid: false, error: 'Stripe payment has not been completed yet.', payment_status: result.payment_status, checkout_status: result.status });
  return sendJson(res, 200, { ok: true, paid: true, session_id: result.id, amount_total: result.amount_total, currency: result.currency, customer_email: result.customer_details?.email || result.customer_email || '', supporter_name: result.metadata?.supporter_name || result.customer_details?.name || '', supporter_email: result.metadata?.supporter_email || result.customer_details?.email || result.customer_email || '', payment_intent: result.payment_intent || '' });
}

function stripePreviewMiddleware() {
  loadAgentEnv();
  return (server) => {
    server.middlewares.use(async (req, res, next) => {
      if (req.method === 'OPTIONS' && req.url?.startsWith('/functions/stripe')) return sendJson(res, 204, {});
      if (req.method === 'POST' && req.url === '/functions/stripeConfig') return stripeConfig(req, res);
      if (req.method === 'POST' && req.url === '/functions/stripePremiumPaymentIntent') return createStripePaymentIntent(req, res);
      if (req.method === 'POST' && req.url === '/functions/stripeVerifyPaymentIntent') return verifyStripePaymentIntent(req, res);
      if (req.method === 'POST' && req.url === '/functions/stripePremiumCheckout') return createStripeCheckout(req, res);
      if (req.method === 'POST' && req.url === '/functions/stripeVerifyCheckoutSession') return verifyStripeCheckout(req, res);
      next();
    });
  };
}

export default defineConfig({
  plugins: [react(), { name: 'sir-stripe-preview-functions', configureServer: stripePreviewMiddleware(), configurePreviewServer: stripePreviewMiddleware() }],
  server: {
    host: '0.0.0.0',
    allowedHosts: true
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: true
  }
});
