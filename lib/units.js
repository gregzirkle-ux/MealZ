// Mealz units: adds up ingredient amounts and formats them in each person's
// preferred style. Works in the browser (window.MealzUnits) and in Node.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MealzUnits = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Volume in teaspoons, weight in ounces.
  const VOLUME = { tsp: 1, tbsp: 3, 'fl oz': 6, cup: 48, pint: 96, quart: 192, gallon: 768, ml: 0.202884, l: 202.884 };
  const WEIGHT = { oz: 1, lb: 16, g: 0.035274, kg: 35.274 };

  const ALIASES = {
    t: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp', tsps: 'tsp',
    tablespoon: 'tbsp', tablespoons: 'tbsp', tbs: 'tbsp', tbl: 'tbsp', tbsps: 'tbsp',
    c: 'cup', cups: 'cup',
    'fluid ounce': 'fl oz', 'fluid ounces': 'fl oz', floz: 'fl oz',
    pints: 'pint', pt: 'pint', quarts: 'quart', qt: 'quart', gallons: 'gallon', gal: 'gallon',
    milliliter: 'ml', milliliters: 'ml', liter: 'l', liters: 'l', litre: 'l', litres: 'l',
    ounce: 'oz', ounces: 'oz', pound: 'lb', pounds: 'lb', lbs: 'lb',
    gram: 'g', grams: 'g', kilogram: 'kg', kilograms: 'kg',
    cloves: 'clove', cans: 'can', jars: 'jar', bottles: 'bottle', packages: 'package', pkg: 'package',
    bags: 'bag', boxes: 'box', containers: 'container', bunches: 'bunch', heads: 'head',
    stalks: 'stalk', sprigs: 'sprig', leaves: 'leaf', slices: 'slice', sticks: 'stick',
    pieces: 'piece', pinches: 'pinch', dashes: 'dash'
  };

  const NO_PLURAL = new Set(['tsp', 'tbsp', 'fl oz', 'oz', 'lb', 'g', 'kg', 'ml', 'l']);

  const DEFAULT_PREFS = { numbers: 'fractions', weights: 'lb_oz' };

  function normalizeUnit(unit) {
    const u = String(unit || '').trim().toLowerCase().replace(/\.$/, '');
    return ALIASES[u] || u;
  }

  function dimensionOf(unit) {
    const u = normalizeUnit(unit);
    if (u in VOLUME) return 'volume';
    if (u in WEIGHT) return 'weight';
    return 'count';
  }

  function cleanPrefs(prefs) {
    const p = prefs || {};
    return {
      numbers: p.numbers === 'decimals' ? 'decimals' : 'fractions',
      weights: ['oz', 'lb_oz', 'lb'].includes(p.weights) ? p.weights : DEFAULT_PREFS.weights
    };
  }

  // A measure is plain JSON so it can be saved on a grocery item.
  // v: teaspoons, vu: volume units seen, w: ounces, c: counts by unit, x: some lines had no amount.
  function emptyMeasure() {
    return { v: 0, vu: [], w: 0, c: {}, x: false };
  }

  function addToMeasure(measure, qty, unit) {
    const m = measure || emptyMeasure();
    if (qty == null || !Number.isFinite(Number(qty))) { m.x = true; return m; }
    const n = Number(qty);
    const u = normalizeUnit(unit);
    const dim = dimensionOf(u);
    if (dim === 'volume') {
      m.v += n * VOLUME[u];
      if (!m.vu.includes(u)) m.vu.push(u);
    } else if (dim === 'weight') {
      m.w += n * WEIGHT[u];
    } else {
      m.c[u] = (m.c[u] || 0) + n;
    }
    return m;
  }

  function isEmptyMeasure(m) {
    return !m || (!m.v && !m.w && !Object.values(m.c || {}).some(Boolean));
  }

  const FRACTIONS = [
    [1 / 8, '1/8'], [1 / 4, '1/4'], [1 / 3, '1/3'], [3 / 8, '3/8'], [1 / 2, '1/2'],
    [5 / 8, '5/8'], [2 / 3, '2/3'], [3 / 4, '3/4'], [7 / 8, '7/8']
  ];

  function formatNumber(value, numbers) {
    const n = Number(value) || 0;
    if (numbers === 'decimals') {
      const rounded = n >= 10 ? Math.round(n * 10) / 10 : Math.round(n * 100) / 100;
      return String(rounded || (n > 0 ? 0.01 : 0));
    }
    let whole = Math.floor(n);
    const rest = n - whole;
    let frac = '';
    if (rest >= 1 / 16) {
      let best = FRACTIONS[0];
      for (const f of FRACTIONS) if (Math.abs(f[0] - rest) < Math.abs(best[0] - rest)) best = f;
      if (1 - rest < Math.abs(best[0] - rest)) { whole += 1; } else { frac = best[1]; }
    }
    if (!whole && !frac) return n > 0 ? '1/8' : '0';
    if (!whole) return frac;
    return frac ? `${whole} ${frac}` : String(whole);
  }

  // Plural only when the amount as shown is more than one ("1 cup", "1/2 cup", "1 1/2 cups").
  function shownAsOneOrLess(text) {
    const t = String(text).trim();
    if (/^\d+\/\d+$/.test(t)) return true;
    const n = Number(t);
    return Number.isFinite(n) && n <= 1;
  }

  function unitLabel(unit, qtyText) {
    const u = normalizeUnit(unit);
    if (!u) return '';
    if (NO_PLURAL.has(u) || shownAsOneOrLess(qtyText)) return u;
    if (u === 'leaf') return 'leaves';
    if (/(ch|sh|s|x)$/.test(u)) return `${u}es`;
    return `${u}s`;
  }

  function formatWeight(oz, prefs) {
    const p = cleanPrefs(prefs);
    if (p.weights === 'oz') return `${formatNumber(oz, p.numbers)} oz`;
    if (p.weights === 'lb') return `${formatNumber(oz / 16, p.numbers)} lb`;
    if (oz < 16) return `${formatNumber(oz, p.numbers)} oz`;
    let lb = Math.floor(oz / 16);
    let rest = oz - lb * 16;
    const restText = formatNumber(rest, p.numbers);
    if (restText === '16') { lb += 1; rest = 0; }
    return rest >= 1 / 16 && restText !== '0' && restText !== '16' ? `${lb} lb ${restText} oz` : `${lb} lb`;
  }

  function bestVolumeUnit(tsp) {
    if (tsp >= 12) return 'cup';
    if (tsp >= 3) return 'tbsp';
    return 'tsp';
  }

  function formatVolume(tsp, unitsSeen, prefs) {
    const p = cleanPrefs(prefs);
    const seen = (unitsSeen || []).filter(u => u in VOLUME);
    const metric = seen.some(u => u === 'ml' || u === 'l');
    const unit = seen.length === 1 && !metric ? seen[0] : bestVolumeUnit(tsp);
    const text = formatNumber(tsp / VOLUME[unit], p.numbers);
    return `${text} ${unitLabel(unit, text)}`;
  }

  function formatMeasure(measure, prefs) {
    if (!measure) return '';
    const p = cleanPrefs(prefs);
    const parts = [];
    if (measure.w > 0) parts.push(formatWeight(measure.w, p));
    if (measure.v > 0) parts.push(formatVolume(measure.v, measure.vu, p));
    for (const [unit, qty] of Object.entries(measure.c || {})) {
      if (!(qty > 0)) continue;
      const text = formatNumber(qty, p.numbers);
      const label = unitLabel(unit, text);
      parts.push(label ? `${text} ${label}` : text);
    }
    return parts.join(' + ');
  }

  // One recipe line, as written (no scaling): "1 1/2 cups", "1 lb 8 oz", "3".
  function formatLineAmount(qty, unit, prefs) {
    if (qty == null || qty === '') return '';
    return formatMeasure(addToMeasure(emptyMeasure(), qty, unit), prefs);
  }

  return {
    VOLUME, WEIGHT, DEFAULT_PREFS,
    normalizeUnit, dimensionOf, cleanPrefs,
    emptyMeasure, addToMeasure, isEmptyMeasure,
    formatNumber, formatMeasure, formatLineAmount, unitLabel
  };
});
