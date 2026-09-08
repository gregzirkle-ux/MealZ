'use strict';

const dns = require('node:dns').promises;
const net = require('node:net');
const { parseRecipeHtml } = require('../lib/recipe-parser');

const MAX_HTML_BYTES = 2_500_000;
const MAX_REDIRECTS = 4;
const FETCH_TIMEOUT_MS = 12_000;

function isPrivateIp(address) {
  if (!address) return true;
  const normalized = String(address).toLowerCase().split('%')[0];
  if (net.isIPv4(normalized)) {
    const p = normalized.split('.').map(Number);
    return p[0] === 0 || p[0] === 10 || p[0] === 127 ||
      (p[0] === 169 && p[1] === 254) ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && p[1] === 168) ||
      (p[0] === 100 && p[1] >= 64 && p[1] <= 127) ||
      (p[0] === 198 && (p[1] === 18 || p[1] === 19)) ||
      p[0] >= 224;
  }
  if (net.isIPv6(normalized)) {
    if (normalized === '::1' || normalized === '::') return true;
    if (/^(fc|fd)/.test(normalized) || /^(fe8|fe9|fea|feb)/.test(normalized)) return true;
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
  }
  return false;
}

async function assertPublicUrl(url) {
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http and https recipe URLs are supported.');
  const host = url.hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (!host || host === 'localhost' || host.endsWith('.local')) throw new Error('That recipe address is not allowed.');
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error('That recipe address is not allowed.');
    return;
  }
  const results = await dns.lookup(host, { all: true, verbatim: true });
  if (!results.length || results.some(r => isPrivateIp(r.address))) throw new Error('That recipe address could not be safely reached.');
}

async function fetchHtml(startUrl) {
  let current = new URL(startUrl);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    await assertPublicUrl(current);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent': 'Mealz Recipe Importer/1.0 (+personal recipe organizer)',
          'accept': 'text/html,application/xhtml+xml'
        }
      });
    } finally {
      clearTimeout(timer);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('The recipe site redirected without a destination.');
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) throw new Error(`The recipe site returned ${response.status}.`);
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) throw new Error('That URL is not an HTML recipe page.');
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength && contentLength > MAX_HTML_BYTES) throw new Error('That recipe page is too large to import safely.');
    const html = await response.text();
    if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) throw new Error('That recipe page is too large to import safely.');
    return { html, finalUrl: current.toString() };
  }
  throw new Error('Too many redirects while opening that recipe.');
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST to import a recipe.' });

  try {
    let body = req.body || {};
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    const rawUrl = String(body?.url || '').trim();
    if (!rawUrl) return res.status(400).json({ error: 'Paste a recipe URL first.' });
    const parsedUrl = new URL(rawUrl);
    const { html, finalUrl } = await fetchHtml(parsedUrl.toString());
    const recipe = parseRecipeHtml(html, finalUrl);
    return res.status(200).json({ recipe });
  } catch (error) {
    const message = error?.name === 'AbortError'
      ? 'That recipe site took too long to respond.'
      : (error?.message || 'Mealz could not import that recipe.');
    const status = ['NO_RECIPE', 'INCOMPLETE_RECIPE'].includes(error?.code) ? 422 : 400;
    return res.status(status).json({ error: message });
  }
};
