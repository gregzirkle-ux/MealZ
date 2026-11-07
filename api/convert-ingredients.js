'use strict';

// Mealz ingredient conversion (Phase 2).
// The app sends one recipe's ingredient lines. Claude splits each line into
// amount, unit, item, prep note and category, flags lines it is unsure about,
// and fills in servings and course when the recipe has none.
// Only signed in members of a Mealz household can call this.
// Needs ANTHROPIC_API_KEY in Vercel. ANTHROPIC_MODEL is optional.

const fs = require('node:fs');
const path = require('node:path');
const Anthropic = require('@anthropic-ai/sdk').default;

const DEFAULT_MODEL = 'claude-opus-5-5';
const MAX_LINES = 80;
const MAX_LINE_CHARS = 300;
const MAX_STEPS = 12;
const MAX_STEP_CHARS = 400;

const UNITS = [
  '', 'tsp', 'tbsp', 'cup', 'fl oz', 'pint', 'quart', 'gallon', 'ml', 'l',
  'oz', 'lb', 'g', 'kg',
  'clove', 'can', 'jar', 'bottle', 'package', 'bag', 'box', 'container',
  'bunch', 'head', 'stalk', 'sprig', 'leaf', 'slice', 'stick', 'piece', 'pinch', 'dash'
];
const CATEGORIES = ['Produce', 'Meat', 'Dairy', 'Bakery', 'Pantry', 'Frozen', 'Other'];
const COURSES = ['entree', 'side', 'app', 'dessert'];

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['servings', 'servings_estimated', 'course', 'lines'],
  properties: {
    servings: { type: 'integer' },
    servings_estimated: { type: 'boolean' },
    course: { type: 'string', enum: COURSES },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'qty', 'unit', 'item', 'prep', 'category', 'unsure'],
        properties: {
          index: { type: 'integer' },
          qty: { anyOf: [{ type: 'number' }, { type: 'null' }] },
          unit: { type: 'string', enum: UNITS },
          item: { type: 'string' },
          prep: { type: 'string' },
          category: { type: 'string', enum: CATEGORIES },
          unsure: { type: 'boolean' }
        }
      }
    }
  }
};

const SYSTEM_PROMPT = `You turn recipe ingredient lines into structured data for a home grocery list app used by a couple in the United States.

For every numbered line, return one entry with the same index:
- qty: the amount as a number. Convert fractions and mixed numbers (1 1/2 or 1½ becomes 1.5). For a range such as "2 to 3", use the larger number so the shopper buys enough. Use null when there is no amount, such as "salt to taste".
- unit: one of the allowed units, or "" for a plain count ("3 eggs" is qty 3, unit ""). Map spelled out or abbreviated units to the allowed form (tablespoons and T become tbsp, teaspoons and t become tsp, pounds and lbs become lb, ounces become oz). Use "fl oz" only when the line clearly means liquid ounces.
- item: the plain grocery name a shopper looks for, lowercase and singular, without amounts or prep words ("yellow onion", "boneless skinless chicken breast", "black beans", "egg"). Keep words that change what you buy (low sodium, red, fresh, frozen). Use the same name for the same grocery across lines.
- prep: prep notes and package details, lowercase ("diced", "drained and rinsed", "15 oz"). For "1 (15 oz) can black beans, drained" return qty 1, unit "can", item "black beans", prep "15 oz, drained". Use "" when there is none.
- category: the grocery store section. Seafood goes in Meat. Eggs go in Dairy. Spices, oils, canned goods, rice, pasta and broth go in Pantry.
- unsure: true only when the shopping amount or the item could easily be wrong: an amount you had to guess, an odd or missing unit on something that must be bought by size, two different groceries in one line, or text that is hard to read. Seasonings "to taste" are not unsure.
If a line is a heading or not an ingredient (such as "For the sauce:"), return qty null, unit "", item "", prep "", category "Other", unsure false.

servings: if the input gives a known servings number, return it unchanged with servings_estimated false. Otherwise, if the recipe text states a yield, return it with servings_estimated false. Otherwise estimate how many adult dinner servings the amounts make (about 4 to 6 oz of meat per person is typical) and set servings_estimated true.
course: entree, side, app, or dessert. Most dinners are entree. If the input gives a known course, return it unchanged.`;

function readConfig() {
  const envUrl = process.env.SUPABASE_URL;
  const envKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (envUrl && envKey) return { url: envUrl, key: envKey };
  const text = fs.readFileSync(path.join(__dirname, '..', 'config.js'), 'utf8');
  const url = (text.match(/supabaseUrl:\s*'([^']+)'/) || [])[1];
  const key = (text.match(/supabasePublishableKey:\s*'([^']+)'/) || [])[1];
  if (!url || !key) throw new Error('Supabase URL or key not found in config.js');
  return { url, key };
}

// Confirms the caller is signed in to Mealz and belongs to a household.
async function verifyMember(authHeader) {
  const token = String(authHeader || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const { url, key } = readConfig();
  const headers = { apikey: key, Authorization: `Bearer ${token}`, Accept: 'application/json' };
  const userRes = await fetch(`${url}/auth/v1/user`, { headers });
  if (!userRes.ok) return null;
  const user = await userRes.json();
  if (!user?.id) return null;
  const memberRes = await fetch(`${url}/rest/v1/household_members?select=household_id&user_id=eq.${encodeURIComponent(user.id)}`, { headers });
  if (!memberRes.ok) return null;
  const rows = await memberRes.json();
  return Array.isArray(rows) && rows.length ? { userId: user.id, householdId: rows[0].household_id } : null;
}

function cleanInput(body) {
  const recipe = body?.recipe || {};
  const lines = (Array.isArray(recipe.lines) ? recipe.lines : [])
    .slice(0, MAX_LINES)
    .map(line => String(line ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_LINE_CHARS));
  const steps = (Array.isArray(recipe.steps) ? recipe.steps : [])
    .slice(0, MAX_STEPS)
    .map(step => String(step ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_STEP_CHARS))
    .filter(Boolean);
  const servings = Number.isInteger(recipe.servings) && recipe.servings > 0 ? recipe.servings : null;
  const course = COURSES.includes(recipe.course) ? recipe.course : null;
  return { name: String(recipe.name || '').trim().slice(0, 200), lines, steps, servings, course };
}

function buildPrompt(input) {
  return [
    `Recipe: ${input.name || 'Untitled'}`,
    `Known servings: ${input.servings ?? 'unknown'}`,
    `Known course: ${input.course ?? 'unknown'}`,
    '',
    'Ingredient lines:',
    ...input.lines.map((line, i) => `${i}. ${line}`),
    '',
    input.steps.length ? 'Directions (for context only):' : '',
    ...input.steps.map((step, i) => `${i + 1}. ${step}`)
  ].join('\n');
}

// Keeps only well formed values and makes sure every input line comes back once.
function normalizeResult(input, result) {
  const byIndex = new Map();
  for (const entry of Array.isArray(result?.lines) ? result.lines : []) {
    if (Number.isInteger(entry?.index) && entry.index >= 0 && entry.index < input.lines.length && !byIndex.has(entry.index)) {
      byIndex.set(entry.index, entry);
    }
  }
  const lines = input.lines.map((raw, position) => {
    const entry = byIndex.get(position);
    if (!entry) {
      return { position, raw, qty: null, unit: '', item: raw.toLowerCase(), prep: '', category: 'Other', unsure: true };
    }
    const qty = typeof entry.qty === 'number' && Number.isFinite(entry.qty) && entry.qty >= 0 ? Math.round(entry.qty * 1000) / 1000 : null;
    return {
      position,
      raw,
      qty,
      unit: UNITS.includes(entry.unit) ? entry.unit : '',
      item: String(entry.item || '').trim().toLowerCase().slice(0, 120),
      prep: String(entry.prep || '').trim().slice(0, 160),
      category: CATEGORIES.includes(entry.category) ? entry.category : 'Other',
      unsure: Boolean(entry.unsure)
    };
  });
  let servings = input.servings;
  let servingsEstimated = false;
  if (!servings) {
    const s = Number(result?.servings);
    servings = Number.isFinite(s) && s >= 1 ? Math.min(200, Math.round(s)) : 4;
    servingsEstimated = Boolean(result?.servings_estimated) || !(Number.isFinite(s) && s >= 1);
  }
  const course = input.course || (COURSES.includes(result?.course) ? result.course : 'entree');
  return { lines, servings, servings_estimated: servingsEstimated, course };
}

function supportsServerFallback(model) {
  return /^claude-(opus-5|fable-5-1|sonnet-5-5)/.test(model);
}

async function convertWithClaude(input) {
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  const client = new Anthropic({ timeout: 50_000, maxRetries: 1 });
  const params = {
    model,
    max_tokens: 16000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildPrompt(input) }]
  };
  // If a safety check declines the request, let the API retry on its
  // recommended fallback model instead of failing.
  const response = supportsServerFallback(model)
    ? await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
    : await client.messages.create(params);

  if (response.stop_reason === 'refusal') throw Object.assign(new Error('The conversion was declined.'), { status: 422 });
  if (response.stop_reason === 'max_tokens') throw Object.assign(new Error('The recipe was too long to convert.'), { status: 422 });
  const text = (response.content || []).filter(block => block.type === 'text').map(block => block.text).join('');
  let parsed;
  try { parsed = JSON.parse(text); }
  catch { throw Object.assign(new Error('The conversion came back unreadable.'), { status: 502 }); }
  return normalizeResult(input, parsed);
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'Ingredient conversion is not set up yet.', code: 'NO_KEY' });

  try {
    const member = await verifyMember(req.headers.authorization);
    if (!member) return res.status(401).json({ error: 'Sign in to Mealz first.' });

    let body = req.body || {};
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    const input = cleanInput(body);
    if (!input.lines.length) return res.status(200).json({ lines: [], servings: input.servings || 4, servings_estimated: !input.servings, course: input.course || 'entree' });

    const result = await convertWithClaude(input);
    return res.status(200).json(result);
  } catch (error) {
    const status = error instanceof Anthropic.RateLimitError ? 429
      : error instanceof Anthropic.APIError ? 502
      : (error?.status || 500);
    console.error('convert-ingredients failed', status, error?.message);
    return res.status(status).json({ error: error?.message || 'Conversion failed.' });
  }
}

module.exports = handler;
module.exports._internal = { SCHEMA, UNITS, CATEGORIES, cleanInput, buildPrompt, normalizeResult, supportsServerFallback };
