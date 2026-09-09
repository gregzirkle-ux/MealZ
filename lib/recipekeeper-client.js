(() => {
  'use strict';

  const CATEGORY_RULES = [
    ['Produce', /\b(avocado|apple|artichoke|arugula|asparagus|banana|basil|beet|bell pepper|berries|berry|broccoli|brussels sprouts?|cabbage|carrot|cauliflower|celery|chard|cherries|cherry|cilantro|coriander|corn|cucumber|dill|eggplant|fennel|garlic|ginger|grape|grapefruit|green onion|scallion|jalape[nñ]o|kale|kiwi|leek|lemon|lettuce|lime|mango|mint|mushroom|nectarine|onion|orange|parsley|peach|pear|pepper|pineapple|plum|potato|radish|raspberries|rosemary|sage|spinach|strawberries|sweet potato|thyme|tomato|turnip|watermelon|zucchini)\b/i],
    ['Meat', /\b(chicken|turkey|beef|steak|sirloin|ground beef|ground turkey|ground chicken|pork|ham|bacon|sausage|lamb|veal|salmon|tuna|cod|tilapia|shrimp|prawn|fish|scallop|crab|lobster)\b/i],
    ['Dairy', /\b(milk|cream|butter|cheese|cheddar|mozzarella|feta|parmesan|yogurt|yoghurt|sour cream|ricotta|cream cheese|eggs?|egg whites?)\b/i],
    ['Bakery', /\b(bread|bun|rolls?|pita|naan|tortillas?|baguette|flatbread)\b/i],
    ['Frozen', /\b(frozen|ice cream)\b/i]
  ];

  const DISH_PATTERNS = [
    ['Chicken', /\b(chicken|hen)\b/i],
    ['Turkey', /\bturkey\b/i],
    ['Beef', /\b(beef|steak|sirloin|ribeye|brisket|chuck|ground beef)\b/i],
    ['Pork', /\b(pork|ham|bacon|prosciutto|pancetta|sausage)\b/i],
    ['Seafood', /\b(salmon|tuna|cod|tilapia|shrimp|prawn|fish|scallop|crab|lobster|mahi|halibut|trout)\b/i],
    ['Lamb', /\blamb\b/i],
    ['Vegetarian', /\b(vegetarian|vegan|meatless|tofu|tempeh)\b/i]
  ];

  const QTY_RE = /^(\s*(?:\d+(?:\.\d+)?|\d+\/\d+|\d+\s+\d+\/\d+|[¼½¾⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])(?:\s*[-–]\s*(?:\d+(?:\.\d+)?|\d+\/\d+|[¼½¾⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]))?(?:\s+(?:cups?|c\.?|tablespoons?|tbsp\.?|teaspoons?|tsp\.?|ounces?|oz\.?|pounds?|lbs?\.?|grams?|g\.?|kilograms?|kg\.?|milliliters?|ml\.?|liters?|l\.?|cloves?|cans?|packages?|pkgs?\.?|bunch(?:es)?|pinch(?:es)?|slices?|stalks?|heads?|sprigs?|sticks?))?)\s+(.+)$/i;

  function clean(value = '') {
    return String(value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function itemValue(root, prop) {
    const el = root.querySelector(`[itemprop="${prop}"]`);
    if (!el) return '';
    return clean(el.getAttribute('content') || el.getAttribute('href') || el.textContent || '');
  }

  function itemValues(root, prop) {
    return [...root.querySelectorAll(`[itemprop="${prop}"]`)]
      .map(el => clean(el.getAttribute('content') || el.textContent || ''))
      .filter(Boolean);
  }

  function durationMinutes(value) {
    const text = clean(value);
    if (!text) return 0;
    const iso = text.match(/^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
    if (iso) return Math.max(0, Math.round(Number(iso[1] || 0) * 1440 + Number(iso[2] || 0) * 60 + Number(iso[3] || 0) + Number(iso[4] || 0) / 60));
    const hours = text.match(/(\d+(?:\.\d+)?)\s*h(?:our)?s?/i);
    const mins = text.match(/(\d+(?:\.\d+)?)\s*m(?:in(?:ute)?)?s?/i);
    return Math.max(0, Math.round(Number(hours?.[1] || 0) * 60 + Number(mins?.[1] || 0)));
  }

  function categoryFor(name = '') {
    for (const [category, pattern] of CATEGORY_RULES) if (pattern.test(name)) return category;
    return 'Pantry';
  }

  function splitIngredient(line) {
    const text = clean(line).replace(/^[•·*\-]\s*/, '');
    if (!text) return null;
    const match = text.match(QTY_RE);
    if (!match) return { amount: '', name: text, category: categoryFor(text) };
    return { amount: clean(match[1]), name: clean(match[2]).replace(/^of\s+/i, ''), category: categoryFor(match[2]) };
  }

  function inferDishType(recipe = {}) {
    const categories = recipe.categories || [];
    const courses = recipe.courses || [];
    const ingredients = (recipe.ingredients || []).map(i => i.name || '').join(' ');
    const haystack = [recipe.name || '', ...categories, ...courses, ingredients].join(' ');
    for (const [type, pattern] of DISH_PATTERNS) if (pattern.test(haystack)) return type;
    return 'Other';
  }

  function boolValue(value) {
    return /^(true|1|yes)$/i.test(clean(value));
  }

  function parseSource(block) {
    const source = block.querySelector('[itemprop="recipeSource"]');
    if (!source) return '';
    const link = source.matches('a[href]') ? source : source.querySelector('a[href]');
    const candidate = clean(link?.getAttribute('href') || source.getAttribute('href') || source.textContent || '');
    try {
      const parsed = new URL(candidate);
      return /^https?:$/.test(parsed.protocol) ? parsed.href : '';
    } catch { return ''; }
  }

  function parseRecipeBlock(block) {
    const name = itemValue(block, 'name') || clean(block.querySelector('h2')?.textContent || 'Imported Recipe');
    const ingredientRoot = block.querySelector('[itemprop="recipeIngredients"]');
    let ingredientLines = ingredientRoot ? [...ingredientRoot.querySelectorAll('p')].map(p => clean(p.textContent)).filter(Boolean) : [];
    if (!ingredientLines.length) ingredientLines = itemValues(block, 'recipeIngredient');
    const ingredients = ingredientLines.map(splitIngredient).filter(Boolean);

    const directionRoot = block.querySelector('[itemprop="recipeDirections"]');
    let steps = directionRoot ? [...directionRoot.querySelectorAll('p')].map(p => clean(p.textContent)).filter(Boolean) : [];
    if (!steps.length) steps = itemValues(block, 'recipeInstructions');

    const notesRoot = block.querySelector('[itemprop="recipeNotes"]');
    const notes = notesRoot ? [...notesRoot.querySelectorAll('p')].map(p => clean(p.textContent)).filter(Boolean) : [];
    if (notes.length) steps.push(...notes.map(note => `Recipe note: ${note}`));

    const categories = itemValues(block, 'recipeCategory');
    const courses = itemValues(block, 'recipeCourse');
    const yieldText = itemValue(block, 'recipeYield');
    const cuisine = itemValue(block, 'recipeCuisine');
    const prep = durationMinutes(itemValue(block, 'prepTime'));
    const cook = durationMinutes(itemValue(block, 'cookTime'));
    const favourite = boolValue(itemValue(block, 'recipeIsFavourite'));
    const numericRating = Number(itemValue(block, 'recipeRating') || 0);
    const rating = numericRating >= 4 ? 'makeagain' : numericRating === 3 ? 'fine' : '';
    const sourceUrl = parseSource(block);

    const draft = { name, ingredients, categories, courses };
    const dishType = inferDishType(draft);
    const tags = [...new Set([
      `dish:${dishType}`,
      ...courses,
      ...categories,
      yieldText ? `Serves: ${yieldText}` : '',
      'Recipe Keeper'
    ].map(clean).filter(Boolean))];

    return {
      name,
      cuisine,
      prep_minutes: prep,
      cook_minutes: cook,
      difficulty: prep + cook <= 35 ? 'Very Easy' : 'Easy',
      favorite: favourite,
      rating,
      is_new: false,
      tags,
      ingredients,
      steps,
      source_url: sourceUrl,
      dish_type: dishType
    };
  }

  function parseHtml(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    let blocks = [...doc.querySelectorAll('div.recipe-details')];
    if (!blocks.length) blocks = [...doc.querySelectorAll('[itemscope][itemtype*="Recipe"]')];
    return blocks.map(parseRecipeBlock).filter(r => r.name && r.ingredients.length && r.steps.length);
  }

  async function readExport(file) {
    if (!file) throw new Error('Choose a Recipe Keeper export file first.');
    const lower = String(file.name || '').toLowerCase();
    let html = '';
    if (lower.endsWith('.html') || lower.endsWith('.htm') || file.type === 'text/html') {
      html = await file.text();
    } else if (lower.endsWith('.zip') || /zip/i.test(file.type || '')) {
      if (!window.JSZip) throw new Error('The ZIP reader did not load. Refresh Mealz and try again.');
      const zip = await window.JSZip.loadAsync(file);
      const entry = Object.values(zip.files).find(item => !item.dir && /(^|\/)recipes\.html$/i.test(item.name));
      if (!entry) throw new Error('Mealz could not find recipes.html inside that Recipe Keeper export.');
      html = await entry.async('string');
    } else {
      throw new Error('Choose the .zip or recipes.html file exported by Recipe Keeper.');
    }
    const recipes = parseHtml(html);
    if (!recipes.length) throw new Error('Mealz opened the file but did not find usable Recipe Keeper recipes.');
    return recipes;
  }

  window.MealzRecipeKeeper = { readExport, parseHtml, inferDishType, splitIngredient, durationMinutes };
})();
