'use strict';

// Mealz keep alive.
// Vercel Cron calls this once a day (see vercel.json). It reads one row from
// Supabase so the free project always shows recent database activity and is
// never paused for inactivity.

const fs = require('node:fs');
const path = require('node:path');

const TIMEOUT_MS = 10_000;

function readConfig() {
  // Prefer Vercel environment variables if they are ever added.
  const envUrl = process.env.SUPABASE_URL;
  const envKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (envUrl && envKey) return { url: envUrl, key: envKey };

  // Otherwise reuse the same public values the app already ships in config.js.
  const text = fs.readFileSync(path.join(__dirname, '..', 'config.js'), 'utf8');
  const url = (text.match(/supabaseUrl:\s*'([^']+)'/) || [])[1];
  const key = (text.match(/supabasePublishableKey:\s*'([^']+)'/) || [])[1];
  if (!url || !key) throw new Error('Supabase URL or key not found in config.js');
  return { url, key };
}

module.exports = async function handler(req, res) {
  // When CRON_SECRET is set in Vercel, only Vercel Cron may call this.
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }

  res.setHeader('Cache-Control', 'no-store');

  try {
    const { url, key } = readConfig();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const response = await fetch(`${url}/rest/v1/keep_alive?select=id,label&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal
    });
    clearTimeout(timer);

    const body = await response.text();
    if (!response.ok) {
      console.error('keep-alive failed', response.status, body.slice(0, 300));
      res.status(502).json({ ok: false, status: response.status });
      return;
    }

    const rows = JSON.parse(body || '[]');
    console.log('keep-alive ok', new Date().toISOString(), rows.length);
    res.status(200).json({ ok: true, rows: rows.length, at: new Date().toISOString() });
  } catch (error) {
    console.error('keep-alive error', error && error.message);
    res.status(500).json({ ok: false, error: 'ping failed' });
  }
};
