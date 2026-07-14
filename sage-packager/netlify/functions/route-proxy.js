// SIR route proxy — Netlify fallback for sirRouteProxy.
// Fetches a driving/walking/cycling route from OSRM and caches it in Netlify Blobs.
// Mirrors the Base44 sirRouteProxy response contract.

import { getStore } from '@netlify/blobs';

function openStore(name) {
  const siteID = process.env.SIR_BLOBS_SITE_ID || process.env.SITE_ID || process.env.NETLIFY_SITE_ID;
  const token = process.env.SIR_BLOBS_TOKEN || process.env.NETLIFY_AUTH_TOKEN || process.env.NETLIFY_API_TOKEN;
  const opts = { name, consistency: 'strong' };
  if (siteID && token) { opts.siteID = siteID; opts.token = token; }
  return getStore(opts);
}

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization,x-requested-with',
};

const CACHE_TTL_MS = 10 * 60 * 1000;
const OSRM_TIMEOUT_MS = 8000;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders },
  });

function normalizePoint(value, label) {
  if (!value || typeof value !== 'object') throw new Error(`${label} is required`);
  const lat = Number(value.lat ?? value.latitude);
  const lng = Number(value.lng ?? value.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error(`${label} must include numeric lat/lng`);
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) throw new Error(`${label} coordinates are out of range`);
  return { lat: Number(lat.toFixed(5)), lng: Number(lng.toFixed(5)) };
}

function cacheKey(profile, origin, destination) {
  return `${profile}_${origin.lng},${origin.lat};${destination.lng},${destination.lat}`.replace(/[^a-zA-Z0-9_.,-]/g, '_');
}

function isFresh(expiresAt) {
  return Boolean(expiresAt && new Date(expiresAt).getTime() > Date.now());
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST required' }, 405);

  let store = null;
  try { store = openStore('sir-route-cache'); } catch { store = null; }

  try {
    const body = await req.json().catch(() => ({}));
    const origin = normalizePoint(body.origin, 'origin');
    const destination = normalizePoint(body.destination, 'destination');
    const profile = ['driving', 'walking', 'cycling'].includes(String(body.profile || 'driving'))
      ? String(body.profile || 'driving') : 'driving';
    const key = cacheKey(profile, origin, destination);

    if (store) {
      const cached = await store.get(key, { type: 'json' }).catch(() => null);
      if (cached?.route && isFresh(cached.expires_at)) {
        return json({ ok: true, cached: true, source: 'netlify-route-cache', route: cached.route });
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OSRM_TIMEOUT_MS);
    const osrmUrl = `https://router.project-osrm.org/route/v1/${profile}/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson&steps=false&alternatives=false`;
    let response;
    try {
      response = await fetch(osrmUrl, { signal: controller.signal, headers: { 'user-agent': 'SAGE-smart-reminder-route-proxy/1.0' } });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) return json({ ok: false, error: 'Routing provider failed', status: response.status }, 502);
    const data = await response.json();
    const route = data?.routes?.[0];
    if (!route?.geometry?.coordinates?.length) return json({ ok: false, error: 'No route found' }, 404);

    const parsedRoute = {
      coordinates: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
      distance: Number(route.distance || 0),
      duration: Number(route.duration || 0),
      profile,
    };

    if (store) {
      await store.setJSON(key, {
        cache_key: key, profile, origin, destination, route: parsedRoute,
        expires_at: new Date(Date.now() + CACHE_TTL_MS).toISOString(),
      }).catch(() => {});
    }

    return json({ ok: true, cached: false, source: 'netlify-route-osrm', route: parsedRoute });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : 'Route proxy failed' }, 400);
  }
};

export const config = { path: '/api/route-proxy' };
