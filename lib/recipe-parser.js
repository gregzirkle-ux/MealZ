'use strict';

const CATEGORY_RULES = [
  ['Produce', /\b(avocado|apple|apricot|artichoke|arugula|asparagus|banana|basil|bean sprouts?|beet|bell pepper|berries|berry|blackberries|blueberries|bok choy|broccoli|brussels sprouts?|cabbage|carrot|cauliflower|celery|chard|cherries|cherry|cilantro|coriander leaves?|corn on the cob|cucumber|dill|eggplant|fennel|garlic|ginger|grape|grapefruit|green onion|scallion|jalape[nñ]o|kale|kiwi|leek|lemon|lettuce|lime|mango|mint|mushroom|nectarine|onion|orange|oregano leaves?|parsley|peach|pear|pepper(s)?|pineapple|plum|potato|radish|raspberries|rosemary|sage|spinach|strawberries|strawberry|sweet potato|thyme|tomato|turnip|watermelon|zucchini)\b/i],
  ['Meat', /\b(chicken|turkey|beef|steak|sirloin|ground beef|ground turkey|ground chicken|pork|ham|bacon|sausage|lamb|veal|salmon|tuna|cod|tilapia|shrimp|prawn|fish|scallop)\b/i],
  ['Dairy', /\b(milk|cream|half[- ]and[- ]half|butter|cheese|cheddar|mozzarella|feta|parmesan|yogurt|yoghurt|sour cream|ricotta|cream cheese|eggs?|egg whites?)\b/i],
  ['Bakery', /\b(bread|bun|rolls?|pita|naan|tortillas?|baguette|flatbread)\b/i],
  ['Frozen', /\b(frozen|ice cream)\b/i]
];

const UNIT_RE = '(?:cups?|c\\.?|tablespoons?|tbsp\\.?|teaspoons?|tsp\\.?|ounces?|oz\\.?|pounds?|lbs?\\.?|grams?|g\\.?|kilograms?|kg\\.?|milliliters?|ml\\.?|liters?|l\\.?|cloves?|cans?|packages?|pkgs?\\.?|bunch(?:es)?|pinch(?:es)?|slices?|stalks?|heads?|sprigs?|sticks?)';
const QTY_RE = '(?:\\d+(?:\\.\\d+)?|\\d+\\/\\d+|\\d+\\s+\\d+\\/\\d+|[¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])';
const AMOUNT_RE = new RegExp(`^\\s*(${QTY_RE}(?:\\s*[-–]\\s*${QTY_RE})?(?:\\s+${UNIT_RE})?)\\s+(.+)$`, 'i');

function decodeEntities(text = '') {
  const entities = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…'
  };
  return String(text)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => entities[name.toLowerCase()] ?? match);
}

function cleanText(value = '') {
  return decodeEntities(String(value))
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function durationMinutes(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value));
  const text = String(value || '').trim();
  if (!text) return 0;
  const iso = text.match(/^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
  if (iso) {
    return Math.round((Number(iso[1] || 0) * 1440) + (Number(iso[2] || 0) * 60) + Number(iso[3] || 0) + (Number(iso[4] || 0) / 60));
  }
  const hour = text.match(/(\d+(?:\.\d+)?)\s*h(?:our)?s?/i);
  const minute = text.match(/(\d+(?:\.\d+)?)\s*m(?:in(?:ute)?)?s?/i);
  if (hour || minute) return Math.round(Number(hour?.[1] || 0) * 60 + Number(minute?.[1] || 0));
  const numeric = Number(text);
  return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : 0;
}

function valueToText(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return cleanText(value);
  if (Array.isArray(value)) return value.map(valueToText).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    const unit = value.unitText || value.unitCode || '';
    if (value.value != null && value.name) return cleanText(`${value.value} ${unit} ${value.name}`);
    return cleanText(value.text || value.name || value.value || '');
  }
  return '';
}

function flattenIngredients(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.flatMap(flattenIngredients);
  if (typeof value === 'object') {
    if (Array.isArray(value.itemListElement)) return flattenIngredients(value.itemListElement);
    const text = valueToText(value);
    return text ? [text] : [];
  }
  const text = cleanText(value);
  return text ? [text] : [];
}

function flattenInstructions(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.flatMap(flattenInstructions);
  if (typeof value === 'object') {
    const type = Array.isArray(value['@type']) ? value['@type'].join(' ') : String(value['@type'] || '');
    if (/HowToSection/i.test(type) && value.itemListElement) return flattenInstructions(value.itemListElement);
    if (value.itemListElement) return flattenInstructions(value.itemListElement);
    const text = cleanText(value.text || value.name || '');
    return text ? [text] : [];
  }
  const text = cleanText(value);
  if (!text) return [];
  const split = text.split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9])/).map(cleanText).filter(s => s.length > 4);
  return split.length > 1 ? split : [text];
}

function categorizeIngredient(name = '') {
  const text = String(name);
  for (const [category, rule] of CATEGORY_RULES) if (rule.test(text)) return category;
  return 'Pantry';
}

function splitIngredient(line) {
  const text = cleanText(line).replace(/^[•·*-]\s*/, '');
  if (!text) return null;
  const match = text.match(AMOUNT_RE);
  if (!match) return { amount: '', name: text, category: categorizeIngredient(text) };
  const amount = cleanText(match[1]);
  const name = cleanText(match[2]).replace(/^of\s+/i, '');
  return { amount, name, category: categorizeIngredient(name) };
}

function collectRecipeNodes(value, found = [], seen = new Set()) {
  if (value == null || typeof value !== 'object' || seen.has(value)) return found;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach(item => collectRecipeNodes(item, found, seen));
    return found;
  }
  const type = value['@type'];
  const types = Array.isArray(type) ? type : [type];
  if (types.some(t => String(t).toLowerCase() === 'recipe')) found.push(value);
  Object.values(value).forEach(child => collectRecipeNodes(child, found, seen));
  return found;
}

function extractJsonLd(html) {
  const nodes = [];
  const re = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html))) {
    let raw = match[1].trim().replace(/^<!--/, '').replace(/-->$/, '').trim();
    if (!raw) continue;
    try {
      const data = JSON.parse(raw);
      collectRecipeNodes(data, nodes);
    } catch {
      // Some publishers emit multiple JSON values. Try a small recovery for trailing semicolons.
      try {
        raw = raw.replace(/;\s*$/, '');
        const data = JSON.parse(raw);
        collectRecipeNodes(data, nodes);
      } catch { /* ignore invalid structured data block */ }
    }
  }
  return nodes;
}

function metaContent(html, property) {
  const patterns = [
    new RegExp(`<meta\\b[^>]*(?:property|name)=["']${property.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}["'][^>]*content=["']([^"']+)["'][^>]*>`, 'i'),
    new RegExp(`<meta\\b[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']${property.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}["'][^>]*>`, 'i')
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return cleanText(match[1]);
  }
  return '';
}

function microdataFallback(html) {
  const ingredients = [];
  const ingredientRe = /<([a-z0-9]+)\b[^>]*itemprop=["']recipeIngredient["'][^>]*>([\s\S]*?)<\/\1>/gi;
  let match;
  while ((match = ingredientRe.exec(html))) {
    const text = cleanText(match[2]);
    if (text) ingredients.push(text);
  }
  const steps = [];
  const instructionRe = /<([a-z0-9]+)\b[^>]*itemprop=["']recipeInstructions["'][^>]*>([\s\S]*?)<\/\1>/gi;
  while ((match = instructionRe.exec(html))) {
    const text = cleanText(match[2]);
    if (text) steps.push(text);
  }
  if (!ingredients.length || !steps.length) return null;
  return {
    name: metaContent(html, 'og:title') || cleanText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || 'Imported Recipe'),
    recipeIngredient: ingredients,
    recipeInstructions: steps,
    recipeCuisine: ''
  };
}

function chooseBestRecipe(nodes) {
  return [...nodes].sort((a, b) => {
    const score = node => flattenIngredients(node.recipeIngredient || node.ingredients).length * 3
      + flattenInstructions(node.recipeInstructions).length * 4
      + (node.name ? 2 : 0)
      + (node.image ? 1 : 0);
    return score(b) - score(a);
  })[0] || null;
}

function normalizeRecipe(node, sourceUrl) {
  const ingredients = flattenIngredients(node.recipeIngredient || node.ingredients).map(splitIngredient).filter(Boolean);
  const steps = flattenInstructions(node.recipeInstructions);
  const prep = durationMinutes(node.prepTime);
  const cook = durationMinutes(node.cookTime || node.totalTime);
  const total = durationMinutes(node.totalTime);
  const cookMinutes = cook || Math.max(0, total - prep);
  const cuisine = valueToText(node.recipeCuisine);
  const name = valueToText(node.name) || 'Imported Recipe';
  return {
    name,
    cuisine,
    prep_minutes: prep,
    cook_minutes: cookMinutes,
    difficulty: prep + cookMinutes <= 35 ? 'Very Easy' : 'Easy',
    ingredients,
    steps,
    source_url: sourceUrl,
    source_name: valueToText(node.publisher?.name || node.author?.name || node.author),
    yield: valueToText(node.recipeYield),
    description: valueToText(node.description)
  };
}

function parseRecipeHtml(html, sourceUrl) {
  const nodes = extractJsonLd(html);
  const node = chooseBestRecipe(nodes) || microdataFallback(html);
  if (!node) {
    const error = new Error('This page did not expose a clean structured recipe that Mealz could read.');
    error.code = 'NO_RECIPE';
    throw error;
  }
  const recipe = normalizeRecipe(node, sourceUrl);
  if (!recipe.ingredients.length || !recipe.steps.length) {
    const error = new Error('Mealz found the recipe page, but it was missing usable ingredients or directions.');
    error.code = 'INCOMPLETE_RECIPE';
    throw error;
  }
  return recipe;
}

module.exports = {
  parseRecipeHtml,
  durationMinutes,
  splitIngredient,
  categorizeIngredient,
  flattenInstructions
};
