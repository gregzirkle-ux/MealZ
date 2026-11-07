(() => {
  'use strict';

  const root = document.getElementById('app');
  const config = window.MEALZ_CONFIG || window.WEEKNIGHT_CONFIG || {};
  const sharedMode = Boolean(config.supabaseUrl && config.supabasePublishableKey && window.supabase);
  const sb = sharedMode
    ? window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storageKey: 'mealz-shared-household-auth'
        }
      })
    : null;

  const state = {
    view: 'week',
    weekStart: startOfWeek(new Date()),
    recipes: [],
    meals: [],
    groceries: [],
    user: null,
    member: null,
    members: [],
    modal: null,
    recipeSearch: '',
    planSearch: '',
    modalStack: [],
    filters: {
      recipes: { types: [], time: 'any', favoritesOnly: false },
      plan: { types: [], time: 'any', favoritesOnly: false }
    },
    hideChecked: false,
    ingredientLines: [],
    prefs: { numbers: 'fractions', weights: 'lb_oz' },
    cook: null,
    authMessage: '',
    authError: '',
    authStep: 'password',
    authEmail: '',
    authBusy: false,
    loading: true
  };

  let store;
  let realtimeChannel = null;
  let reloadTimer = null;

  function uid() {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
    return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function cleanRecipePayload(recipe = {}) {
    return {
      name: String(recipe.name || '').trim(),
      cuisine: String(recipe.cuisine || '').trim(),
      prep_minutes: Number(recipe.prep_minutes || 0),
      cook_minutes: Number(recipe.cook_minutes || 0),
      difficulty: String(recipe.difficulty || 'Easy'),
      favorite: Boolean(recipe.favorite),
      rating: String(recipe.rating || ''),
      is_new: Boolean(recipe.is_new),
      tags: Array.isArray(recipe.tags) ? recipe.tags.filter(Boolean).map(String) : [],
      ingredients: Array.isArray(recipe.ingredients) ? recipe.ingredients : [],
      steps: Array.isArray(recipe.steps) ? recipe.steps : [],
      source_url: String(recipe.source_url || '').trim(),
      servings: cleanServings(recipe.servings),
      servings_estimated: Boolean(recipe.servings_estimated) && Boolean(cleanServings(recipe.servings)),
      course: COURSES.some(([value]) => value === recipe.course) ? recipe.course : null
    };
  }

  const COURSES = [['entree', 'Entree'], ['side', 'Side'], ['app', 'App'], ['dessert', 'Dessert']];

  function cleanServings(value) {
    const n = Math.round(Number(value));
    return Number.isFinite(n) && n >= 1 ? Math.min(200, n) : null;
  }

  // Reads the first number from a yield like "Serves: 6-8" or "4 servings".
  function servingsFromText(text) {
    const match = String(text || '').match(/(\d+)/);
    return match ? cleanServings(match[1]) : null;
  }

  function servingsFromTags(tags) {
    const tag = (tags || []).find(t => /^Serves:\s*\d/i.test(String(t)));
    return tag ? servingsFromText(tag) : null;
  }

  function pushModal(next) {
    if (state.modal) state.modalStack.push(state.modal);
    state.modal = next;
  }

  function popModal() {
    state.modal = state.modalStack.pop() || null;
  }

  function resetModals(next = null) {
    state.modalStack = [];
    state.modal = next;
  }

  function filterFor(context) {
    return state.filters[context] || state.filters.recipes;
  }

  function filterCount(context) {
    const f = filterFor(context);
    return f.types.length + (f.time !== 'any' ? 1 : 0);
  }

  const TIME_OPTIONS = [
    ['any', 'Any length'],
    ['20', 'Under 20 minutes'],
    ['30', 'Under 30 minutes'],
    ['45', 'Under 45 minutes'],
    ['46', '45 minutes or more']
  ];

  function passesFilter(recipe, context) {
    const f = filterFor(context);
    if (f.types.length && !f.types.includes(dishTypeOf(recipe))) return false;
    if (f.favoritesOnly && !recipe.favorite) return false;
    if (f.time !== 'any') {
      const total = Number(recipe.prep_minutes || 0) + Number(recipe.cook_minutes || 0);
      if (f.time === '46') { if (total < 45) return false; }
      else if (total >= Number(f.time)) return false;
    }
    return true;
  }

  function cleanMealPayload(meal = {}) {
    return {
      meal_date: meal.meal_date,
      type: meal.type,
      recipe_id: meal.recipe_id || null,
      label: String(meal.label || ''),
      notes: String(meal.notes || ''),
      servings: meal.type === 'meal' ? cleanServings(meal.servings) : null,
      leftover_days: meal.type === 'meal' ? Math.max(0, Math.min(3, Number(meal.leftover_days) || 0)) : 0,
      source_meal_id: meal.type === 'leftover' ? (meal.source_meal_id || null) : null
    };
  }

  function escapeHtml(value = '') {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function parseLocalDate(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d, 12, 0, 0, 0);
  }

  function dateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function addDays(date, days) {
    const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
    copy.setDate(copy.getDate() + days);
    return copy;
  }

  function startOfWeek(date) {
    const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
    const day = copy.getDay();
    const offset = day === 0 ? -6 : 1 - day;
    copy.setDate(copy.getDate() + offset);
    return copy;
  }

  function sameDay(a, b) {
    return dateKey(a) === dateKey(b);
  }

  function formatWeekRange(start) {
    const end = addDays(start, 6);
    const sameMonth = start.getMonth() === end.getMonth();
    const monthA = start.toLocaleDateString(undefined, { month: 'short' });
    const monthB = end.toLocaleDateString(undefined, { month: 'short' });
    return sameMonth
      ? `${monthA} ${start.getDate()}–${end.getDate()}, ${end.getFullYear()}`
      : `${monthA} ${start.getDate()} – ${monthB} ${end.getDate()}, ${end.getFullYear()}`;
  }

  function weekKey() {
    return dateKey(state.weekStart);
  }

  function sampleRecipes() {
    return [
      {
        name: 'Chicken Fajita Bowls', cuisine: 'Mexican', prep_minutes: 12, cook_minutes: 20,
        difficulty: 'Easy', favorite: true, rating: 'makeagain', is_new: false,
        tags: ['lean protein', 'fresh vegetables', 'good leftovers', 'bowl'], source_url: '',
        ingredients: [
          { amount: '2 lb', name: 'chicken breast', category: 'Meat' },
          { amount: '3', name: 'bell peppers', category: 'Produce' },
          { amount: '1', name: 'red onion', category: 'Produce' },
          { amount: '2', name: 'limes', category: 'Produce' },
          { amount: '2', name: 'avocados', category: 'Produce' },
          { amount: '2 cups', name: 'rice', category: 'Pantry' },
          { amount: '1 packet', name: 'fajita seasoning', category: 'Pantry' }
        ],
        steps: [
          'Start the rice.',
          'Slice the chicken, peppers, and onion.',
          'Season the chicken and cook it in a large skillet until browned and cooked through.',
          'Add the peppers and onion and cook until crisp-tender.',
          'Build bowls with rice, chicken and vegetables, avocado, and lime.'
        ]
      },
      {
        name: 'Greek Chicken Pitas', cuisine: 'Greek', prep_minutes: 15, cook_minutes: 15,
        difficulty: 'Easy', favorite: true, rating: 'makeagain', is_new: false,
        tags: ['lean protein', 'fresh vegetables', 'quick'], source_url: '',
        ingredients: [
          { amount: '2 lb', name: 'chicken breast', category: 'Meat' },
          { amount: '1', name: 'cucumber', category: 'Produce' },
          { amount: '1 pint', name: 'cherry tomatoes', category: 'Produce' },
          { amount: '1', name: 'lemon', category: 'Produce' },
          { amount: '8', name: 'pitas', category: 'Bakery' },
          { amount: '1 cup', name: 'Greek yogurt', category: 'Dairy' },
          { amount: '4 oz', name: 'feta', category: 'Dairy' }
        ],
        steps: [
          'Season the chicken with olive oil, lemon, oregano, salt, and pepper.',
          'Cook the chicken in a skillet or on the grill until cooked through.',
          'Chop cucumber and tomatoes while the chicken cooks.',
          'Mix Greek yogurt with lemon, salt, and a little garlic for a quick sauce.',
          'Fill warm pitas with chicken, vegetables, sauce, and feta.'
        ]
      },
      {
        name: 'Peruvian Green Chicken Bowls', cuisine: 'Peruvian', prep_minutes: 18, cook_minutes: 22,
        difficulty: 'Easy', favorite: true, rating: 'makeagain', is_new: false,
        tags: ['lean protein', 'fresh vegetables', 'good leftovers', 'bowl'], source_url: '',
        ingredients: [
          { amount: '2 lb', name: 'chicken thighs', category: 'Meat' },
          { amount: '1 bunch', name: 'cilantro', category: 'Produce' },
          { amount: '2', name: 'limes', category: 'Produce' },
          { amount: '1', name: 'jalapeño', category: 'Produce' },
          { amount: '1', name: 'avocado', category: 'Produce' },
          { amount: '2 cups', name: 'rice', category: 'Pantry' },
          { amount: '1/2 cup', name: 'Greek yogurt', category: 'Dairy' }
        ],
        steps: [
          'Start the rice.',
          'Season the chicken with cumin, garlic, salt, pepper, and lime.',
          'Cook chicken until browned and cooked through, then slice.',
          'Blend cilantro, jalapeño, lime, and Greek yogurt into a quick green sauce.',
          'Build bowls with rice, chicken, avocado, and green sauce.'
        ]
      },
      {
        name: 'Turkey Taco Skillet', cuisine: 'Mexican', prep_minutes: 10, cook_minutes: 18,
        difficulty: 'Very Easy', favorite: false, rating: '', is_new: true,
        tags: ['lean protein', 'one pan', 'quick', 'good leftovers'], source_url: '',
        ingredients: [
          { amount: '2 lb', name: 'lean ground turkey', category: 'Meat' },
          { amount: '1', name: 'bell pepper', category: 'Produce' },
          { amount: '1', name: 'onion', category: 'Produce' },
          { amount: '1 can', name: 'black beans', category: 'Pantry' },
          { amount: '1 cup', name: 'frozen corn', category: 'Frozen' },
          { amount: '1 packet', name: 'taco seasoning', category: 'Pantry' },
          { amount: '1 jar', name: 'salsa', category: 'Pantry' }
        ],
        steps: [
          'Dice the pepper and onion.',
          'Brown the turkey in a large skillet.',
          'Add pepper, onion, and taco seasoning and cook until vegetables soften.',
          'Stir in black beans, corn, and salsa and heat through.',
          'Serve as bowls, in tortillas, or over greens.'
        ]
      },
      {
        name: 'Chicken Shawarma Bowls', cuisine: 'Mediterranean', prep_minutes: 15, cook_minutes: 20,
        difficulty: 'Easy', favorite: false, rating: '', is_new: true,
        tags: ['lean protein', 'fresh vegetables', 'bowl', 'good leftovers'], source_url: '',
        ingredients: [
          { amount: '2 lb', name: 'chicken breast', category: 'Meat' },
          { amount: '1', name: 'cucumber', category: 'Produce' },
          { amount: '1 pint', name: 'cherry tomatoes', category: 'Produce' },
          { amount: '1', name: 'red onion', category: 'Produce' },
          { amount: '2', name: 'lemons', category: 'Produce' },
          { amount: '2 cups', name: 'rice', category: 'Pantry' },
          { amount: '1 cup', name: 'Greek yogurt', category: 'Dairy' }
        ],
        steps: [
          'Start the rice.',
          'Season chicken with cumin, paprika, garlic, lemon, salt, and pepper.',
          'Cook chicken in a skillet until browned and cooked through, then slice.',
          'Chop cucumber, tomato, and onion and make a quick yogurt-lemon sauce.',
          'Build bowls with rice, chicken, vegetables, and sauce.'
        ]
      },
      {
        name: 'Peruvian Beef & Veggie Stir-Fry', cuisine: 'Peruvian', prep_minutes: 15, cook_minutes: 15,
        difficulty: 'Easy', favorite: false, rating: '', is_new: true,
        tags: ['fresh vegetables', 'quick', 'one pan'], source_url: '',
        ingredients: [
          { amount: '1.5 lb', name: 'lean sirloin', category: 'Meat' },
          { amount: '2', name: 'tomatoes', category: 'Produce' },
          { amount: '1', name: 'red onion', category: 'Produce' },
          { amount: '1 bunch', name: 'cilantro', category: 'Produce' },
          { amount: '2', name: 'limes', category: 'Produce' },
          { amount: '2 cups', name: 'rice', category: 'Pantry' },
          { amount: '3 tbsp', name: 'soy sauce', category: 'Pantry' }
        ],
        steps: [
          'Start the rice.',
          'Slice beef, tomatoes, and onion into strips.',
          'Sear beef quickly in a very hot skillet and remove.',
          'Cook onion and tomato briefly, then return beef with soy sauce and lime.',
          'Finish with cilantro and serve over rice.'
        ]
      }
    ];
  }

  class LocalStore {
    constructor() {
      this.prefix = 'mealz-v2-';
      this.legacyPrefix = 'weeknight-v1-';
      ['recipes', 'meals', 'groceries'].forEach(name => {
        if (localStorage.getItem(this.prefix + name) == null && localStorage.getItem(this.legacyPrefix + name) != null) {
          localStorage.setItem(this.prefix + name, localStorage.getItem(this.legacyPrefix + name));
        }
      });
    }
    read(name, fallback = []) {
      try { return JSON.parse(localStorage.getItem(this.prefix + name)) ?? fallback; }
      catch { return fallback; }
    }
    write(name, value) {
      localStorage.setItem(this.prefix + name, JSON.stringify(value));
    }
    async initialize() {
      let recipes = this.read('recipes');
      if (!recipes.length) {
        recipes = sampleRecipes().map(r => ({ ...r, id: uid(), created_at: new Date().toISOString() }));
        this.write('recipes', recipes);
      }
    }
    async loadAll() {
      return {
        recipes: this.read('recipes'),
        meals: this.read('meals'),
        groceries: this.read('groceries'),
        ingredientLines: this.read('ingredients')
      };
    }
    async saveRecipe(recipe) {
      const recipes = this.read('recipes');
      const next = { ...recipe, id: recipe.id || uid(), created_at: recipe.created_at || new Date().toISOString() };
      const index = recipes.findIndex(r => r.id === next.id);
      if (index >= 0) recipes[index] = next; else recipes.push(next);
      this.write('recipes', recipes);
      return next;
    }
    async saveRecipes(items) {
      const recipes = this.read('recipes');
      const added = items.map(recipe => ({ ...cleanRecipePayload(recipe), id: uid(), created_at: new Date().toISOString() }));
      recipes.push(...added);
      this.write('recipes', recipes);
      return added;
    }
    async deleteRecipe(recipeId) {
      this.write('meals', this.read('meals').filter(m => m.recipe_id !== recipeId));
      this.write('recipes', this.read('recipes').filter(r => r.id !== recipeId));
      this.write('ingredients', this.read('ingredients').filter(l => l.recipe_id !== recipeId));
    }
    async replaceIngredientLines(recipeId, lines) {
      const kept = this.read('ingredients').filter(l => l.recipe_id !== recipeId);
      this.write('ingredients', [...kept, ...lines.map(l => ({ ...l, id: uid(), recipe_id: recipeId }))]);
    }
    async saveRecipeFields(recipeId, fields) {
      const recipes = this.read('recipes');
      const index = recipes.findIndex(r => r.id === recipeId);
      if (index >= 0) { recipes[index] = { ...recipes[index], ...fields }; this.write('recipes', recipes); }
    }
    async clearUnsure(recipeId) {
      this.write('ingredients', this.read('ingredients').map(l => (l.recipe_id === recipeId ? { ...l, unsure: false } : l)));
    }
    async loadPrefs() {
      return this.read('prefs', {});
    }
    async savePrefs(prefs) {
      this.write('prefs', prefs);
    }
    async upsertMeal(meal) {
      const meals = this.read('meals');
      const index = meals.findIndex(m => m.meal_date === meal.meal_date);
      const next = { ...meal, id: index >= 0 ? meals[index].id : uid() };
      if (index >= 0) meals[index] = next; else meals.push(next);
      this.write('meals', meals);
      return next;
    }
    async deleteMeal(mealDate) {
      const meals = this.read('meals');
      const gone = meals.find(m => m.meal_date === mealDate);
      // Same as the database: removing a cook night removes its Leftovers Nights.
      this.write('meals', meals.filter(m => m.meal_date !== mealDate && !(gone && m.source_meal_id === gone.id)));
    }
    async replaceAutoGroceries(start, generated) {
      const all = this.read('groceries');
      const kept = all.filter(g => !(g.week_start === start && !g.manual));
      const added = generated.map(g => ({ ...g, id: uid() }));
      this.write('groceries', [...kept, ...added]);
    }
    async saveGrocery(item) {
      const all = this.read('groceries');
      const next = { ...item, id: item.id || uid() };
      const index = all.findIndex(g => g.id === next.id);
      if (index >= 0) all[index] = next; else all.push(next);
      this.write('groceries', all);
      return next;
    }
    async deleteGrocery(id) {
      this.write('groceries', this.read('groceries').filter(g => g.id !== id));
    }
    async clearChecked(start) {
      this.write('groceries', this.read('groceries').filter(g => !(g.week_start === start && g.checked)));
    }
    async clearWeek(start) {
      this.write('groceries', this.read('groceries').filter(g => g.week_start !== start));
    }
    async reset() {
      ['recipes', 'meals', 'groceries', 'ingredients'].forEach(k => localStorage.removeItem(this.prefix + k));
      await this.initialize();
    }
  }

  class SupabaseStore {
    constructor(client, user, member) {
      this.client = client;
      this.user = user;
      this.householdId = member.household_id;
    }
    own(row) {
      return { ...row, user_id: this.user.id, household_id: this.householdId };
    }
    async initialize() {
      const { data, error } = await this.client.from('recipes').select('id').limit(1);
      if (error) throw error;
      if (!data.length) {
        const rows = sampleRecipes().map(r => this.own(r));
        const { error: insertError } = await this.client.from('recipes').insert(rows);
        if (insertError) throw insertError;
      }
    }
    async loadAll() {
      const [recipesRes, mealsRes, groceriesRes, ingredientLines] = await Promise.all([
        this.client.from('recipes').select('*').order('created_at', { ascending: true }),
        this.client.from('weekly_meals').select('*').order('meal_date', { ascending: true }),
        this.client.from('grocery_items').select('*').order('created_at', { ascending: true }),
        this.loadIngredientLines()
      ]);
      const error = recipesRes.error || mealsRes.error || groceriesRes.error;
      if (error) throw error;
      return { recipes: recipesRes.data, meals: mealsRes.data, groceries: groceriesRes.data, ingredientLines };
    }
    // Supabase returns at most 1,000 rows per request, so read the lines in pages.
    async loadIngredientLines() {
      const rows = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await this.client.from('recipe_ingredients')
          .select('id,recipe_id,position,raw,qty,unit,item,prep,category,unsure')
          .order('recipe_id', { ascending: true }).order('position', { ascending: true })
          .range(from, from + 999);
        if (error) {
          // Before the Phase 2 SQL is run the table does not exist; the app still works.
          if (/recipe_ingredients/i.test(error.message || '')) return [];
          throw error;
        }
        rows.push(...(data || []));
        if (!data || data.length < 1000) return rows;
      }
    }
    async replaceIngredientLines(recipeId, lines) {
      const { error: deleteError } = await this.client.from('recipe_ingredients').delete().eq('recipe_id', recipeId);
      if (deleteError) throw deleteError;
      if (!lines.length) return;
      const rows = lines.map(l => ({
        recipe_id: recipeId, household_id: this.householdId, position: l.position, raw: l.raw,
        qty: l.qty, unit: l.unit, item: l.item, prep: l.prep, category: l.category, unsure: l.unsure
      }));
      const { error } = await this.client.from('recipe_ingredients').insert(rows);
      if (error) throw error;
    }
    async saveRecipeFields(recipeId, fields) {
      const { error } = await this.client.from('recipes').update(fields).eq('id', recipeId);
      if (error) throw error;
    }
    async clearUnsure(recipeId) {
      const { error } = await this.client.from('recipe_ingredients').update({ unsure: false }).eq('recipe_id', recipeId).eq('unsure', true);
      if (error) throw error;
    }
    async loadPrefs() {
      const { data } = await this.client.from('household_members').select('prefs').eq('user_id', this.user.id).maybeSingle();
      return data?.prefs || {};
    }
    async savePrefs(prefs) {
      const { error } = await this.client.from('household_members').update({ prefs }).eq('user_id', this.user.id);
      if (error) throw error;
    }
    async saveRecipe(recipe) {
      const payload = cleanRecipePayload(recipe);
      if (recipe.id) {
        const { data, error } = await this.client.from('recipes').update(payload).eq('id', recipe.id).select().single();
        if (error) throw error;
        return data;
      }
      const { data, error } = await this.client.from('recipes').insert(this.own(payload)).select().single();
      if (error) throw error;
      return data;
    }
    async saveRecipes(items) {
      const added = [];
      for (let i = 0; i < items.length; i += 50) {
        const rows = items.slice(i, i + 50).map(recipe => this.own(cleanRecipePayload(recipe)));
        const { data, error } = await this.client.from('recipes').insert(rows).select();
        if (error) throw error;
        added.push(...(data || []));
      }
      return added;
    }
    async deleteRecipe(recipeId) {
      const { error: mealError } = await this.client.from('weekly_meals').delete().eq('recipe_id', recipeId);
      if (mealError) throw mealError;
      const { error } = await this.client.from('recipes').delete().eq('id', recipeId);
      if (error) throw error;
    }
    async upsertMeal(meal) {
      const payload = { ...cleanMealPayload(meal), household_id: this.householdId };
      delete payload.id;
      const { data, error } = await this.client.from('weekly_meals')
        .upsert(payload, { onConflict: 'household_id,meal_date' }).select().single();
      if (error) throw error;
      return data;
    }
    async deleteMeal(mealDate) {
      const { error } = await this.client.from('weekly_meals').delete().eq('meal_date', mealDate);
      if (error) throw error;
    }
    async replaceAutoGroceries(start, generated) {
      const { error: deleteError } = await this.client.from('grocery_items')
        .delete().eq('week_start', start).eq('manual', false);
      if (deleteError) throw deleteError;
      if (generated.length) {
        const rows = generated.map(g => this.own(g));
        const { error } = await this.client.from('grocery_items').insert(rows);
        if (error) throw error;
      }
    }
    async saveGrocery(item) {
      const payload = item.id ? { ...item } : this.own(item);
      delete payload.created_at;
      delete payload.updated_at;
      delete payload.updated_by;
      if (item.id) {
        const { data, error } = await this.client.from('grocery_items').update(payload).eq('id', item.id).select().single();
        if (error) throw error;
        return data;
      }
      delete payload.id;
      const { data, error } = await this.client.from('grocery_items').insert(payload).select().single();
      if (error) throw error;
      return data;
    }
    async deleteGrocery(id) {
      const { error } = await this.client.from('grocery_items').delete().eq('id', id);
      if (error) throw error;
    }
    async clearChecked(start) {
      const { error } = await this.client.from('grocery_items').delete().eq('week_start', start).eq('checked', true);
      if (error) throw error;
    }
    async clearWeek(start) {
      const { error } = await this.client.from('grocery_items').delete().eq('week_start', start);
      if (error) throw error;
    }
  }

  async function start() {
    root.addEventListener('click', handleClick);
    root.addEventListener('input', handleInput);
    root.addEventListener('change', handleChange);
    root.addEventListener('submit', handleSubmit);

    if (sharedMode) {
      const { data } = await sb.auth.getSession();
      if (!data.session) {
        state.loading = false;
        renderAuth();
        sb.auth.onAuthStateChange((_event, session) => {
          if (session?.user && !state.user) initializeShared(session.user);
        });
        return;
      }
      await initializeShared(data.session.user);
    } else {
      state.user = { id: 'demo', email: 'Demo Mode' };
      store = new LocalStore();
      await store.initialize();
      await reloadData();
      state.loading = false;
      render();
    }
  }

  let initializing = false;

  async function initializeShared(user) {
    if (initializing) return;
    initializing = true;
    state.user = user;
    try {
      const member = await loadMembership(user);
      if (!member) {
        await sb.auth.signOut();
        state.user = null;
        state.loading = false;
        state.authMessage = '';
        state.authError = `${user.email} isn't part of a Mealz household yet. Ask Greg to add this email, then sign in again.`;
        renderAuth();
        return;
      }
      state.member = member;
      store = new SupabaseStore(sb, user, member);
      await store.initialize();
      await reloadData();
      startRealtime(member.household_id);
      state.loading = false;
      render();
    } catch (error) {
      state.loading = false;
      state.authError = `Shared setup needs attention: ${error.message}`;
      renderAuth(true);
    } finally {
      initializing = false;
    }
  }

  // Joins the household if this email was invited, then loads who is in it.
  async function loadMembership(user) {
    const claim = await sb.rpc('claim_household_invite');
    if (claim.error) {
      const missing = /claim_household_invite|function/i.test(claim.error.message || '');
      throw new Error(missing ? 'the Phase 1 database update (supabase-v7-phase1.sql) has not been run yet.' : claim.error.message);
    }
    const { data, error } = await sb.from('household_members').select('household_id,user_id,display_name,email');
    if (error) throw error;
    state.members = data || [];
    return state.members.find(m => m.user_id === user.id) || null;
  }

  function memberName(userId) {
    if (!userId) return '';
    const member = state.members.find(m => m.user_id === userId);
    return member ? (member.display_name || member.email || '') : '';
  }

  function startRealtime(householdId) {
    if (!sb || realtimeChannel) return;
    realtimeChannel = sb.channel(`mealz-${householdId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'recipes', filter: `household_id=eq.${householdId}` }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'weekly_meals', filter: `household_id=eq.${householdId}` }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'grocery_items', filter: `household_id=eq.${householdId}` }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'recipe_ingredients', filter: `household_id=eq.${householdId}` }, scheduleReload)
      .subscribe();
  }

  function scheduleReload() {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(async () => {
      await reloadData();
      renderUnlessEditing();
    }, 250);
  }

  // Background updates should not wipe out a recipe form someone is typing in.
  function renderUnlessEditing() {
    if (state.modal?.type === 'addRecipe' && state.modal.mode !== 'import') return;
    render();
  }

  async function reloadData() {
    if (!store) return;
    const data = await store.loadAll();
    state.recipes = data.recipes || [];
    state.meals = data.meals || [];
    state.groceries = data.groceries || [];
    state.ingredientLines = data.ingredientLines || [];
    if (sb && state.member) {
      const { data: members } = await sb.from('household_members').select('household_id,user_id,display_name,email');
      if (members) state.members = members;
    }
    if (!prefsLoaded) {
      prefsLoaded = true;
      try { state.prefs = window.MealzUnits.cleanPrefs(await store.loadPrefs()); } catch { /* keep defaults */ }
    }
    queueConversions();
  }

  let prefsLoaded = false;

  // ---- Structured ingredients -------------------------------------------------
  // Each recipe's ingredient text is sent to /api/convert-ingredients once, and
  // again whenever the text changes. ingredients_hash records which text the
  // structured lines were made from.

  const conversion = { queue: [], running: false, failed: new Set(), disabled: '', total: 0, done: 0 };

  function recipeLineTexts(recipe) {
    return (recipe?.ingredients || [])
      .map(i => `${String(i?.amount || '').trim()} ${String(i?.name || '').trim()}`.trim())
      .filter(Boolean);
  }

  function ingredientsHash(recipe) {
    const text = recipeLineTexts(recipe).join('\n');
    let h = 5381;
    for (let i = 0; i < text.length; i += 1) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
    return `v1:${h.toString(16)}:${text.length}`;
  }

  function isConverted(recipe) {
    return Boolean(recipe) && recipe.ingredients_hash === ingredientsHash(recipe);
  }

  function linesFor(recipeId) {
    return state.ingredientLines.filter(l => l.recipe_id === recipeId).sort((a, b) => a.position - b.position);
  }

  function unsureCount(recipe) {
    return isConverted(recipe) ? linesFor(recipe.id).filter(l => l.unsure).length : 0;
  }

  function recipeNeedsLook(recipe) {
    return unsureCount(recipe) > 0 || Boolean(recipe?.servings_estimated);
  }

  function queueConversions() {
    if (conversion.disabled || !store) return;
    // Skip quietly until the Phase 2 database update has added the new columns.
    if (state.recipes.length && !('ingredients_hash' in state.recipes[0]) && sharedMode) return;
    const waiting = state.recipes.filter(r => !isConverted(r) && !conversion.failed.has(r.id) && !conversion.queue.includes(r.id));
    if (!waiting.length) return;
    if (!conversion.running) { conversion.total = 0; conversion.done = 0; }
    conversion.queue.push(...waiting.map(r => r.id));
    conversion.total += waiting.length;
    if (!conversion.running) runConversionQueue();
  }

  async function runConversionQueue() {
    conversion.running = true;
    const worker = async () => {
      while (conversion.queue.length && !conversion.disabled) {
        const id = conversion.queue.shift();
        const recipe = recipeById(id);
        if (recipe && !isConverted(recipe)) {
          try {
            await convertRecipe(recipe);
          } catch (error) {
            conversion.failed.add(id);
            if (error.stopAll) conversion.disabled = error.message;
            else console.warn('Ingredient conversion failed for', recipe.name, error.message);
          }
        }
        conversion.done += 1;
        if (state.view === 'more' && !state.modal) render();
      }
    };
    try {
      await Promise.all([worker(), worker()]);
    } finally {
      conversion.running = false;
      conversion.queue = [];
    }
    await reloadData();
    renderUnlessEditing();
  }

  async function convertRecipe(recipe) {
    const hash = ingredientsHash(recipe);
    const lines = recipeLineTexts(recipe);
    if (!lines.length) {
      await store.replaceIngredientLines(recipe.id, []);
      await store.saveRecipeFields(recipe.id, { ingredients_hash: hash, needs_review: false });
      return;
    }
    const headers = { 'Content-Type': 'application/json' };
    if (sharedMode) {
      const { data } = await sb.auth.getSession();
      if (data.session?.access_token) headers.Authorization = `Bearer ${data.session.access_token}`;
    }
    let response;
    try {
      response = await fetch('/api/convert-ingredients', {
        method: 'POST',
        headers,
        body: JSON.stringify({ recipe: {
          name: recipe.name,
          lines,
          steps: (recipe.steps || []).slice(0, 12),
          servings: cleanServings(recipe.servings),
          course: recipe.course || null
        } })
      });
    } catch (error) {
      throw Object.assign(new Error('Ingredient conversion is offline right now.'), { stopAll: true });
    }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const offline = [404, 405, 501].includes(response.status);
      const stopAll = offline || response.status === 401 || result.code === 'NO_KEY';
      const message = offline
        ? 'Ingredient conversion runs on the live site.'
        : (result.error || `Conversion failed (${response.status}).`);
      throw Object.assign(new Error(message), { stopAll });
    }
    // If the recipe was edited while this was running, leave it for the next pass.
    if (ingredientsHash(recipeById(recipe.id) || recipe) !== hash) return;
    const structured = (result.lines || []).map(l => ({
      position: l.position, raw: l.raw, qty: l.qty, unit: l.unit || '', item: l.item || '',
      prep: l.prep || '', category: normalizeCategory(l.category), unsure: Boolean(l.unsure)
    }));
    await store.replaceIngredientLines(recipe.id, structured);
    const fields = { ingredients_hash: hash, needs_review: structured.some(l => l.unsure) };
    if (!cleanServings(recipe.servings) && cleanServings(result.servings)) {
      fields.servings = cleanServings(result.servings);
      fields.servings_estimated = Boolean(result.servings_estimated);
    }
    if (!recipe.course && result.course) fields.course = result.course;
    await store.saveRecipeFields(recipe.id, fields);
    Object.assign(recipe, fields);
  }

  async function markRecipeChecked(recipeId) {
    const recipe = recipeById(recipeId);
    if (!recipe) return;
    await store.clearUnsure(recipeId);
    await store.saveRecipeFields(recipeId, { needs_review: false, servings_estimated: false });
    await reloadData();
    render();
    toast('Marked as checked');
  }

  async function savePrefs(next) {
    state.prefs = window.MealzUnits.cleanPrefs({ ...state.prefs, ...next });
    render();
    await store.savePrefs(state.prefs);
  }

  function renderAuth(setupError = false) {
    const messages = `
          ${state.authError ? `<div class="error-box">${escapeHtml(state.authError)}</div>` : ''}
          ${state.authMessage ? `<div class="success-box">${escapeHtml(state.authMessage)}</div>` : ''}`;
    if (state.authStep === 'sent' && !setupError) {
      root.innerHTML = `
      <main class="auth-shell">
        <section class="auth-card">
          <div class="auth-logo">✉️</div>
          <h1>Check your email</h1>
          <p>We sent a sign in link to <strong>${escapeHtml(state.authEmail)}</strong>. Open the email on this device and tap the link. Mealz opens signed in. It can take a minute to arrive.</p>
          ${messages}
          <div class="auth-actions">
            <button class="btn btn-outline btn-wide" type="button" data-action="resend-link" ${state.authBusy ? 'disabled' : ''}>${state.authBusy ? 'Sending…' : 'Send It Again'}</button>
            <button class="btn btn-outline btn-wide" type="button" data-action="use-password">Back</button>
          </div>
          <p style="font-size:12px;margin-bottom:0">The link opens in Safari. The Mealz icon on your home screen stays signed in on its own until you tap Sign Out there.</p>
        </section>
      </main>`;
      return;
    }
    root.innerHTML = `
      <main class="auth-shell">
        <section class="auth-card">
          <div class="auth-logo">🍽</div>
          <h1>Mealz</h1>
          <p>Each of you signs in with your own email. Your week, recipes, and grocery list are shared between you.</p>
          ${messages}
          <form id="auth-form" class="auth-form">
            <input class="text-input" name="email" type="email" autocomplete="email" placeholder="Email" value="${escapeHtml(state.authEmail)}" required />
            <button class="btn btn-primary btn-wide" type="button" data-action="email-link" ${state.authBusy ? 'disabled' : ''}>${state.authBusy ? 'Sending…' : 'Email Me a Sign In Link'}</button>
            <p class="auth-or">No password needed. Or use your password:</p>
            <input class="text-input" name="password" type="password" autocomplete="current-password" placeholder="Password" minlength="6" />
            <div class="auth-actions">
              <button class="btn btn-outline btn-wide" type="submit" data-auth-action="signin">Sign In With Password</button>
              <button class="btn btn-outline btn-wide" type="button" data-action="signup">Create Account</button>
            </div>
          </form>
          <p style="font-size:12px;margin-bottom:0">New to Mealz? Tap Email Me a Sign In Link using the email Greg invited. You'll join the household as soon as you sign in.</p>
        </section>
      </main>`;
  }

  // Sign in with a link sent by email, so no password is needed.
  async function emailSignInLink() {
    const form = document.getElementById('auth-form');
    const email = String((form ? new FormData(form).get('email') : state.authEmail) || '').trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      state.authError = 'Enter your email first.'; state.authMessage = ''; renderAuth(); return;
    }
    state.authEmail = email; state.authError = ''; state.authMessage = ''; state.authBusy = true; renderAuth();
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true, emailRedirectTo: `${location.origin}/` }
    });
    state.authBusy = false;
    if (error) {
      state.authError = /rate|seconds|security/i.test(error.message || '')
        ? 'Too many emails asked for. Wait a few minutes, then try again, or use your password.'
        : error.message;
      renderAuth(); return;
    }
    if (state.authStep === 'sent') state.authMessage = 'Sent again.';
    state.authStep = 'sent';
    renderAuth();
  }

  function captureViewState() {
    const active = document.activeElement;
    const snapshot = {
      pageScroll: window.scrollY,
      modalScroll: document.querySelector('.modal')?.scrollTop || 0,
      chipScrolls: [...document.querySelectorAll('.chip-row')].map(el => el.scrollLeft),
      focusId: active && active.id ? active.id : '',
      selectionStart: null,
      selectionEnd: null
    };
    if (snapshot.focusId && typeof active.selectionStart === 'number') {
      snapshot.selectionStart = active.selectionStart;
      snapshot.selectionEnd = active.selectionEnd;
    }
    return snapshot;
  }

  function restoreViewState(snapshot) {
    if (!snapshot) return;
    const modal = document.querySelector('.modal');
    if (modal && snapshot.modalScroll) modal.scrollTop = snapshot.modalScroll;
    [...document.querySelectorAll('.chip-row')].forEach((el, index) => {
      if (snapshot.chipScrolls[index]) el.scrollLeft = snapshot.chipScrolls[index];
    });
    if (snapshot.pageScroll) window.scrollTo(0, snapshot.pageScroll);
    if (!snapshot.focusId) return;
    const field = document.getElementById(snapshot.focusId);
    if (!field) return;
    field.focus({ preventScroll: true });
    if (snapshot.selectionStart != null && typeof field.setSelectionRange === 'function') {
      try { field.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd); } catch { /* ignore */ }
    }
  }

  function render() {
    const snapshot = captureViewState();
    renderNow();
    restoreViewState(snapshot);
  }

  function renderNow() {
    if (state.loading) {
      root.innerHTML = `<main class="auth-shell"><div class="auth-card"><strong>Loading Mealz…</strong></div></main>`;
      return;
    }
    if (state.cook) {
      renderCook();
      return;
    }

    root.innerHTML = `
      <div class="app-shell">
        <header class="topbar">
          <div class="brand-wrap">
            <div class="brand-mark">🍽</div>
            <div><div class="brand">Meal<span class="brand-z">z</span></div><div class="subbrand">plan, eat, survive</div></div>
          </div>
          <div class="mode-pill">${sharedMode ? '☁ Shared household' : '◉ Demo on this device'}</div>
        </header>
        <main class="main-content">${renderView()}</main>
      </div>
      ${renderBottomNav()}
      ${state.modal ? renderModal() : ''}`;
  }

  function renderView() {
    if (state.view === 'recipes') return renderRecipes();
    if (state.view === 'grocery') return renderGrocery();
    if (state.view === 'more') return renderMore();
    return renderWeek();
  }

  function renderBottomNav() {
    const items = [
      ['week', '📅', 'Week'], ['recipes', '🍽', 'Recipes'], ['grocery', '🛒', 'Grocery'], ['more', '•••', 'More']
    ];
    return `<nav class="bottom-nav" aria-label="Main navigation">
      ${items.map(([key, icon, label]) => `
        <button type="button" class="nav-btn ${state.view === key ? 'active' : ''}" data-action="nav" data-view="${key}">
          <span class="nav-icon">${icon}</span><span>${label}</span>
        </button>`).join('')}
    </nav>`;
  }

  function weekTitle() {
    const current = startOfWeek(new Date());
    const diff = Math.round((state.weekStart - current) / (7 * 24 * 60 * 60 * 1000));
    if (diff === 0) return 'This Week';
    if (diff === 1) return 'Next Week';
    if (diff === -1) return 'Last Week';
    return diff > 1 ? `${diff} Weeks Ahead` : `${Math.abs(diff)} Weeks Ago`;
  }

  function mealForDate(key) {
    return state.meals.find(m => m.meal_date === key);
  }

  function recipeById(id) {
    return state.recipes.find(r => r.id === id);
  }

  // ---- Servings and leftovers ----------------------------------------------
  // A recipe's own yield, or 4 when we do not know it.
  function recipeYield(recipe) {
    return cleanServings(recipe?.servings) || 4;
  }

  // Mealz never plans fewer than 4 servings.
  function baseServings(recipe) {
    return Math.max(4, recipeYield(recipe));
  }

  function linkedLeftovers(meal) {
    if (!meal?.id) return [];
    return state.meals.filter(m => m.type === 'leftover' && m.source_meal_id === meal.id)
      .sort((a, b) => a.meal_date.localeCompare(b.meal_date));
  }

  function defaultServings(recipe, nights) {
    return baseServings(recipe) + 4 * nights;
  }

  // Total servings to cook on a cook night.
  function plannedServings(meal, recipe) {
    return cleanServings(meal?.servings) || defaultServings(recipe, linkedLeftovers(meal).length);
  }

  function hasExtra(meal, recipe) {
    return linkedLeftovers(meal).length > 0 || plannedServings(meal, recipe) !== baseServings(recipe);
  }

  function weekdayName(key, style = 'long') {
    return parseLocalDate(key).toLocaleDateString(undefined, { weekday: style });
  }

  function followingDays(key, count) {
    return Array.from({ length: count }, (_, i) => dateKey(addDays(parseLocalDate(key), i + 1)));
  }

  const DEFAULT_DISH_TYPES = ['Chicken', 'Beef', 'Pork', 'Turkey', 'Seafood', 'Lamb', 'Vegetarian', 'Pasta', 'Soup', 'Other'];

  function dishTypeOf(recipe) {
    const tagged = (recipe?.tags || []).find(tag => /^dish:/i.test(String(tag)));
    if (tagged) return String(tagged).replace(/^dish:/i, '').trim() || 'Other';
    const inferred = window.MealzRecipeKeeper?.inferDishType?.({
      name: recipe?.name || '',
      ingredients: recipe?.ingredients || [],
      categories: recipe?.tags || [],
      courses: []
    });
    return inferred || 'Other';
  }

  function visibleRecipeTags(recipe) {
    return (recipe?.tags || []).filter(tag => !/^dish:/i.test(String(tag)) && !/^Recipe Keeper$/i.test(String(tag)));
  }

  function dishTypeOptions() {
    const used = state.recipes.map(dishTypeOf).filter(Boolean);
    return [...new Set([...DEFAULT_DISH_TYPES, ...used])];
  }

  function withDishTypeTag(tags, dishType) {
    const cleaned = (tags || []).filter(tag => !/^dish:/i.test(String(tag)));
    const type = String(dishType || 'Other').trim() || 'Other';
    return [`dish:${type}`, ...cleaned];
  }

  function mealClass(meal, recipe) {
    if (!meal) return 'open';
    if (meal.type === 'leftover') return 'leftover';
    if (meal.type === 'eatout') return 'eatout';
    if (recipe?.is_new) return 'new';
    if ((Number(recipe?.prep_minutes || 0) + Number(recipe?.cook_minutes || 0)) <= 30) return 'quick';
    return 'meal';
  }

  function mealDisplay(meal) {
    if (!meal) return { name: '', meta: '' };
    if (meal.type === 'eatout') return { name: meal.label || 'Eating Out', meta: 'No groceries needed' };
    const recipe = recipeById(meal.recipe_id);
    const name = recipe?.name || meal.label || 'Meal';
    if (meal.type === 'leftover') {
      const source = meal.source_meal_id ? state.meals.find(m => m.id === meal.source_meal_id) : null;
      return { name: `Leftovers: ${name}`, meta: source ? `From ${weekdayName(source.meal_date)} · nothing to buy` : 'Easy night' };
    }
    const total = Number(recipe?.prep_minutes || 0) + Number(recipe?.cook_minutes || 0);
    const extra = recipe && hasExtra(meal, recipe) ? ` · ${plannedServings(meal, recipe)} servings` : '';
    return { name, meta: `${total || '?'} min · ${recipe?.difficulty || 'Easy'}${extra}` };
  }

  function renderWeek() {
    const today = new Date();
    const days = Array.from({ length: 7 }, (_, i) => addDays(state.weekStart, i));

    return `
      <section class="week-panel">
        <div class="week-head">
          <div><div class="week-kicker">Dinner Plan</div><div class="week-title-big">${weekTitle()}</div><div class="week-range">${formatWeekRange(state.weekStart)}</div></div>
          <div class="week-nav-buttons"><button type="button" class="icon-btn" data-action="previous-week" aria-label="Previous week">‹</button><button type="button" class="icon-btn" data-action="next-week" aria-label="Next week">›</button></div>
        </div>
        <div class="week-list">
          ${days.map(day => renderDay(day, sameDay(day, today))).join('')}
        </div>
        <div class="legend" aria-label="Calendar color key">
          <span class="legend-item"><i class="legend-dot dot-meal"></i> Planned</span>
          <span class="legend-item"><i class="legend-dot dot-quick"></i> Quick</span>
          <span class="legend-item"><i class="legend-dot dot-leftover"></i> Leftovers</span>
          <span class="legend-item"><i class="legend-dot dot-new"></i> New</span>
          <span class="legend-item"><i class="legend-dot dot-open"></i> Open</span>
        </div>
      </section>
      <section class="tile-grid">
        <button type="button" class="tile" data-action="build-grocery"><span class="tile-icon">🛒</span><strong>Grocery List</strong><span>Build from this week</span></button>
        <button type="button" class="tile" data-action="recommend-week"><span class="tile-icon">✨</span><strong>Help Me Pick</strong><span>Suggestions for the week</span></button>
      </section>`;
  }

  function renderDay(day, isToday) {
    const key = dateKey(day);
    const meal = mealForDate(key);
    const recipe = meal?.recipe_id ? recipeById(meal.recipe_id) : null;
    const display = mealDisplay(meal);
    const type = mealClass(meal, recipe);
    const note = String(meal?.notes || '').trim();
    return `<article class="day-row ${isToday ? 'today' : ''}">
      <div class="day-date-col"><span class="day-name">${day.toLocaleDateString(undefined, { weekday: 'short' })}</span><span class="day-date">${day.getDate()}</span></div>
      ${meal
        ? `<button type="button" class="day-meal-btn type-${type}" data-action="open-meal" data-date="${key}">
             <span class="meal-name">${escapeHtml(display.name)}</span>
             <span class="meal-meta">${escapeHtml(display.meta)}</span>
             ${note ? `<span class="meal-note-flag">📝 ${escapeHtml(note.length > 46 ? `${note.slice(0, 46)}…` : note)}</span>` : ''}
           </button>`
        : `<button type="button" class="day-plan-btn" data-action="plan-date" data-date="${key}">+ Plan dinner</button>`}
    </article>`;
  }

  const DISH_ICONS = {
    Chicken: '🍗', Beef: '🥩', Pork: '🥓', Turkey: '🦃', Seafood: '🐟', Lamb: '🐑',
    Vegetarian: '🥦', Pasta: '🍝', Soup: '🥣', Other: '🍽'
  };

  function dishIcon(recipe) {
    return DISH_ICONS[dishTypeOf(recipe)] || '🍽';
  }

  function matchesSearch(recipe, query) {
    if (!query) return true;
    return [recipe.name, recipe.cuisine, dishTypeOf(recipe), ...visibleRecipeTags(recipe)]
      .join(' ').toLowerCase().includes(query);
  }

  function sortByName(list) {
    return [...list].sort((a, b) => Number(b.favorite) - Number(a.favorite) || String(a.name).localeCompare(String(b.name)));
  }

  function dishTypesInUse() {
    return [...new Set(state.recipes.map(dishTypeOf).filter(Boolean))].sort((a, b) => {
      const ia = DEFAULT_DISH_TYPES.indexOf(a), ib = DEFAULT_DISH_TYPES.indexOf(b);
      if (ia >= 0 || ib >= 0) return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
      return a.localeCompare(b);
    });
  }

  function filteredRecipes() {
    const q = state.recipeSearch.trim().toLowerCase();
    return sortByName(state.recipes.filter(r => matchesSearch(r, q) && passesFilter(r, 'recipes')));
  }

  function recipeListInner(recipes) {
    return recipes.length
      ? recipes.map(r => renderRecipeTile(r, 'view-recipe')).join('')
      : '<div class="panel empty-state" style="grid-column:1/-1"><strong>No recipes found.</strong>Try another search or clear the filters.</div>';
  }

  function recipeHeadInner(recipes) {
    const f = filterFor('recipes');
    const label = f.favoritesOnly ? 'Favorites' : f.types.length === 1 ? f.types[0] : 'Recipes';
    return `<h3>${escapeHtml(label)}</h3><span>${recipes.length} ${recipes.length === 1 ? 'recipe' : 'recipes'}</span>`;
  }

  function renderFilterBar(context) {
    const f = filterFor(context);
    const count = filterCount(context);
    const inputId = context === 'plan' ? 'plan-search' : 'recipe-search';
    const value = context === 'plan' ? state.planSearch : state.recipeSearch;
    return `<div class="sticky-head">
      <div class="filter-bar">
        <input id="${inputId}" class="search-input" type="search" placeholder="Search recipes" value="${escapeHtml(value)}" />
        <button type="button" class="filter-btn ${count ? 'active' : ''}" data-action="open-filter" data-context="${context}">☰ Filter${count ? ` (${count})` : ''}</button>
        <button type="button" class="filter-btn heart-btn ${f.favoritesOnly ? 'active' : ''}" data-action="toggle-favorites-filter" data-context="${context}" aria-label="Show favorites only">${f.favoritesOnly ? '❤️' : '♡'}</button>
      </div>
    </div>`;
  }

  function renderRecipeTile(recipe, action, extra = '') {
    const total = Number(recipe.prep_minutes || 0) + Number(recipe.cook_minutes || 0);
    const type = dishTypeOf(recipe);
    return `<div class="recipe-tile">
      <button type="button" class="tile-main" data-action="${action}" data-recipe-id="${recipe.id}" ${extra}>
        <span class="tile-art dish-${escapeHtml(String(type).replace(/[^a-z]/gi, ''))}">${dishIcon(recipe)}</span>
        <span class="tile-body">
          <span class="tile-name">${escapeHtml(recipe.name)}</span>
          <span class="tile-meta">${escapeHtml(type)} · ${total || '?'} min${recipe.is_new ? ' · ✨' : ''}${recipeNeedsLook(recipe) ? ' <span class="flag" title="Mealz needs a quick check on this recipe">⚑</span>' : ''}</span>
        </span>
      </button>
      <button type="button" class="tile-fav" data-action="toggle-favorite" data-recipe-id="${recipe.id}" aria-label="Toggle favorite">${recipe.favorite ? '❤️' : '♡'}</button>
    </div>`;
  }

  function renderRecipes() {
    const recipes = filteredRecipes();
    return `
      <section>
        ${renderFilterBar('recipes')}
        <div class="list-head">${recipeHeadInner(recipes)}</div>
        <div class="recipe-grid">${recipeListInner(recipes)}</div>
      </section>
      <section class="tile-grid" style="margin-top:14px">
        <button type="button" class="tile" data-action="add-recipe"><span class="tile-icon">＋</span><strong>Add Recipe</strong><span>Link or manual entry</span></button>
        <label class="tile recipekeeper-file-label" for="recipekeeper-file"><span class="tile-icon">⇩</span><strong>Import</strong><span>Recipe Keeper export</span><input id="recipekeeper-file" class="visually-hidden-file" type="file" accept=".zip,.html,.htm,text/html,application/zip" /></label>
      </section>`;
  }

  function currentWeekGroceries() {
    return state.groceries.filter(g => g.week_start === weekKey());
  }

  function renderGrocery() {
    const items = currentWeekGroceries();
    const remaining = items.filter(i => !i.checked).length;
    const visible = state.hideChecked ? items.filter(i => !i.checked) : items;
    const categories = ['Produce', 'Meat', 'Dairy', 'Bakery', 'Pantry', 'Frozen', 'Other'];
    return `<section class="panel">
      <div class="grocery-head">
        <div><h2 class="section-title">Grocery List</h2><p class="section-subtitle">${formatWeekRange(state.weekStart)}</p></div>
        <div class="count-line">${items.length ? `${remaining} of ${items.length} still to get` : 'Nothing on the list yet'}</div>
      </div>
      <form id="grocery-form" class="grocery-add">
        <input class="text-input" name="name" placeholder="Add milk, fruit, snacks…" required />
        <select class="select-input" name="category">${categories.map(c => `<option>${c}</option>`).join('')}</select>
        <button class="btn btn-primary" type="submit">Add</button>
      </form>
      <div class="tile-grid" style="margin-top:12px">
        <button type="button" class="tile" data-action="build-grocery"><span class="tile-icon">🔄</span><strong>Rebuild</strong><span>From this week's meals</span></button>
        <button type="button" class="tile" data-action="toggle-hide-checked"><span class="tile-icon">${state.hideChecked ? '👁' : '🙈'}</span><strong>${state.hideChecked ? 'Show Checked' : 'Hide Checked'}</strong><span>${state.hideChecked ? 'Bring them back' : 'While you shop'}</span></button>
        <button type="button" class="tile" data-action="clear-checked" ${items.some(i => i.checked) ? '' : 'disabled'}><span class="tile-icon">✓</span><strong>Clear Checked</strong><span>Remove what you got</span></button>
        <button type="button" class="tile tile-danger" data-action="clear-all-groceries" ${items.length ? '' : 'disabled'}><span class="tile-icon">🗑</span><strong>Clear All</strong><span>Empty the whole list</span></button>
      </div>
    </section>
    <section class="panel">
      ${visible.length ? categories.map(cat => renderGroceryCategory(cat, visible.filter(i => (i.category || 'Other') === cat))).join('') : '<div class="empty-state"><strong>Nothing to show.</strong>Plan meals, then tap Grocery List on the plan screen. You can also add anything manually.</div>'}
    </section>`;
  }

  function renderGroceryCategory(category, items) {
    if (!items.length) return '';
    const sorted = [...items].sort((a, b) => Number(a.checked) - Number(b.checked));
    return `<div class="grocery-category"><h3>${escapeHtml(category)}</h3><div class="grocery-list">
      ${sorted.map(item => `<label class="grocery-item ${item.checked ? 'checked' : ''}">
        <input type="checkbox" data-action="toggle-grocery" data-id="${item.id}" ${item.checked ? 'checked' : ''} />
        <span><span class="grocery-name">${escapeHtml(item.name)}</span>${groceryAmount(item) ? `<span class="grocery-amount"> · ${escapeHtml(groceryAmount(item))}</span>` : ''}${item.manual ? '<span class="grocery-amount"> · added manually</span>' : ''}</span>
        <button type="button" class="delete-item" data-action="delete-grocery" data-id="${item.id}" aria-label="Delete item">×</button>
      </label>`).join('')}
    </div></div>`;
  }

  function renderMore() {
    return `<section class="panel">
      <h2 class="section-title">More</h2><p class="section-subtitle">Keep the settings out of the way.</p>
      <div class="more-list" style="margin-top:14px">
        <div class="more-row"><div><strong>${sharedMode ? `Signed in as ${escapeHtml(state.member?.display_name || state.user?.email || '')}` : 'Demo Mode'}</strong><span>${sharedMode ? escapeHtml(state.user?.email || 'Signed in') : 'Data is currently saved only on this device.'}</span></div><span>${sharedMode ? '☁' : '◉'}</span></div>
        ${sharedMode ? `<div class="more-row"><div><strong>Household</strong><span>${state.members.length > 1 ? escapeHtml(state.members.map(m => m.display_name || m.email).join(' and ')) + ' share everything.' : 'Waiting for Stephanie to create her account.'}</span></div><span>🏠</span></div>` : ''}
        ${renderUnitSettings()}
        ${renderIngredientStatus()}
        <div class="more-row"><div><strong>Recipe style</strong><span>Fast prep · healthy · lean protein · fresh vegetables · simple.</span></div><span>✓</span></div>
        <div class="more-row"><div><strong>Favorite flavors</strong><span>Mexican · Greek · Peruvian · similar weeknight meals.</span></div><span>✓</span></div>
        ${sharedMode ? '<div class="more-row"><div><strong>Account</strong><span>Mealz stays signed in on this device until you choose Sign Out.</span></div><button type="button" class="btn btn-outline btn-small" data-action="signout">Sign Out</button></div>' : '<div class="more-row"><div><strong>Reset demo</strong><span>Restore the sample recipes and clear local planning data.</span></div><button type="button" class="btn btn-outline btn-small" data-action="reset-demo">Reset</button></div>'}
      </div>
    </section>
    <section class="panel"><h3 style="margin-top:0">Next upgrades</h3><p class="section-subtitle">Recipe Keeper bulk import is now built in. Prep-ahead mode and smarter “similar but new” suggestions are the next logical upgrades, using your growing Mealz history.</p></section>`;
  }

  function renderUnitSettings() {
    const p = state.prefs;
    const option = (pref, value, label) => `<button type="button" class="seg-btn ${p[pref] === value ? 'active' : ''}" data-action="set-pref" data-pref="${pref}" data-value="${value}">${label}</button>`;
    return `<div class="more-row more-row-stack"><div><strong>Amounts</strong><span>How numbers show on the grocery list and recipes. Just for you.</span></div>
        <div class="seg">${option('numbers', 'fractions', '1 1/2')}${option('numbers', 'decimals', '1.5')}</div></div>
      <div class="more-row more-row-stack"><div><strong>Weights</strong><span>${escapeHtml(window.MealzUnits.formatMeasure({ v: 0, vu: [], w: 24, c: {} }, p))} is how 1 1/2 pounds will show.</span></div>
        <div class="seg">${option('weights', 'oz', 'Ounces')}${option('weights', 'lb_oz', 'Lb and oz')}${option('weights', 'lb', 'Pounds')}</div></div>`;
  }

  function renderIngredientStatus() {
    const total = state.recipes.filter(r => recipeLineTexts(r).length).length;
    if (!total) return '';
    const done = state.recipes.filter(r => recipeLineTexts(r).length && isConverted(r)).length;
    const toCheck = state.recipes.filter(recipeNeedsLook).length;
    let text = `${done} of ${total} recipes are ready for the smart grocery list.`;
    if (conversion.running) text = `Organizing ingredients: ${conversion.done} of ${conversion.total} done. You can keep using Mealz.`;
    else if (conversion.disabled && done < total) text += ` ${conversion.disabled}`;
    if (toCheck) text += ` ${toCheck} ${toCheck === 1 ? 'recipe needs' : 'recipes need'} a quick check (marked ⚑).`;
    return `<div class="more-row"><div><strong>Ingredients</strong><span>${escapeHtml(text)}</span></div><span>${conversion.running ? '⏳' : done === total ? '✓' : '…'}</span></div>`;
  }

  function renderModal() {
    if (state.modal.type === 'plan') return renderPlanModal();
    if (state.modal.type === 'mealNight') return renderMealNightSheet();
    if (state.modal.type === 'filter') return renderFilterSheet();
    if (state.modal.type === 'leftoverPrompt') return renderLeftoverPrompt();
    if (state.modal.type === 'leftovers') return renderLeftoversSheet();
    if (state.modal.type === 'recipeDetail') return renderRecipeDetailModal();
    if (state.modal.type === 'addRecipe') return renderAddRecipeModal();
    if (state.modal.type === 'chooseDay') return renderChooseDayModal();
    if (state.modal.type === 'recommendWeek') return renderRecommendWeekModal();
    if (state.modal.type === 'recipeKeeperPreview') return renderRecipeKeeperPreview();
    return '';
  }

  function modalShell(title, subtitle, body) {
    return `<div class="modal-backdrop" data-action="modal-backdrop"><section class="modal" role="dialog" aria-modal="true">
      <div class="modal-head"><div><h2 class="modal-title">${escapeHtml(title)}</h2>${subtitle ? `<div class="modal-subtitle">${escapeHtml(subtitle)}</div>` : ''}</div><button type="button" class="close-btn" data-action="close-modal" aria-label="${state.modalStack.length ? 'Back' : 'Close'}">${state.modalStack.length ? '‹' : '×'}</button></div>
      ${body}
    </section></div>`;
  }

  function renderRecipeKeeperPreview() {
    const recipes = state.modal.recipes || [];
    const skipped = state.modal.skipped || [];
    const preview = recipes.slice(0, 14);
    const body = `<div class="import-recipe-panel">
      <div class="import-success"><strong>✓ Recipe Keeper file read</strong><span>${recipes.length} new ${recipes.length === 1 ? 'recipe' : 'recipes'} ready to add.${skipped.length ? ` ${skipped.length} existing ${skipped.length === 1 ? 'recipe was' : 'recipes were'} skipped.` : ''}</span></div>
      <div class="rk-preview-list">${preview.map(recipe => `<div class="rk-preview-row"><div><strong>${escapeHtml(recipe.name)}</strong><span>${escapeHtml(dishTypeOf(recipe))}${recipe.cuisine ? ` · ${escapeHtml(recipe.cuisine)}` : ''}</span></div>${recipe.favorite ? '<span>❤️</span>' : ''}</div>`).join('')}${recipes.length > preview.length ? `<div class="rk-preview-more">+ ${recipes.length - preview.length} more</div>` : ''}</div>
      ${skipped.length ? `<p class="form-help">Already in Mealz: ${escapeHtml(skipped.slice(0, 8).join(', '))}${skipped.length > 8 ? '…' : ''}</p>` : ''}
      <button type="button" class="btn btn-primary btn-wide" data-action="import-recipekeeper-confirm" ${recipes.length ? '' : 'disabled'}>Import ${recipes.length} ${recipes.length === 1 ? 'Recipe' : 'Recipes'}</button>
      <button type="button" class="btn btn-outline btn-wide" data-action="close-modal">Cancel</button>
      <p class="form-help centered">Mealz imports the recipe text, times, favorites, source link, and Recipe Keeper categories. Photos stay in Recipe Keeper for now.</p>
    </div>`;
    return modalShell('Import Recipe Keeper', 'One bulk import instead of retyping your collection.', body);
  }

  function leftoverCandidates(key) {
    const earlier = state.meals
      .filter(m => m.type === 'meal' && m.meal_date < key && m.meal_date >= weekKey() && m.recipe_id)
      .map(m => recipeById(m.recipe_id)).filter(Boolean);
    return [...new Map(earlier.map(r => [r.id, r])).values()].reverse();
  }

  function planPickList() {
    const key = state.modal.date;
    const mode = state.modal.mode || 'suggested';
    const q = state.planSearch.trim().toLowerCase();
    const narrowed = q || filterCount('plan') || filterFor('plan').favoritesOnly;
    let list = [];
    if (mode === 'leftover') list = leftoverCandidates(key);
    else if (narrowed) list = sortByName(state.recipes);
    else list = getRecommendations();

    list = list.filter(r => matchesSearch(r, q) && passesFilter(r, 'plan'));
    if (mode !== 'leftover' && !narrowed) list = list.slice(0, 12);
    return list;
  }

  function pickListInner(list, mode) {
    return list.length
      ? list.map(r => renderRecipeTile(r, 'select-plan-recipe', `data-leftover="${mode === 'leftover' ? 'true' : 'false'}"`)).join('')
      : '<div class="panel empty-state" style="grid-column:1/-1"><strong>Nothing matches.</strong>Try another search or clear the filter.</div>';
  }

  function renderPlanModal() {
    const key = state.modal.date;
    const date = parseLocalDate(key);
    const current = mealForDate(key);
    const mode = state.modal.mode || 'suggested';
    const list = planPickList();
    const narrowed = state.planSearch.trim() || filterCount('plan') || filterFor('plan').favoritesOnly;

    const body = `
      ${renderFilterBar('plan')}
      <div class="list-head">
        <h3>${mode === 'leftover' ? 'Planned earlier this week' : narrowed ? 'Matches' : 'Suggested'}</h3>
        <span>${list.length} ${list.length === 1 ? 'recipe' : 'recipes'}</span>
      </div>
      <div class="recipe-grid pick-list">${pickListInner(list, mode)}</div>
      <div class="sheet-section">
        <h3>Other options</h3>
        <div class="tile-grid tile-grid-3">
          ${mode === 'leftover'
            ? '<button type="button" class="tile" data-action="plan-mode" data-mode="suggested"><span class="tile-icon">↩</span><strong>All Recipes</strong></button>'
            : '<button type="button" class="tile" data-action="plan-mode" data-mode="leftover"><span class="tile-icon">🟡</span><strong>Leftovers</strong></button>'}
          <button type="button" class="tile" data-action="set-eatout"><span class="tile-icon">🥡</span><strong>Eating Out</strong></button>
          <button type="button" class="tile" data-action="add-recipe"><span class="tile-icon">＋</span><strong>New Recipe</strong></button>
          ${current ? '<button type="button" class="tile tile-danger" data-action="clear-day"><span class="tile-icon">×</span><strong>Clear Day</strong></button>' : ''}
        </div>
      </div>`;
    return modalShell(`Plan ${date.toLocaleDateString(undefined, { weekday: 'long' })}`, date.toLocaleDateString(undefined, { month: 'long', day: 'numeric' }), body);
  }

  function renderFilterSheet() {
    const context = state.modal.context || 'recipes';
    const f = filterFor(context);
    const types = dishTypesInUse();
    const body = `
      <div class="sheet-section">
        <h3>Dish type</h3>
        <div class="filter-options">
          ${types.length ? types.map(type => `<button type="button" class="filter-option ${f.types.includes(type) ? 'active' : ''}" data-action="filter-type" data-context="${context}" data-type="${escapeHtml(type)}"><span class="filter-check">${f.types.includes(type) ? '✓' : ''}</span>${escapeHtml(type)}</button>`).join('') : '<p class="form-help">No dish types yet.</p>'}
        </div>
        <p class="form-help">Pick as many as you want. New categories show up here automatically.</p>
      </div>
      <div class="sheet-section">
        <h3>Total time</h3>
        <div class="filter-list">
          ${TIME_OPTIONS.map(([value, label]) => `<button type="button" class="filter-row ${f.time === value ? 'active' : ''}" data-action="filter-time" data-context="${context}" data-time="${value}"><span>${label}</span><span class="filter-check">${f.time === value ? '✓' : ''}</span></button>`).join('')}
        </div>
      </div>
      <div class="sheet-section note-actions">
        <button type="button" class="btn btn-outline" data-action="filter-clear" data-context="${context}">Clear Filter</button>
        <button type="button" class="btn btn-primary" data-action="close-modal">Done</button>
      </div>`;
    return modalShell('Filter', 'Narrow the list down', body);
  }

  function renderMealNightSheet() {
    const key = state.modal.date;
    const date = parseLocalDate(key);
    const meal = mealForDate(key);
    if (!meal) return '';
    const recipe = meal.recipe_id ? recipeById(meal.recipe_id) : null;
    const display = mealDisplay(meal);
    const type = mealClass(meal, recipe);
    const noteValue = state.modal.noteDraft != null ? state.modal.noteDraft : String(meal.notes || '');
    const source = meal.type === 'leftover' && meal.source_meal_id ? state.meals.find(m => m.id === meal.source_meal_id) : null;
    const leftoverNights = meal.type === 'meal' ? linkedLeftovers(meal) : [];
    const leftoverSummary = recipe && meal.type === 'meal'
      ? `${plannedServings(meal, recipe)} servings${leftoverNights.length ? ` · ${leftoverNights.length} leftover ${leftoverNights.length === 1 ? 'night' : 'nights'}` : ''}`
      : '';

    const plannedBy = memberName(meal.updated_by);
    const body = `
      <div class="meal-hero type-${type}">
        <strong>${escapeHtml(display.name)}</strong>
        <span>${escapeHtml(display.meta)}</span>
        ${plannedBy && state.members.length > 1 ? `<span class="meal-by">Planned by ${escapeHtml(plannedBy)}</span>` : ''}
      </div>
      <div class="sheet-section">
        <h3>Notes for this night</h3>
        <div class="note-block">
          <textarea id="meal-note" class="textarea-input" placeholder="Potatoes as a side. Red and yellow bell peppers. Start it early.">${escapeHtml(noteValue)}</textarea>
          <div class="note-actions">
            <button type="button" class="btn btn-primary" data-action="save-note">Save Note</button>
            <button type="button" class="btn btn-outline" data-action="note-to-grocery">Send to Grocery</button>
          </div>
        </div>
      </div>
      <div class="sheet-section">
        <h3>Actions</h3>
        <div class="tile-grid tile-grid-3">
          ${recipe ? `<button type="button" class="tile" data-action="view-recipe" data-recipe-id="${recipe.id}"><span class="tile-icon">📖</span><strong>Recipe</strong></button>` : ''}
          ${recipe ? `<button type="button" class="tile" data-action="cook" data-recipe-id="${recipe.id}"><span class="tile-icon">👨‍🍳</span><strong>Cook</strong></button>` : ''}
          <button type="button" class="tile" data-action="plan-date" data-date="${key}"><span class="tile-icon">🔄</span><strong>Swap</strong></button>
          ${recipe && meal.type === 'meal' ? `<button type="button" class="tile ${hasExtra(meal, recipe) ? 'tile-on' : ''}" data-action="open-leftovers" data-date="${key}"><span class="tile-icon">🍲</span><strong>Servings</strong><span>${escapeHtml(leftoverSummary)}</span></button>` : ''}
          ${source ? `<button type="button" class="tile" data-action="open-meal" data-date="${source.meal_date}"><span class="tile-icon">🍳</span><strong>Cook Night</strong><span>${escapeHtml(weekdayName(source.meal_date))}</span></button>` : ''}
          <button type="button" class="tile tile-danger" data-action="clear-day"><span class="tile-icon">×</span><strong>Clear</strong></button>
        </div>
      </div>`;
    return modalShell(date.toLocaleDateString(undefined, { weekday: 'long' }), date.toLocaleDateString(undefined, { month: 'long', day: 'numeric' }), body);
  }

  function renderLeftoverPrompt() {
    const recipe = recipeById(state.modal.recipeId);
    const body = `<div class="panel"><p style="margin-top:0">Make extra <strong>${escapeHtml(recipe?.name || 'food')}</strong> for lunches or another dinner?</p>
      <div class="tile-grid"><button type="button" class="tile" data-action="open-leftovers" data-date="${state.modal.date}"><span class="tile-icon">🟡</span><strong>Add Leftovers</strong><span>Pick servings and nights.</span></button><button type="button" class="tile" data-action="close-modal"><span class="tile-icon">↩</span><strong>No Thanks</strong><span>Cook ${recipe ? baseServings(recipe) : 4} servings.</span></button></div></div>`;
    return modalShell('Plan leftovers?', 'This is the easiest way to stretch one dinner into two nights.', body);
  }

  function openLeftoversSheet(date) {
    const meal = mealForDate(date);
    const recipe = meal ? recipeById(meal.recipe_id) : null;
    if (!meal || meal.type !== 'meal' || !recipe) return;
    const existing = linkedLeftovers(meal).length;
    const fromPrompt = state.modal?.type === 'leftoverPrompt';
    const nights = fromPrompt ? 1 : existing;
    const servings = fromPrompt ? defaultServings(recipe, 1) : plannedServings(meal, recipe);
    const next = { type: 'leftovers', date, nights, servings };
    if (state.modal?.type === 'mealNight') pushModal(next); else resetModals(next);
  }

  function renderLeftoversSheet() {
    const { date, nights, servings } = state.modal;
    const meal = mealForDate(date);
    const recipe = meal ? recipeById(meal.recipe_id) : null;
    if (!meal || !recipe) return '';
    const linked = linkedLeftovers(meal);
    const yieldText = cleanServings(recipe.servings)
      ? `${escapeHtml(recipe.name)} makes ${recipeYield(recipe)} as written${recipe.servings_estimated ? ' (estimated)' : ''}.`
      : `${escapeHtml(recipe.name)} has no servings listed, so Mealz treats it as 4.`;
    const nightTiles = [0, 1, 2, 3].map(n => {
      const days = followingDays(date, n);
      const taken = days.filter(k => { const m = mealForDate(k); return m && m.source_meal_id !== meal.id; });
      const label = n === 0 ? 'Lunch Only' : `${n} ${n === 1 ? 'Night' : 'Nights'}`;
      const sub = n === 0 ? 'No dinners added'
        : `${days.map(k => weekdayName(k, 'short')).join(', ')}${taken.length ? ` · ${taken.map(k => weekdayName(k, 'short')).join(', ')} has a plan` : ''}`;
      return `<button type="button" class="tile ${nights === n ? 'tile-on' : ''}" data-action="leftover-nights" data-nights="${n}"><strong>${label}</strong><span>${escapeHtml(sub)}</span></button>`;
    }).join('');
    const body = `
      <div class="panel leftover-intro"><p>${yieldText} Set how many servings to cook. To plan leftover dinners, pick nights below and the servings go up 4 for each.</p></div>
      <div class="sheet-section">
        <h3>Total servings to cook</h3>
        <div class="stepper">
          <button type="button" class="stepper-btn" data-action="servings-step" data-delta="-2" aria-label="Fewer servings" ${servings <= 4 ? 'disabled' : ''}>−</button>
          <div class="stepper-value"><strong id="servings-value">${servings}</strong><span>servings</span></div>
          <button type="button" class="stepper-btn" data-action="servings-step" data-delta="2" aria-label="More servings" ${servings >= 60 ? 'disabled' : ''}>+</button>
        </div>
        <p class="form-help centered">Never less than 4. Each leftover dinner adds 4. The grocery list buys for ${servings}.</p>
      </div>
      <div class="sheet-section">
        <h3>Leftover dinners</h3>
        <div class="tile-grid">${nightTiles}</div>
      </div>
      <div class="sheet-section note-actions">
        <button type="button" class="btn btn-primary" data-action="save-leftovers">Save</button>
        ${linked.length || hasExtra(meal, recipe) ? '<button type="button" class="btn btn-outline btn-danger-text" data-action="remove-leftovers">Remove Leftovers</button>' : '<button type="button" class="btn btn-outline" data-action="close-modal">Cancel</button>'}
      </div>`;
    return modalShell('Servings and Leftovers', `${weekdayName(date)} · ${recipe.name}`, body);
  }

  function renderRecipeDetailModal() {
    const recipe = recipeById(state.modal.recipeId);
    if (!recipe) return '';
    const total = Number(recipe.prep_minutes || 0) + Number(recipe.cook_minutes || 0);
    const converted = isConverted(recipe);
    const lines = converted ? linesFor(recipe.id) : [];
    const unsure = lines.filter(l => l.unsure).length;
    const course = (COURSES.find(([value]) => value === recipe.course) || [])[1];
    const servingsText = cleanServings(recipe.servings) ? `Serves ${recipe.servings}${recipe.servings_estimated ? ' (estimated)' : ''}` : '';
    const ingredientItems = lines.length
      ? lines.map(l => {
          if (!l.item) return `<li class="ingredient-heading">${escapeHtml(l.raw)}</li>`;
          const amount = window.MealzUnits.formatLineAmount(l.qty, l.unit, state.prefs);
          return `<li class="${l.unsure ? 'unsure' : ''}">${amount ? `<span class="ing-amount">${escapeHtml(amount)}</span> ` : ''}${escapeHtml(l.item)}${l.prep ? `<span class="ing-prep">, ${escapeHtml(l.prep)}</span>` : ''}${l.unsure ? ` <span class="flag" title="Mealz was not sure about this line">⚑</span><span class="ing-raw">Written as: ${escapeHtml(l.raw)}</span>` : ''}</li>`;
        }).join('')
      : (recipe.ingredients || []).map(i => `<li>${escapeHtml(i.amount || '')} ${escapeHtml(i.name || '')}</li>`).join('');
    const needsLook = unsure > 0 || recipe.servings_estimated;
    const lookParts = [
      unsure ? `${unsure} ingredient ${unsure === 1 ? 'line' : 'lines'} marked ⚑` : '',
      recipe.servings_estimated ? 'the servings, which were estimated' : ''
    ].filter(Boolean).join(' and ');
    const reviewBanner = needsLook
      ? `<div class="review-banner"><div><strong>⚑ Quick check</strong><span>Mealz was not sure about ${escapeHtml(lookParts)}. If it looks right, tap Looks Right. To fix it, tap Edit.</span></div><button type="button" class="btn btn-small btn-outline" data-action="looks-right" data-recipe-id="${recipe.id}">Looks Right</button></div>`
      : '';
    const convertingNote = !converted && recipeLineTexts(recipe).length && !conversion.disabled
      ? '<p class="form-help">Mealz is organizing these ingredients for the grocery list.</p>' : '';
    const body = `
      ${reviewBanner}
      <div class="tile-grid">
        <button type="button" class="tile" data-action="cook" data-recipe-id="${recipe.id}"><span class="tile-icon">👨‍🍳</span><strong>Start Cooking</strong></button>
        <button type="button" class="tile" data-action="plan-recipe" data-recipe-id="${recipe.id}"><span class="tile-icon">📅</span><strong>Plan This</strong></button>
      </div>
      <div class="recipe-detail panel" style="margin-top:12px">
        <div class="detail-meta">${[dishTypeOf(recipe), course, recipe.cuisine || 'Dinner', `${total} min`, recipe.difficulty || 'Easy', servingsText].filter(Boolean).map(escapeHtml).join(' · ')}</div>
        <h3>Ingredients</h3><ul class="ingredient-list">${ingredientItems}</ul>${convertingNote}
        <h3>Directions</h3><ol class="step-list">${(recipe.steps || []).map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ol>
        ${recipe.source_url ? `<p class="recipe-source-note">Saved cleanly in Mealz · <a class="source-link" href="${escapeHtml(recipe.source_url)}" target="_blank" rel="noopener">Source ↗</a></p>` : ''}
      </div>
      <div class="sheet-section">
        <h3>Manage</h3>
        <div class="tile-grid tile-grid-3">
          <button type="button" class="tile" data-action="edit-recipe" data-recipe-id="${recipe.id}"><span class="tile-icon">✎</span><strong>Edit</strong></button>
          <button type="button" class="tile" data-action="duplicate-recipe" data-recipe-id="${recipe.id}"><span class="tile-icon">⧉</span><strong>Duplicate</strong></button>
          <button type="button" class="tile tile-danger" data-action="delete-recipe" data-recipe-id="${recipe.id}"><span class="tile-icon">🗑</span><strong>Delete</strong></button>
        </div>
      </div>`;
    return modalShell(recipe.name, recipe.favorite ? '❤️ Favorite' : '', body);
  }

  function renderAddRecipeModal() {
    const mode = state.modal.mode || 'import';
    if (mode === 'import') {
      const body = `<form id="recipe-import-form" class="import-recipe-panel">
        <div class="import-hero"><div class="import-icon">↗</div><div><strong>Paste a recipe link</strong><span>Mealz pulls out the ingredients and directions and leaves the ads, popups, stories, and clutter behind.</span></div></div>
        ${state.modal.error ? `<div class="error-box">${escapeHtml(state.modal.error)}</div>` : ''}
        <div class="form-field"><label>Recipe URL</label><input class="text-input" name="url" type="url" inputmode="url" autocomplete="url" required placeholder="https://www.example.com/recipe" value="${escapeHtml(state.modal.url || '')}" /></div>
        <button class="btn btn-primary btn-wide" type="submit" ${state.modal.importing ? 'disabled' : ''}>${state.modal.importing ? 'Importing…' : 'Import Clean Recipe'}</button>
        <button class="btn btn-outline btn-wide" type="button" data-action="manual-recipe">Enter Recipe Manually</button>
        <p class="form-help centered">The original site is kept only as the recipe source. You cook from the clean copy saved in Mealz.</p>
      </form>`;
      return modalShell('Add Recipe', 'The easy way is a link.', body);
    }

    const editRecipe = mode === 'edit' ? recipeById(state.modal.recipeId) : null;
    const imported = mode === 'review' || mode === 'duplicate' ? (state.modal.imported || {}) : (editRecipe || {});
    const ingredientText = (imported.ingredients || []).map(i => `${i.amount || ''} | ${i.name || ''} | ${i.category || 'Other'}`).join('\n');
    const stepText = (imported.steps || []).join('\n');
    const sourceUrl = imported.source_url || '';
    const sourceHost = (() => { try { return new URL(sourceUrl).hostname.replace(/^www\./, ''); } catch { return ''; } })();
    const dishType = imported.dish_type || dishTypeOf(imported);
    const dishOptions = dishTypeOptions();
    const body = `<form id="recipe-form" class="form-grid">
      ${mode === 'edit' ? `<input type="hidden" name="recipe_id" value="${escapeHtml(editRecipe?.id || '')}" />` : ''}
      ${mode === 'review' ? `<div class="import-success full"><strong>✓ Recipe cleaned up</strong><span>Review it if you want, then save it to Mealz.${sourceHost ? ` Source: ${escapeHtml(sourceHost)}` : ''}</span></div>` : ''}
      ${mode === 'duplicate' ? '<div class="import-success full"><strong>Duplicate recipe</strong><span>Give the copy a name and make any changes before saving.</span></div>' : ''}
      <div class="form-field full"><label>Recipe name</label><input class="text-input" name="name" required placeholder="Greek lemon chicken bowls" value="${escapeHtml(imported.name || '')}" /></div>
      <div class="form-field"><label>Dish type</label><input class="text-input" name="dish_type" list="dish-type-options" placeholder="Chicken" value="${escapeHtml(dishType === 'Other' && !imported.name ? '' : dishType)}" /><datalist id="dish-type-options">${dishOptions.map(type => `<option value="${escapeHtml(type)}"></option>`).join('')}</datalist><div class="form-help">Pick one you've used before or type a new one.</div></div>
      <div class="form-field"><label>Cuisine</label><input class="text-input" name="cuisine" placeholder="Greek" value="${escapeHtml(imported.cuisine || '')}" /></div>
      <div class="form-field"><label>Difficulty</label><select class="select-input" name="difficulty"><option ${imported.difficulty === 'Very Easy' ? 'selected' : ''}>Very Easy</option><option ${!imported.difficulty || imported.difficulty === 'Easy' ? 'selected' : ''}>Easy</option><option ${imported.difficulty === 'Moderate' ? 'selected' : ''}>Moderate</option></select></div>
      <div class="form-field"><label>Prep minutes</label><input class="text-input" name="prep_minutes" type="number" min="0" max="240" value="${escapeHtml(imported.prep_minutes ?? 15)}" /></div>
      <div class="form-field"><label>Cook minutes</label><input class="text-input" name="cook_minutes" type="number" min="0" max="360" value="${escapeHtml(imported.cook_minutes ?? 20)}" /></div>
      <div class="form-field"><label>Servings</label><input class="text-input" name="servings" type="number" inputmode="numeric" min="1" max="200" placeholder="4" value="${escapeHtml(cleanServings(imported.servings) || servingsFromText(imported.yield) || servingsFromTags(imported.tags) || '')}" /><div class="form-help">What the recipe makes as written.</div></div>
      <div class="form-field"><label>Course</label><select class="select-input" name="course">${COURSES.map(([value, label]) => `<option value="${value}" ${(imported.course || 'entree') === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div>
      <div class="form-field full"><label>Ingredients</label><textarea class="textarea-input" name="ingredients" placeholder="2 lb | chicken breast | Meat\n3 | bell peppers | Produce\n2 cups | rice | Pantry">${escapeHtml(ingredientText)}</textarea><div class="form-help">One per line: amount | ingredient | category</div></div>
      <div class="form-field full"><label>Directions</label><textarea class="textarea-input" name="steps" placeholder="Start the rice.\nSlice the chicken and vegetables.\nCook until done.">${escapeHtml(stepText)}</textarea><div class="form-help">One step per line.</div></div>
      ${mode === 'review' && sourceUrl ? `<input type="hidden" name="source_url" value="${escapeHtml(sourceUrl)}" />` : `<div class="form-field full"><label>Recipe source URL (optional)</label><input class="text-input" name="source_url" type="url" placeholder="https://…" value="${escapeHtml(sourceUrl)}" /></div>`}
      <div class="form-field full"><button class="btn btn-primary btn-wide" type="submit">${mode === 'edit' ? 'Save Changes' : 'Save Recipe'}</button></div>
      ${mode === 'review' ? '<div class="form-field full"><button class="btn btn-outline btn-wide" type="button" data-action="import-recipe-mode">Try Another Link</button></div>' : (mode === 'edit' || mode === 'duplicate' ? '' : '<div class="form-field full"><button class="btn btn-outline btn-wide" type="button" data-action="import-recipe-mode">Import From URL Instead</button></div>')}
    </form>`;
    const modalTitle = mode === 'review' ? 'Review Recipe' : mode === 'edit' ? 'Edit Recipe' : mode === 'duplicate' ? 'Duplicate Recipe' : 'Add Recipe';
    const modalSubtitle = mode === 'review' ? 'Mealz found the useful part.' : mode === 'edit' ? 'Change the name or anything else.' : mode === 'duplicate' ? 'Start with a copy, then make it yours.' : 'Keep it simple. You can always improve it after you cook it.';
    return modalShell(modalTitle, modalSubtitle, body);
  }

  function renderChooseDayModal() {
    const recipe = recipeById(state.modal.recipeId);
    const days = Array.from({ length: 7 }, (_, i) => addDays(state.weekStart, i));
    const body = `<div class="pick-list">${days.map(day => {
      const key = dateKey(day);
      const meal = mealForDate(key);
      return `<button type="button" class="pick-row" data-action="choose-day-for-recipe" data-date="${key}"><span><strong>${day.toLocaleDateString(undefined, { weekday: 'long' })}</strong><small>${day.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}${meal ? ` · ${escapeHtml(mealDisplay(meal).name)}` : ' · Open'}</small></span><span class="pick-go">${meal ? 'Replace' : 'Pick'}</span></button>`;
    }).join('')}</div>`;
    return modalShell('Choose a day', recipe?.name || '', body);
  }

  function renderRecommendWeekModal() {
    const picks = getRecommendations().slice(0, 4);
    const body = `<p class="section-subtitle" style="margin-bottom:12px">These are weighted toward short prep, healthy ingredients, lean protein, fresh vegetables, your favorite cuisines, and meals worth eating again tomorrow.</p>
      <div class="recipe-grid">${picks.map(r => renderRecipeTile(r, 'select-plan-recipe', 'data-leftover="false"')).join('')}</div>`;
    return modalShell('Good fits for this week', 'Pick one and then choose the day.', body);
  }

  function getRecommendations() {
    const start = weekKey();
    const end = dateKey(addDays(state.weekStart, 6));
    const planned = new Set(state.meals.filter(m => m.type === 'meal' && m.meal_date >= start && m.meal_date <= end).map(m => m.recipe_id));
    return [...state.recipes].sort((a, b) => recommendationScore(b, planned) - recommendationScore(a, planned));
  }

  function recommendationScore(recipe, planned) {
    let score = 0;
    const total = Number(recipe.prep_minutes || 0) + Number(recipe.cook_minutes || 0);
    if (recipe.rating === 'makeagain') score += 5;
    if (recipe.rating === 'nope') score -= 20;
    if (recipe.favorite) score += 4;
    if (recipe.is_new) score += 3;
    if (Number(recipe.prep_minutes || 0) <= 15) score += 4;
    if (total <= 30) score += 4; else if (total <= 40) score += 2;
    if (['Mexican', 'Greek', 'Peruvian'].includes(recipe.cuisine)) score += 4;
    const tags = new Set(recipe.tags || []);
    ['lean protein', 'fresh vegetables', 'good leftovers', 'quick', 'one pan'].forEach(t => { if (tags.has(t)) score += 2; });
    if (planned.has(recipe.id)) score -= 5;
    return score;
  }

  function recommendationReason(recipe) {
    const total = Number(recipe.prep_minutes || 0) + Number(recipe.cook_minutes || 0);
    if (recipe.is_new && ['Mexican', 'Greek', 'Peruvian'].includes(recipe.cuisine)) return `New ${recipe.cuisine} idea that fits your usual style`;
    if (recipe.is_new) return 'Something new with familiar weeknight effort';
    if (recipe.favorite) return 'A favorite you already trust';
    if (total <= 30) return 'Fast and easy for a busy night';
    return 'Simple, healthy weeknight fit';
  }

  function renderCook() {
    const recipe = recipeById(state.cook.recipeId);
    if (!recipe) { state.cook = null; render(); return; }
    const steps = recipe.steps || [];
    if (state.cook.finished || !steps.length) {
      root.innerHTML = `<div class="app-shell"><main class="cook-shell"><div class="cook-top"><button type="button" class="btn btn-outline" data-action="close-cook">← Back</button><div class="cook-progress">Dinner done</div></div><section class="cook-card rating-panel"><h1 style="margin-top:0">How was it?</h1><p class="section-subtitle">One tap helps Mealz make better suggestions.</p><div class="rating-buttons"><button type="button" class="btn btn-primary" data-action="rate" data-rating="makeagain">👍 Make Again</button><button type="button" class="btn" data-action="rate" data-rating="fine">😐 It Was Fine</button><button type="button" class="btn btn-danger" data-action="rate" data-rating="nope">👎 Skip Next Time</button></div></section></main></div>`;
      return;
    }
    const step = Math.min(state.cook.step, steps.length - 1);
    root.innerHTML = `<div class="app-shell"><main class="cook-shell"><div class="cook-top"><button type="button" class="btn btn-outline" data-action="close-cook">← Exit</button><div class="cook-progress">${escapeHtml(recipe.name)}</div></div><section class="cook-card"><div class="cook-step-number">Step ${step + 1} of ${steps.length}</div><div class="cook-step">${escapeHtml(steps[step])}</div><div class="cook-controls">${step > 0 ? '<button type="button" class="btn btn-outline" data-action="cook-prev">Back</button>' : ''}<button type="button" class="btn btn-primary" style="flex:1" data-action="cook-next">${step === steps.length - 1 ? 'Finish Dinner' : 'Next Step'}</button></div></section></main></div>`;
  }

  async function handleClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.dataset.action;

    try {
      if (action === 'nav') { state.view = button.dataset.view; resetModals(); render(); window.scrollTo(0, 0); return; }
      if (action === 'open-meal') { state.modal = { type: 'mealNight', date: button.dataset.date }; render(); return; }
      if (action === 'save-note') { await saveMealNote(); return; }
      if (action === 'note-to-grocery') { await sendNoteToGrocery(); return; }
      if (action === 'open-leftovers') { openLeftoversSheet(button.dataset.date); render(); return; }
      if (action === 'leftover-nights') {
        const meal = mealForDate(state.modal.date);
        const recipe = meal ? recipeById(meal.recipe_id) : null;
        state.modal.nights = Number(button.dataset.nights) || 0;
        state.modal.servings = defaultServings(recipe, state.modal.nights);
        render(); return;
      }
      if (action === 'servings-step') {
        state.modal.servings = Math.max(4, Math.min(60, state.modal.servings + Number(button.dataset.delta || 0)));
        render(); return;
      }
      if (action === 'save-leftovers') { await saveLeftovers(); return; }
      if (action === 'remove-leftovers') { await removeLeftovers(); return; }
      if (action === 'looks-right') { await markRecipeChecked(button.dataset.recipeId); return; }
      if (action === 'set-pref') { await savePrefs({ [button.dataset.pref]: button.dataset.value }); return; }
      if (action === 'open-filter') { pushModal({ type: 'filter', context: button.dataset.context || 'recipes' }); render(); return; }
      if (action === 'toggle-favorites-filter') { const f = filterFor(button.dataset.context); f.favoritesOnly = !f.favoritesOnly; render(); return; }
      if (action === 'filter-type') {
        const f = filterFor(button.dataset.context); const type = button.dataset.type;
        f.types = f.types.includes(type) ? f.types.filter(t => t !== type) : [...f.types, type];
        render(); return;
      }
      if (action === 'filter-time') { filterFor(button.dataset.context).time = button.dataset.time || 'any'; render(); return; }
      if (action === 'filter-clear') { state.filters[button.dataset.context] = { types: [], time: 'any', favoritesOnly: false }; render(); return; }
      if (action === 'clear-all-groceries') { await clearAllGroceries(); return; }
      if (action === 'toggle-hide-checked') { state.hideChecked = !state.hideChecked; render(); return; }
      if (action === 'previous-week') { state.weekStart = addDays(state.weekStart, -7); render(); return; }
      if (action === 'next-week') { state.weekStart = addDays(state.weekStart, 7); render(); return; }
      if (action === 'plan-date') {
        state.planSearch = '';
        state.filters.plan = { types: [], time: 'any', favoritesOnly: false };
        const next = { type: 'plan', date: button.dataset.date, mode: 'suggested' };
        if (state.modal && state.modal.type === 'mealNight') pushModal(next); else resetModals(next);
        render(); window.scrollTo(0, 0); return;
      }
      if (action === 'close-modal') { popModal(); render(); return; }
      if (action === 'modal-backdrop' && event.target === button) { resetModals(); render(); return; }
      if (action === 'plan-mode') { state.modal.mode = button.dataset.mode; render(); return; }
      if (action === 'set-eatout') { await setEatingOut(); return; }
      if (action === 'clear-day') { await clearDay(state.modal.date); return; }
      if (action === 'select-plan-recipe') { if (state.modal?.type === 'recommendWeek') { state.modal = { type: 'chooseDay', recipeId: button.dataset.recipeId }; render(); } else { await selectPlanRecipe(button.dataset.recipeId, button.dataset.leftover === 'true'); } return; }
      if (action === 'import-recipekeeper-confirm') { await importRecipeKeeperConfirmed(); return; }
      if (action === 'add-recipe') { state.modal = { type: 'addRecipe' }; render(); return; }
      if (action === 'manual-recipe') { state.modal = { type: 'addRecipe', mode: 'manual' }; render(); return; }
      if (action === 'import-recipe-mode') { state.modal = { type: 'addRecipe', mode: 'import' }; render(); return; }
      if (action === 'view-recipe') { pushModal({ type: 'recipeDetail', recipeId: button.dataset.recipeId }); render(); return; }
      if (action === 'edit-recipe') { state.modal = { type: 'addRecipe', mode: 'edit', recipeId: button.dataset.recipeId }; render(); return; }
      if (action === 'duplicate-recipe') { duplicateRecipeDraft(button.dataset.recipeId); return; }
      if (action === 'delete-recipe') { await deleteRecipe(button.dataset.recipeId); return; }
      if (action === 'plan-recipe') { state.modal = { type: 'chooseDay', recipeId: button.dataset.recipeId }; render(); return; }
      if (action === 'choose-day-for-recipe') { await planRecipeOnDate(state.modal.recipeId, button.dataset.date, true); return; }
      if (action === 'toggle-favorite') { await toggleFavorite(button.dataset.recipeId); return; }
      if (action === 'build-grocery') { await buildGroceryList(); state.view = 'grocery'; resetModals(); render(); toast('Grocery list updated'); return; }
      if (action === 'clear-checked') { await store.clearChecked(weekKey()); await reloadData(); render(); return; }
      if (action === 'delete-grocery') { await store.deleteGrocery(button.dataset.id); await reloadData(); render(); return; }
      if (action === 'toggle-grocery' && button.matches('input')) { await toggleGrocery(button.dataset.id, button.checked); return; }
      if (action === 'recommend-week') { state.modal = { type: 'recommendWeek' }; render(); return; }
      if (action === 'cook') { resetModals(); state.cook = { recipeId: button.dataset.recipeId, step: 0, finished: false }; render(); return; }
      if (action === 'cook-prev') { state.cook.step = Math.max(0, state.cook.step - 1); render(); return; }
      if (action === 'cook-next') {
        const recipe = recipeById(state.cook.recipeId);
        if (state.cook.step >= (recipe.steps || []).length - 1) state.cook.finished = true;
        else state.cook.step += 1;
        render(); return;
      }
      if (action === 'close-cook') { state.cook = null; render(); return; }
      if (action === 'rate') { await rateRecipe(button.dataset.rating); return; }
      if (action === 'reset-demo') { if (confirm('Reset Demo Mode and restore the starter recipes?')) { await store.reset(); state.weekStart = startOfWeek(new Date()); await reloadData(); render(); toast('Demo reset'); } return; }
      if (action === 'signout') { if (realtimeChannel) { await sb.removeChannel(realtimeChannel); realtimeChannel = null; } await sb.auth.signOut(); state.user = null; state.member = null; state.members = []; state.authMessage = ''; state.authError = ''; state.authStep = 'password'; renderAuth(); return; }
      if (action === 'signup') { await authAction('signup'); return; }
      if (action === 'email-link' || action === 'resend-link') { await emailSignInLink(); return; }
      if (action === 'use-password') { state.authStep = 'password'; state.authError = ''; state.authMessage = ''; renderAuth(); return; }
    } catch (error) {
      console.error(error);
      toast(error.message || 'Something went wrong');
    }
  }

  function handleInput(event) {
    if (event.target.id === 'recipe-search') {
      state.recipeSearch = event.target.value;
      const list = document.querySelector('.recipe-grid');
      const head = document.querySelector('.list-head');
      if (!list || !head) { render(); return; }
      const recipes = filteredRecipes();
      list.innerHTML = recipeListInner(recipes);
      head.innerHTML = recipeHeadInner(recipes);
      return;
    }
    if (event.target.id === 'plan-search') {
      state.planSearch = event.target.value;
      const list = document.querySelector('.pick-list');
      const head = document.querySelector('.modal .list-head span');
      if (!list) { render(); return; }
      const picks = planPickList();
      if (head) head.textContent = `${picks.length} ${picks.length === 1 ? 'recipe' : 'recipes'}`;
      list.innerHTML = pickListInner(picks, state.modal?.mode || 'suggested');
      return;
    }
    if (event.target.id === 'meal-note' && state.modal) {
      state.modal.noteDraft = event.target.value;
    }
  }

  async function handleChange(event) {
    if (event.target.id !== 'recipekeeper-file') return;
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      toast('Reading Recipe Keeper export…');
      const parsed = await window.MealzRecipeKeeper.readExport(file);
      const existingNames = new Set(state.recipes.map(r => String(r.name || '').trim().toLowerCase()));
      const skipped = [];
      const recipes = [];
      for (const raw of parsed) {
        const nameKey = String(raw.name || '').trim().toLowerCase();
        if (!nameKey || existingNames.has(nameKey)) {
          if (raw.name) skipped.push(raw.name);
          continue;
        }
        existingNames.add(nameKey);
        const dishType = raw.dish_type || dishTypeOf(raw);
        recipes.push({ ...cleanRecipePayload({ ...raw, servings: raw.servings || servingsFromTags(raw.tags) }), tags: withDishTypeTag(raw.tags || [], dishType) });
      }
      state.modal = { type: 'recipeKeeperPreview', recipes, skipped };
      render();
    } catch (error) {
      console.error(error);
      toast(error.message || 'Mealz could not import that Recipe Keeper file.');
    }
  }

  async function importRecipeKeeperConfirmed() {
    const recipes = state.modal?.type === 'recipeKeeperPreview' ? (state.modal.recipes || []) : [];
    if (!recipes.length) return;
    const count = recipes.length;
    resetModals();
    render();
    toast(`Importing ${count} recipes…`);
    await store.saveRecipes(recipes);
    await reloadData();
    state.view = 'recipes';
    state.recipeTypeFilter = 'All';
    render();
    toast(`${count} Recipe Keeper ${count === 1 ? 'recipe' : 'recipes'} imported`);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (event.target.id === 'auth-form') { await authAction('signin'); return; }
    if (event.target.id === 'grocery-form') {
      const fd = new FormData(event.target);
      await store.saveGrocery({
        week_start: weekKey(), name: String(fd.get('name') || '').trim(), amount: '',
        category: String(fd.get('category') || 'Other'), checked: false, manual: true
      });
      await reloadData(); render(); return;
    }
    if (event.target.id === 'recipe-import-form') { await importRecipeUrl(event.target); return; }
    if (event.target.id === 'recipe-form') { await saveNewRecipe(event.target); return; }
  }

  async function authAction(kind) {
    const form = document.getElementById('auth-form');
    if (!form) return;
    const fd = new FormData(form);
    const email = String(fd.get('email') || '').trim();
    const password = String(fd.get('password') || '');
    state.authEmail = email;
    if (!email || password.length < 6) {
      state.authError = 'Enter an email and a password of at least 6 characters.';
      state.authMessage = '';
      renderAuth(); return;
    }
    state.authError = ''; state.authMessage = '';
    if (kind === 'signup') {
      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) { state.authError = error.message; renderAuth(); return; }
      if (!data.session) {
        state.authMessage = 'Account created. Check your email for a confirmation link, then come back and sign in.';
        renderAuth(); return;
      }
      await initializeShared(data.user);
      return;
    }
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) { state.authError = error.message; renderAuth(); return; }
    await initializeShared(data.user);
  }

  // Before a day gets a new plan: if it is a cook night with Leftovers Nights,
  // ask, then clear those nights. Returns false if the person says no.
  async function prepareDateForReplace(date) {
    const current = mealForDate(date);
    if (!current || current.type !== 'meal') return true;
    const linked = linkedLeftovers(current);
    if (!linked.length) return true;
    const days = linked.map(m => weekdayName(m.meal_date)).join(' and ');
    if (!confirm(`${weekdayName(date)} has Leftovers Nights on ${days}. Changing it clears those too. Continue?`)) return false;
    for (const m of linked) await store.deleteMeal(m.meal_date);
    return true;
  }

  // Keeps leftover_days on a cook night equal to the nights linked to it.
  async function syncLeftoverDays(sourceIds) {
    for (const id of new Set(sourceIds.filter(Boolean))) {
      const source = state.meals.find(m => m.id === id);
      if (!source || source.type !== 'meal') continue;
      const count = Math.min(3, linkedLeftovers(source).length);
      if (Number(source.leftover_days || 0) !== count) await store.upsertMeal({ ...source, leftover_days: count });
    }
  }

  async function clearDay(date) {
    const meal = mealForDate(date);
    if (!meal) { resetModals(); render(); return; }
    const linked = meal.type === 'meal' ? linkedLeftovers(meal) : [];
    if (linked.length && !confirm(`Clear ${weekdayName(date)} and its ${linked.length} Leftovers ${linked.length === 1 ? 'Night' : 'Nights'}?`)) return;
    await store.deleteMeal(date);
    await reloadData();
    if (meal.source_meal_id) { await syncLeftoverDays([meal.source_meal_id]); await reloadData(); }
    resetModals(); render(); toast(linked.length ? 'Day and leftovers cleared' : 'Day cleared');
  }

  async function setEatingOut() {
    const date = state.modal.date;
    const previous = mealForDate(date);
    if (!(await prepareDateForReplace(date))) return;
    await store.upsertMeal({ meal_date: date, type: 'eatout', recipe_id: null, label: 'Eating Out' });
    await reloadData();
    if (previous?.source_meal_id) { await syncLeftoverDays([previous.source_meal_id]); await reloadData(); }
    resetModals(); render(); toast('Eating out added');
  }

  async function saveLeftovers() {
    const { date, nights, servings } = state.modal;
    const meal = mealForDate(date);
    const recipe = meal ? recipeById(meal.recipe_id) : null;
    if (!meal || !recipe) return;
    const wanted = followingDays(date, nights);
    const kept = [];
    const otherSources = [];
    for (const key of wanted) {
      const existing = mealForDate(key);
      if (existing && existing.source_meal_id !== meal.id) {
        const what = mealDisplay(existing).name;
        if (!confirm(`${weekdayName(key)} already has ${what}. Replace it with leftovers?`)) continue;
        if (existing.type === 'meal' && linkedLeftovers(existing).length) {
          if (!confirm(`${what} on ${weekdayName(key)} has its own Leftovers Nights. They will be cleared too. Continue?`)) continue;
        }
        if (existing.source_meal_id) otherSources.push(existing.source_meal_id);
        await store.deleteMeal(key);
      }
      kept.push(key);
    }
    for (const old of linkedLeftovers(meal)) {
      if (!kept.includes(old.meal_date)) await store.deleteMeal(old.meal_date);
    }
    await store.upsertMeal({ ...meal, servings, leftover_days: kept.length });
    for (const key of kept) {
      const existing = mealForDate(key);
      await store.upsertMeal({
        meal_date: key, type: 'leftover', recipe_id: recipe.id, label: recipe.name,
        notes: existing?.source_meal_id === meal.id ? existing.notes || '' : '',
        source_meal_id: meal.id
      });
    }
    await reloadData();
    if (otherSources.length) { await syncLeftoverDays(otherSources); await reloadData(); }
    resetModals(); render();
    toast(kept.length ? `Leftovers on ${kept.map(k => weekdayName(k)).join(' and ')} · ${servings} servings` : `Cooking ${servings} servings`);
  }

  async function removeLeftovers() {
    const meal = mealForDate(state.modal.date);
    if (!meal) return;
    for (const old of linkedLeftovers(meal)) await store.deleteMeal(old.meal_date);
    await store.upsertMeal({ ...meal, servings: null, leftover_days: 0 });
    await reloadData(); resetModals(); render(); toast('Leftovers removed');
  }

  async function selectPlanRecipe(recipeId, leftover) {
    const date = state.modal.date;
    state.modalStack = [];
    await planRecipeOnDate(recipeId, date, !leftover, leftover);
  }

  async function planRecipeOnDate(recipeId, date, offerLeftovers = true, leftover = false) {
    const recipe = recipeById(recipeId);
    const previous = mealForDate(date);
    if (!(await prepareDateForReplace(date))) return;
    // Picking "Leftovers" links the day to the most recent cook night of that recipe.
    const source = leftover
      ? state.meals.filter(m => m.type === 'meal' && m.recipe_id === recipeId && m.meal_date < date)
        .sort((a, b) => b.meal_date.localeCompare(a.meal_date))[0]
      : null;
    await store.upsertMeal({
      meal_date: date, type: leftover ? 'leftover' : 'meal', recipe_id: recipeId, label: recipe?.name || '',
      source_meal_id: source?.id || null
    });
    await reloadData();
    const touched = [previous?.source_meal_id, source?.id];
    if (touched.some(Boolean)) { await syncLeftoverDays(touched); await reloadData(); }
    if (offerLeftovers && !leftover) state.modal = { type: 'leftoverPrompt', date, recipeId };
    else resetModals();
    render();
  }

  function currentNoteDraft() {
    const field = document.getElementById('meal-note');
    if (field) return field.value;
    return String(state.modal?.noteDraft || '');
  }

  async function saveMealNote() {
    const key = state.modal?.date;
    const meal = key ? mealForDate(key) : null;
    if (!meal) return;
    const notes = currentNoteDraft().trim();
    meal.notes = notes;
    state.modal.noteDraft = notes;
    render();
    await store.upsertMeal({ ...meal, notes });
    await reloadData();
    render();
    toast(notes ? 'Note saved' : 'Note cleared');
  }

  async function sendNoteToGrocery() {
    const note = currentNoteDraft().trim();
    if (!note) { toast('Write a note first'); return; }
    await store.saveGrocery({
      week_start: weekKey(), name: note, amount: '', category: 'Other', checked: false, manual: true
    });
    await reloadData();
    render();
    toast('Added to the grocery list');
  }

  async function toggleFavorite(recipeId) {
    const recipe = recipeById(recipeId);
    if (!recipe) return;
    recipe.favorite = !recipe.favorite;
    render();
    await store.saveRecipe({ ...recipe });
  }

  async function importRecipeUrl(form) {
    const fd = new FormData(form);
    const url = String(fd.get('url') || '').trim();
    if (!url) return;
    state.modal = { type: 'addRecipe', mode: 'import', importing: true, url };
    render();
    try {
      const response = await fetch('/api/import-recipe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.recipe) throw new Error(data.error || 'Mealz could not read a clean recipe from that page.');
      state.modal = { type: 'addRecipe', mode: 'review', imported: data.recipe };
      render();
    } catch (error) {
      const localHint = location.protocol === 'file:' ? ' URL import works after Mealz is deployed to Vercel.' : '';
      state.modal = { type: 'addRecipe', mode: 'import', importing: false, url, error: `${error.message || 'Unable to import recipe.'}${localHint}` };
      render();
    }
  }

  async function saveNewRecipe(form) {
    const fd = new FormData(form);
    const ingredients = String(fd.get('ingredients') || '').split('\n').map(s => s.trim()).filter(Boolean).map(line => {
      const [amount = '', name = '', category = 'Other'] = line.split('|').map(s => s.trim());
      return { amount, name: name || amount, category: normalizeCategory(category) };
    });
    const steps = String(fd.get('steps') || '').split('\n').map(s => s.trim()).filter(Boolean);
    const recipeId = String(fd.get('recipe_id') || '').trim();
    const existing = recipeId ? recipeById(recipeId) : null;
    const prep = clampNumber(fd.get('prep_minutes'), 0, 240);
    const cook = clampNumber(fd.get('cook_minutes'), 0, 360);
    const dishType = String(fd.get('dish_type') || '').trim() || dishTypeOf(existing || state.modal?.imported || {});
    const servings = cleanServings(fd.get('servings'));
    const servingsEstimated = Boolean(existing?.servings_estimated) && servings === cleanServings(existing?.servings);
    const retainedTags = existing?.tags || state.modal?.imported?.tags || [];
    const recipe = {
      ...(existing || {}),
      ...(recipeId ? { id: recipeId } : {}),
      name: String(fd.get('name') || '').trim(), cuisine: String(fd.get('cuisine') || '').trim(),
      prep_minutes: prep, cook_minutes: cook,
      difficulty: String(fd.get('difficulty') || 'Easy'),
      favorite: existing?.favorite || false,
      rating: existing?.rating || '',
      is_new: existing ? existing.is_new : true,
      tags: withDishTypeTag([...new Set([...retainedTags.filter(tag => !/^dish:/i.test(String(tag)) && !['lean protein', 'fresh vegetables', 'quick'].includes(String(tag).toLowerCase())), ...inferTags(String(fd.get('ingredients') || ''), prep, cook)])], dishType),
      ingredients, steps, source_url: String(fd.get('source_url') || '').trim(),
      servings, servings_estimated: servingsEstimated,
      course: String(fd.get('course') || '') || null
    };
    if (!recipe.name) return;
    const saved = await store.saveRecipe(recipe);
    state.modal = { type: 'recipeDetail', recipeId: saved.id };
    await reloadData();
    render();
    toast(existing ? 'Recipe updated' : 'Recipe saved');
  }

  function duplicateRecipeDraft(recipeId) {
    const recipe = recipeById(recipeId);
    if (!recipe) return;
    const copy = {
      ...recipe,
      id: undefined,
      created_at: undefined,
      name: `${recipe.name} Copy`,
      favorite: false,
      rating: '',
      is_new: true,
      ingredients: (recipe.ingredients || []).map(i => ({ ...i })),
      ingredients_hash: null,
      needs_review: false,
      steps: [...(recipe.steps || [])],
      tags: [...(recipe.tags || [])]
    };
    state.modal = { type: 'addRecipe', mode: 'duplicate', imported: copy };
    render();
  }

  function affectedWeekStarts(recipeId) {
    return [...new Set(state.meals.filter(m => m.recipe_id === recipeId).map(m => dateKey(startOfWeek(parseLocalDate(m.meal_date)))) )];
  }

  async function deleteRecipe(recipeId) {
    const recipe = recipeById(recipeId);
    if (!recipe) return;
    const plannedCount = state.meals.filter(m => m.recipe_id === recipeId).length;
    const message = plannedCount
      ? `Delete “${recipe.name}”? It is planned on ${plannedCount} calendar ${plannedCount === 1 ? 'day' : 'days'}, and those meal plans will also be removed.`
      : `Delete “${recipe.name}”? This cannot be undone.`;
    if (!confirm(message)) return;
    const weeks = affectedWeekStarts(recipeId);
    await store.deleteRecipe(recipeId);
    await reloadData();
    for (const weekStart of weeks) await buildGroceryListForWeek(weekStart);
    resetModals();
    render();
    toast('Recipe deleted');
  }

  function inferTags(text, prep, cook) {
    const tags = [];
    const lower = text.toLowerCase();
    if (/chicken|turkey|sirloin|fish/.test(lower)) tags.push('lean protein');
    if (/pepper|tomato|cucumber|onion|broccoli|zucchini|cilantro|avocado/.test(lower)) tags.push('fresh vegetables');
    if (prep <= 15 && prep + cook <= 35) tags.push('quick');
    return tags;
  }

  function clampNumber(value, min, max) {
    const n = Number(value);
    return Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));
  }

  function normalizeCategory(value) {
    const allowed = ['Produce', 'Meat', 'Dairy', 'Bakery', 'Pantry', 'Frozen', 'Other'];
    const match = allowed.find(c => c.toLowerCase() === String(value).toLowerCase());
    return match || 'Other';
  }

  async function buildGroceryList() {
    await buildGroceryListForWeek(weekKey());
  }

  // Cook nights only, each scaled from the recipe's yield to the servings planned.
  // Leftovers Nights buy nothing. Amounts are added up with unit conversion.
  function groceryItemsForWeek(start) {
    const U = window.MealzUnits;
    const end = dateKey(addDays(parseLocalDate(start), 6));
    const cookNights = state.meals.filter(m => m.meal_date >= start && m.meal_date <= end && m.type === 'meal' && m.recipe_id);
    const map = new Map();
    const entryFor = (name, category) => {
      const key = name.toLowerCase();
      if (!map.has(key)) map.set(key, { name, category, measure: U.emptyMeasure(), texts: [], structured: false });
      return map.get(key);
    };

    cookNights.forEach(meal => {
      const recipe = recipeById(meal.recipe_id);
      if (!recipe) return;
      const factor = plannedServings(meal, recipe) / recipeYield(recipe);
      const lines = isConverted(recipe) ? linesFor(recipe.id) : [];
      if (lines.length) {
        lines.forEach(line => {
          const name = String(line.item || '').trim();
          if (!name) return;
          const entry = entryFor(name, normalizeCategory(line.category));
          entry.structured = true;
          U.addToMeasure(entry.measure, line.qty == null ? null : Number(line.qty) * factor, line.unit);
        });
        return;
      }
      // Not converted yet: fall back to the original text, noting the scale.
      (recipe.ingredients || []).forEach(ingredient => {
        const name = String(ingredient.name || '').trim();
        if (!name) return;
        const entry = entryFor(name, normalizeCategory(ingredient.category));
        const amount = String(ingredient.amount || '').trim();
        const scale = Math.abs(factor - 1) > 0.01 ? ` (${U.formatNumber(factor, state.prefs.numbers)}x)` : '';
        if (amount) entry.texts.push(`${amount}${scale}`);
      });
    });

    return [...map.values()].map(entry => {
      const measure = entry.structured && !U.isEmptyMeasure(entry.measure) ? entry.measure : null;
      const parts = [measure ? U.formatMeasure(measure, state.prefs) : '', ...entry.texts].filter(Boolean);
      return { name: entry.name, category: entry.category, measure, amount: parts.join(' + ') };
    });
  }

  function groceryAmount(item) {
    if (!item.measure) return item.amount || '';
    const extra = String(item.amount || '').split(' + ').slice(1).join(' + ');
    const main = window.MealzUnits.formatMeasure(item.measure, state.prefs);
    return [main, extra].filter(Boolean).join(' + ');
  }

  async function buildGroceryListForWeek(start) {
    const existing = state.groceries.filter(g => g.week_start === start);
    const checkedByName = new Map(existing.map(i => [String(i.name).toLowerCase(), i.checked]));
    const generated = groceryItemsForWeek(start).map(item => ({
      week_start: start,
      name: item.name,
      amount: item.amount,
      measure: item.measure,
      category: item.category,
      checked: checkedByName.get(item.name.toLowerCase()) || false,
      manual: false
    }));
    await store.replaceAutoGroceries(start, generated);
    await reloadData();
  }

  async function toggleGrocery(id, checked) {
    const item = state.groceries.find(g => g.id === id);
    if (!item) return;
    item.checked = checked;
    render();
    await store.saveGrocery({ ...item, checked });
  }

  async function clearAllGroceries() {
    const items = currentWeekGroceries();
    if (!items.length) return;
    if (!confirm(`Clear all ${items.length} items from this week's grocery list? This cannot be undone.`)) return;
    await store.clearWeek(weekKey());
    await reloadData();
    render();
    toast('Grocery list cleared');
  }

  async function rateRecipe(rating) {
    const recipe = recipeById(state.cook.recipeId);
    if (recipe) await store.saveRecipe({ ...recipe, rating, is_new: false });
    await reloadData(); state.cook = null; render(); toast('Saved — recommendations will learn from that');
  }

  function toast(message) {
    document.querySelector('.toast')?.remove();
    const el = document.createElement('div');
    el.className = 'toast'; el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  start().catch(error => {
    console.error(error);
    root.innerHTML = `<main class="auth-shell"><section class="auth-card"><h1>Mealz</h1><div class="error-box">${escapeHtml(error.message || 'Unable to start Mealz.')}</div></section></main>`;
  });
})();
