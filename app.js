(() => {
  'use strict';

  const root = document.getElementById('app');
  const config = window.WEEKNIGHT_CONFIG || {};
  const sharedMode = Boolean(config.supabaseUrl && config.supabasePublishableKey && window.supabase);
  const sb = sharedMode
    ? window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey)
    : null;

  const state = {
    view: 'week',
    weekStart: startOfWeek(new Date()),
    recipes: [],
    meals: [],
    groceries: [],
    user: null,
    modal: null,
    recipeSearch: '',
    cook: null,
    authMessage: '',
    authError: '',
    loading: true
  };

  let store;
  let realtimeChannel = null;
  let reloadTimer = null;

  function uid() {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
    return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
      this.prefix = 'weeknight-v1-';
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
        groceries: this.read('groceries')
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
    async upsertMeal(meal) {
      const meals = this.read('meals');
      const index = meals.findIndex(m => m.meal_date === meal.meal_date);
      const next = { ...meal, id: index >= 0 ? meals[index].id : uid() };
      if (index >= 0) meals[index] = next; else meals.push(next);
      this.write('meals', meals);
      return next;
    }
    async deleteMeal(mealDate) {
      this.write('meals', this.read('meals').filter(m => m.meal_date !== mealDate));
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
    async reset() {
      ['recipes', 'meals', 'groceries'].forEach(k => localStorage.removeItem(this.prefix + k));
      await this.initialize();
    }
  }

  class SupabaseStore {
    constructor(client, user) {
      this.client = client;
      this.user = user;
    }
    async initialize() {
      const { data, error } = await this.client.from('recipes').select('id').limit(1);
      if (error) throw error;
      if (!data.length) {
        const rows = sampleRecipes().map(r => ({ ...r, user_id: this.user.id }));
        const { error: insertError } = await this.client.from('recipes').insert(rows);
        if (insertError) throw insertError;
      }
    }
    async loadAll() {
      const [recipesRes, mealsRes, groceriesRes] = await Promise.all([
        this.client.from('recipes').select('*').order('created_at', { ascending: true }),
        this.client.from('weekly_meals').select('*').order('meal_date', { ascending: true }),
        this.client.from('grocery_items').select('*').order('created_at', { ascending: true })
      ]);
      const error = recipesRes.error || mealsRes.error || groceriesRes.error;
      if (error) throw error;
      return { recipes: recipesRes.data, meals: mealsRes.data, groceries: groceriesRes.data };
    }
    async saveRecipe(recipe) {
      const payload = { ...recipe, user_id: this.user.id };
      delete payload.created_at;
      if (recipe.id) {
        const { data, error } = await this.client.from('recipes').update(payload).eq('id', recipe.id).select().single();
        if (error) throw error;
        return data;
      }
      delete payload.id;
      const { data, error } = await this.client.from('recipes').insert(payload).select().single();
      if (error) throw error;
      return data;
    }
    async upsertMeal(meal) {
      const payload = { ...meal, user_id: this.user.id };
      delete payload.id;
      const { data, error } = await this.client.from('weekly_meals')
        .upsert(payload, { onConflict: 'user_id,meal_date' }).select().single();
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
        const rows = generated.map(g => ({ ...g, user_id: this.user.id }));
        const { error } = await this.client.from('grocery_items').insert(rows);
        if (error) throw error;
      }
    }
    async saveGrocery(item) {
      const payload = { ...item, user_id: this.user.id };
      delete payload.created_at;
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
  }

  async function start() {
    root.addEventListener('click', handleClick);
    root.addEventListener('input', handleInput);
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

  async function initializeShared(user) {
    state.user = user;
    store = new SupabaseStore(sb, user);
    try {
      await store.initialize();
      await reloadData();
      startRealtime(user.id);
      state.loading = false;
      render();
    } catch (error) {
      state.loading = false;
      state.authError = `Shared setup needs attention: ${error.message}`;
      renderAuth(true);
    }
  }

  function startRealtime(userId) {
    if (!sb || realtimeChannel) return;
    realtimeChannel = sb.channel(`weeknight-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'recipes', filter: `user_id=eq.${userId}` }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'weekly_meals', filter: `user_id=eq.${userId}` }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'grocery_items', filter: `user_id=eq.${userId}` }, scheduleReload)
      .subscribe();
  }

  function scheduleReload() {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(async () => {
      await reloadData();
      render();
    }, 250);
  }

  async function reloadData() {
    if (!store) return;
    const data = await store.loadAll();
    state.recipes = data.recipes || [];
    state.meals = data.meals || [];
    state.groceries = data.groceries || [];
  }

  function renderAuth(setupError = false) {
    root.innerHTML = `
      <main class="auth-shell">
        <section class="auth-card">
          <div class="auth-logo">🍽</div>
          <h1>Weeknight</h1>
          <p>One shared login for the two of you. Sign in with the same account on both phones and your week, recipes, and grocery list stay together.</p>
          ${setupError ? `<div class="error-box">${escapeHtml(state.authError)}</div>` : ''}
          ${state.authError && !setupError ? `<div class="error-box">${escapeHtml(state.authError)}</div>` : ''}
          ${state.authMessage ? `<div class="success-box">${escapeHtml(state.authMessage)}</div>` : ''}
          <form id="auth-form" class="auth-form">
            <input class="text-input" name="email" type="email" autocomplete="email" placeholder="Email" required />
            <input class="text-input" name="password" type="password" autocomplete="current-password" placeholder="Password" minlength="6" required />
            <div class="auth-actions">
              <button class="btn btn-primary btn-wide" type="submit" data-auth-action="signin">Sign In</button>
              <button class="btn btn-outline btn-wide" type="button" data-action="signup">Create Shared Account</button>
            </div>
          </form>
          <p style="font-size:12px;margin-bottom:0">Use one household email/password on both devices. You can change this to separate profiles later if you ever want them.</p>
        </section>
      </main>`;
  }

  function render() {
    if (state.loading) {
      root.innerHTML = `<main class="auth-shell"><div class="auth-card"><strong>Loading Weeknight…</strong></div></main>`;
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
            <div><div class="brand">Weeknight</div><div class="subbrand">Plan less. Eat well.</div></div>
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
    if (meal.type === 'leftover') return { name: `Leftovers: ${name}`, meta: 'Easy night' };
    const total = Number(recipe?.prep_minutes || 0) + Number(recipe?.cook_minutes || 0);
    return { name, meta: `${total || '?'} min · ${recipe?.difficulty || 'Easy'}` };
  }

  function renderWeek() {
    const today = new Date();
    const todayKey = dateKey(today);
    const tonightMeal = mealForDate(todayKey);
    const tonight = mealDisplay(tonightMeal);
    const tonightRecipe = tonightMeal?.recipe_id ? recipeById(tonightMeal.recipe_id) : null;
    const days = Array.from({ length: 7 }, (_, i) => addDays(state.weekStart, i));

    const todayCard = tonightMeal
      ? `<section class="today-card">
          <div><div class="today-kicker">Tonight</div><div class="today-name">${escapeHtml(tonight.name)}</div><div class="today-meta">${escapeHtml(tonight.meta)}</div></div>
          ${tonightRecipe ? `<button type="button" class="btn btn-light" data-action="cook" data-recipe-id="${tonightRecipe.id}">COOK DINNER</button>` : `<button type="button" class="btn btn-light" data-action="plan-date" data-date="${todayKey}">CHANGE PLAN</button>`}
        </section>`
      : `<section class="today-card">
          <div><div class="today-kicker">Tonight</div><div class="today-name">Nothing planned yet</div><div class="today-meta">Pick something easy and get it off your mind.</div></div>
          <button type="button" class="btn btn-light" data-action="plan-date" data-date="${todayKey}">PLAN TONIGHT</button>
        </section>`;

    return `
      ${todayCard}
      <section class="week-panel">
        <div class="week-toolbar">
          <button type="button" class="icon-btn" data-action="previous-week" aria-label="Previous week">‹</button>
          <div class="week-label"><strong>${weekTitle()}</strong><span>${formatWeekRange(state.weekStart)}</span></div>
          <button type="button" class="icon-btn" data-action="next-week" aria-label="Next week">›</button>
        </div>
        <div class="legend" aria-label="Calendar color key">
          <span class="legend-item"><i class="legend-dot dot-meal"></i> Planned</span>
          <span class="legend-item"><i class="legend-dot dot-quick"></i> Quick</span>
          <span class="legend-item"><i class="legend-dot dot-leftover"></i> Leftovers</span>
          <span class="legend-item"><i class="legend-dot dot-new"></i> New</span>
          <span class="legend-item"><i class="legend-dot dot-open"></i> Open</span>
        </div>
        <div class="week-grid">
          ${days.map(day => renderDay(day, sameDay(day, today))).join('')}
        </div>
      </section>
      <section class="quick-row">
        <button type="button" class="action-card" data-action="build-grocery"><strong>🛒 Build Grocery List</strong><span>Pull ingredients from this week's planned meals.</span></button>
        <button type="button" class="action-card" data-action="recommend-week"><strong>✨ Help Me Pick</strong><span>Show quick, healthy meals that fit how you actually cook.</span></button>
      </section>`;
  }

  function renderDay(day, isToday) {
    const key = dateKey(day);
    const meal = mealForDate(key);
    const recipe = meal?.recipe_id ? recipeById(meal.recipe_id) : null;
    const display = mealDisplay(meal);
    const type = mealClass(meal, recipe);
    return `<article class="day-card ${isToday ? 'today' : ''}">
      <div class="day-head"><span class="day-name">${day.toLocaleDateString(undefined, { weekday: 'short' })}</span><span class="day-date">${day.getDate()}</span></div>
      ${meal
        ? `<div class="day-meal type-${type}"><div class="meal-name">${escapeHtml(display.name)}</div><div class="meal-meta">${escapeHtml(display.meta)}</div>${recipe?.is_new && meal.type === 'meal' ? '<div class="meal-meta">✨ New recipe</div>' : ''}</div>
           <button type="button" class="edit-link" data-action="plan-date" data-date="${key}">Change</button>`
        : `<div class="day-empty">Open</div><button type="button" class="plan-button" data-action="plan-date" data-date="${key}">+ Plan</button>`}
    </article>`;
  }

  function renderRecipes() {
    const q = state.recipeSearch.trim().toLowerCase();
    const recipes = state.recipes.filter(r => !q || [r.name, r.cuisine, ...(r.tags || [])].join(' ').toLowerCase().includes(q));
    return `
      <section class="panel">
        <div class="toolbar">
          <div><h2 class="section-title">Recipes</h2><p class="section-subtitle">Your shared weeknight playbook.</p></div>
          <button type="button" class="btn btn-primary" data-action="add-recipe">+ Add Recipe</button>
        </div>
        <div class="toolbar" style="margin-top:14px"><div class="search-wrap"><input id="recipe-search" class="search-input" type="search" placeholder="Search recipes or cuisine" value="${escapeHtml(state.recipeSearch)}" /></div></div>
      </section>
      <section class="recipe-grid">
        ${recipes.length ? recipes.map(renderRecipeCard).join('') : '<div class="panel empty-state"><strong>No recipes found.</strong>Try another search or add one.</div>'}
      </section>`;
  }

  function renderRecipeCard(recipe) {
    const total = Number(recipe.prep_minutes || 0) + Number(recipe.cook_minutes || 0);
    return `<article class="recipe-card">
      <div class="recipe-card-top"><div><div class="recipe-name">${escapeHtml(recipe.name)}</div><div class="recipe-meta">${escapeHtml(recipe.cuisine || 'Weeknight')} · ${total} min · ${escapeHtml(recipe.difficulty || 'Easy')}</div></div>
      <button type="button" class="favorite-btn" data-action="toggle-favorite" data-recipe-id="${recipe.id}" aria-label="Toggle favorite">${recipe.favorite ? '❤️' : '♡'}</button></div>
      <div class="recipe-tags">${(recipe.tags || []).slice(0, 3).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}${recipe.is_new ? '<span class="tag">✨ New</span>' : ''}</div>
      <div class="recipe-actions"><button type="button" class="btn btn-outline btn-small" data-action="view-recipe" data-recipe-id="${recipe.id}">View</button><button type="button" class="btn btn-primary btn-small" data-action="plan-recipe" data-recipe-id="${recipe.id}">Plan</button></div>
    </article>`;
  }

  function currentWeekGroceries() {
    return state.groceries.filter(g => g.week_start === weekKey());
  }

  function renderGrocery() {
    const items = currentWeekGroceries();
    const categories = ['Produce', 'Meat', 'Dairy', 'Bakery', 'Pantry', 'Frozen', 'Other'];
    return `<section class="panel">
      <div class="grocery-head">
        <div><h2 class="section-title">Grocery List</h2><p class="section-subtitle">${formatWeekRange(state.weekStart)} · shared and editable</p></div>
        <div class="week-actions"><button type="button" class="btn btn-outline btn-small" data-action="build-grocery">Rebuild from Meals</button>${items.some(i => i.checked) ? '<button type="button" class="btn btn-small" data-action="clear-checked">Clear Checked</button>' : ''}</div>
      </div>
      <form id="grocery-form" class="grocery-add">
        <input class="text-input" name="name" placeholder="Add milk, fruit, snacks…" required />
        <select class="select-input" name="category">${categories.map(c => `<option>${c}</option>`).join('')}</select>
        <button class="btn btn-primary" type="submit">Add</button>
      </form>
    </section>
    <section class="panel">
      ${items.length ? categories.map(cat => renderGroceryCategory(cat, items.filter(i => (i.category || 'Other') === cat))).join('') : '<div class="empty-state"><strong>Your list is empty.</strong>Plan meals, then tap “Build Grocery List.” You can also add anything manually.</div>'}
    </section>`;
  }

  function renderGroceryCategory(category, items) {
    if (!items.length) return '';
    const sorted = [...items].sort((a, b) => Number(a.checked) - Number(b.checked));
    return `<div class="grocery-category"><h3>${escapeHtml(category)}</h3><div class="grocery-list">
      ${sorted.map(item => `<label class="grocery-item ${item.checked ? 'checked' : ''}">
        <input type="checkbox" data-action="toggle-grocery" data-id="${item.id}" ${item.checked ? 'checked' : ''} />
        <span><span class="grocery-name">${escapeHtml(item.name)}</span>${item.amount ? `<span class="grocery-amount"> · ${escapeHtml(item.amount)}</span>` : ''}${item.manual ? '<span class="grocery-amount"> · added manually</span>' : ''}</span>
        <button type="button" class="delete-item" data-action="delete-grocery" data-id="${item.id}" aria-label="Delete item">×</button>
      </label>`).join('')}
    </div></div>`;
  }

  function renderMore() {
    return `<section class="panel">
      <h2 class="section-title">More</h2><p class="section-subtitle">Keep the settings out of the way.</p>
      <div class="more-list" style="margin-top:14px">
        <div class="more-row"><div><strong>${sharedMode ? 'Shared Household' : 'Demo Mode'}</strong><span>${sharedMode ? escapeHtml(state.user?.email || 'Signed in') : 'Data is currently saved only on this device.'}</span></div><span>${sharedMode ? '☁' : '◉'}</span></div>
        <div class="more-row"><div><strong>Recipe style</strong><span>Fast prep · healthy · lean protein · fresh vegetables · simple.</span></div><span>✓</span></div>
        <div class="more-row"><div><strong>Favorite flavors</strong><span>Mexican · Greek · Peruvian · similar weeknight meals.</span></div><span>✓</span></div>
        ${sharedMode ? '<div class="more-row"><div><strong>Account</strong><span>Use the same login on both phones.</span></div><button type="button" class="btn btn-outline btn-small" data-action="signout">Sign Out</button></div>' : '<div class="more-row"><div><strong>Reset demo</strong><span>Restore the sample recipes and clear local planning data.</span></div><button type="button" class="btn btn-outline btn-small" data-action="reset-demo">Reset</button></div>'}
      </div>
    </section>
    <section class="panel"><h3 style="margin-top:0">Next upgrades</h3><p class="section-subtitle">Recipe Keeper import, internet recipe discovery/sourcing, prep-ahead mode, and smarter “similar but new” suggestions are deliberately left for the next pass so the first version stays simple.</p></section>`;
  }

  function renderModal() {
    if (state.modal.type === 'plan') return renderPlanModal();
    if (state.modal.type === 'leftoverPrompt') return renderLeftoverPrompt();
    if (state.modal.type === 'recipeDetail') return renderRecipeDetailModal();
    if (state.modal.type === 'addRecipe') return renderAddRecipeModal();
    if (state.modal.type === 'chooseDay') return renderChooseDayModal();
    if (state.modal.type === 'recommendWeek') return renderRecommendWeekModal();
    return '';
  }

  function modalShell(title, subtitle, body) {
    return `<div class="modal-backdrop" data-action="modal-backdrop"><section class="modal" role="dialog" aria-modal="true">
      <div class="modal-head"><div><h2 class="modal-title">${escapeHtml(title)}</h2>${subtitle ? `<div class="modal-subtitle">${escapeHtml(subtitle)}</div>` : ''}</div><button type="button" class="close-btn" data-action="close-modal" aria-label="Close">×</button></div>
      ${body}
    </section></div>`;
  }

  function renderPlanModal() {
    const key = state.modal.date;
    const date = parseLocalDate(key);
    const current = mealForDate(key);
    const mode = state.modal.mode || 'recommend';
    let list = [];
    let listHtml = '';
    if (mode === 'favorite') list = state.recipes.filter(r => r.favorite);
    if (mode === 'all') list = [...state.recipes].sort((a, b) => a.name.localeCompare(b.name));
    if (mode === 'recommend') list = getRecommendations();
    if (mode === 'leftover') {
      const earlier = state.meals
        .filter(m => m.type === 'meal' && m.meal_date < key && m.meal_date >= weekKey() && m.recipe_id)
        .map(m => recipeById(m.recipe_id)).filter(Boolean);
      list = [...new Map(earlier.map(r => [r.id, r])).values()].reverse();
    }
    if (['favorite', 'all', 'recommend', 'leftover'].includes(mode)) {
      listHtml = `<div class="recommend-list">${list.length ? list.map(r => renderPlanRecipeRow(r, mode === 'leftover')).join('') : '<div class="empty-state"><strong>Nothing here yet.</strong>Choose another option.</div>'}</div>`;
    }
    const body = `
      <div class="choice-grid">
        <button type="button" class="choice-btn" data-action="plan-mode" data-mode="recommend"><strong>✨ Recommend</strong><span>Quick, healthy meals that fit your style.</span></button>
        <button type="button" class="choice-btn" data-action="plan-mode" data-mode="favorite"><strong>❤️ Favorites</strong><span>Meals you already trust.</span></button>
        <button type="button" class="choice-btn" data-action="plan-mode" data-mode="all"><strong>🍽 All Recipes</strong><span>Pick anything in your recipe keeper.</span></button>
        <button type="button" class="choice-btn" data-action="plan-mode" data-mode="leftover"><strong>🟡 Leftovers</strong><span>Use a meal already planned earlier this week.</span></button>
        <button type="button" class="choice-btn" data-action="set-eatout"><strong>🥡 Eating Out</strong><span>Mark the night handled.</span></button>
        ${current ? '<button type="button" class="choice-btn" data-action="clear-day"><strong>× Clear Day</strong><span>Remove the current plan.</span></button>' : '<button type="button" class="choice-btn" data-action="add-recipe"><strong>＋ Add Recipe</strong><span>Save something new first.</span></button>'}
      </div>${listHtml}`;
    return modalShell(`Plan ${date.toLocaleDateString(undefined, { weekday: 'long' })}`, date.toLocaleDateString(undefined, { month: 'long', day: 'numeric' }), body);
  }

  function renderPlanRecipeRow(recipe, leftover = false) {
    const total = Number(recipe.prep_minutes || 0) + Number(recipe.cook_minutes || 0);
    const reason = leftover ? 'Already planned this week' : recommendationReason(recipe);
    return `<div class="recommend-row"><div><strong>${escapeHtml(recipe.name)}</strong><small>${escapeHtml(reason)} · ${total} min</small></div><button type="button" class="btn btn-primary btn-small" data-action="select-plan-recipe" data-recipe-id="${recipe.id}" data-leftover="${leftover ? 'true' : 'false'}">${leftover ? 'Use' : 'Pick'}</button></div>`;
  }

  function renderLeftoverPrompt() {
    const recipe = recipeById(state.modal.recipeId);
    const next = addDays(parseLocalDate(state.modal.date), 1);
    const nextKey = dateKey(next);
    const nextMeal = mealForDate(nextKey);
    const body = `<div class="panel" style="background:white"><p style="margin-top:0">Make enough <strong>${escapeHtml(recipe?.name || 'food')}</strong> for tomorrow too?</p>
      <div class="choice-grid"><button type="button" class="choice-btn" data-action="add-leftover-next" ${nextMeal ? 'disabled' : ''}><strong>🟡 Yes — ${next.toLocaleDateString(undefined, { weekday: 'long' })}</strong><span>${nextMeal ? 'That day already has a plan.' : 'One tap and tomorrow becomes leftovers.'}</span></button><button type="button" class="choice-btn" data-action="close-modal"><strong>No Thanks</strong><span>Keep only the meal you just planned.</span></button></div></div>`;
    return modalShell('Plan leftovers?', 'This is the easiest way to stretch one dinner into two nights.', body);
  }

  function renderRecipeDetailModal() {
    const recipe = recipeById(state.modal.recipeId);
    if (!recipe) return '';
    const total = Number(recipe.prep_minutes || 0) + Number(recipe.cook_minutes || 0);
    const body = `<div class="recipe-detail panel" style="background:white">
      <div class="recipe-meta">${escapeHtml(recipe.cuisine || 'Weeknight')} · ${total} min · ${escapeHtml(recipe.difficulty || 'Easy')}</div>
      <h3>Ingredients</h3><ul class="ingredient-list">${(recipe.ingredients || []).map(i => `<li>${escapeHtml(i.amount || '')} ${escapeHtml(i.name || '')}</li>`).join('')}</ul>
      <h3>Directions</h3><ol class="step-list">${(recipe.steps || []).map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ol>
      ${recipe.source_url ? `<p><a class="source-link" href="${escapeHtml(recipe.source_url)}" target="_blank" rel="noopener">Original source ↗</a></p>` : ''}
      <div class="recipe-actions" style="margin-top:18px"><button type="button" class="btn btn-primary" data-action="cook" data-recipe-id="${recipe.id}">Start Cooking</button><button type="button" class="btn btn-outline" data-action="plan-recipe" data-recipe-id="${recipe.id}">Plan This</button></div>
    </div>`;
    return modalShell(recipe.name, recipe.favorite ? '❤️ Favorite' : '', body);
  }

  function renderAddRecipeModal() {
    const body = `<form id="recipe-form" class="form-grid">
      <div class="form-field full"><label>Recipe name</label><input class="text-input" name="name" required placeholder="Greek lemon chicken bowls" /></div>
      <div class="form-field"><label>Cuisine</label><input class="text-input" name="cuisine" placeholder="Greek" /></div>
      <div class="form-field"><label>Difficulty</label><select class="select-input" name="difficulty"><option>Very Easy</option><option selected>Easy</option><option>Moderate</option></select></div>
      <div class="form-field"><label>Prep minutes</label><input class="text-input" name="prep_minutes" type="number" min="0" max="240" value="15" /></div>
      <div class="form-field"><label>Cook minutes</label><input class="text-input" name="cook_minutes" type="number" min="0" max="360" value="20" /></div>
      <div class="form-field full"><label>Ingredients</label><textarea class="textarea-input" name="ingredients" placeholder="2 lb | chicken breast | Meat\n3 | bell peppers | Produce\n2 cups | rice | Pantry"></textarea><div class="form-help">One per line: amount | ingredient | category</div></div>
      <div class="form-field full"><label>Directions</label><textarea class="textarea-input" name="steps" placeholder="Start the rice.\nSlice the chicken and vegetables.\nCook until done."></textarea><div class="form-help">One step per line.</div></div>
      <div class="form-field full"><label>Recipe source URL (optional)</label><input class="text-input" name="source_url" type="url" placeholder="https://…" /></div>
      <div class="form-field full"><button class="btn btn-primary btn-wide" type="submit">Save Recipe</button></div>
    </form>`;
    return modalShell('Add Recipe', 'Keep it simple. You can always improve it after you cook it.', body);
  }

  function renderChooseDayModal() {
    const recipe = recipeById(state.modal.recipeId);
    const days = Array.from({ length: 7 }, (_, i) => addDays(state.weekStart, i));
    const body = `<div class="recommend-list">${days.map(day => {
      const key = dateKey(day);
      const meal = mealForDate(key);
      return `<div class="recommend-row"><div><strong>${day.toLocaleDateString(undefined, { weekday: 'long' })}</strong><small>${day.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}${meal ? ` · ${escapeHtml(mealDisplay(meal).name)}` : ' · Open'}</small></div><button type="button" class="btn ${meal ? 'btn-outline' : 'btn-primary'} btn-small" data-action="choose-day-for-recipe" data-date="${key}">${meal ? 'Replace' : 'Pick'}</button></div>`;
    }).join('')}</div>`;
    return modalShell('Choose a day', recipe?.name || '', body);
  }

  function renderRecommendWeekModal() {
    const picks = getRecommendations().slice(0, 4);
    const body = `<p class="section-subtitle" style="margin-bottom:12px">These are weighted toward short prep, healthy ingredients, lean protein, fresh vegetables, your favorite cuisines, and meals worth eating again tomorrow.</p>
      <div class="recommend-list">${picks.map(r => renderPlanRecipeRow(r, false)).join('')}</div>`;
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
      root.innerHTML = `<div class="app-shell"><main class="cook-shell"><div class="cook-top"><button type="button" class="btn btn-outline" data-action="close-cook">← Back</button><div class="cook-progress">Dinner done</div></div><section class="cook-card rating-panel"><h1 style="margin-top:0">How was it?</h1><p class="section-subtitle">One tap helps Weeknight make better suggestions.</p><div class="rating-buttons"><button type="button" class="btn btn-primary" data-action="rate" data-rating="makeagain">👍 Make Again</button><button type="button" class="btn" data-action="rate" data-rating="fine">😐 It Was Fine</button><button type="button" class="btn btn-danger" data-action="rate" data-rating="nope">👎 Skip Next Time</button></div></section></main></div>`;
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
      if (action === 'nav') { state.view = button.dataset.view; state.modal = null; render(); return; }
      if (action === 'previous-week') { state.weekStart = addDays(state.weekStart, -7); render(); return; }
      if (action === 'next-week') { state.weekStart = addDays(state.weekStart, 7); render(); return; }
      if (action === 'plan-date') { state.modal = { type: 'plan', date: button.dataset.date, mode: 'recommend' }; render(); return; }
      if (action === 'close-modal') { state.modal = null; render(); return; }
      if (action === 'modal-backdrop' && event.target === button) { state.modal = null; render(); return; }
      if (action === 'plan-mode') { state.modal.mode = button.dataset.mode; render(); return; }
      if (action === 'set-eatout') { await setEatingOut(); return; }
      if (action === 'clear-day') { await store.deleteMeal(state.modal.date); await reloadData(); state.modal = null; render(); toast('Day cleared'); return; }
      if (action === 'select-plan-recipe') { if (state.modal?.type === 'recommendWeek') { state.modal = { type: 'chooseDay', recipeId: button.dataset.recipeId }; render(); } else { await selectPlanRecipe(button.dataset.recipeId, button.dataset.leftover === 'true'); } return; }
      if (action === 'add-leftover-next') { await addLeftoverNext(); return; }
      if (action === 'add-recipe') { state.modal = { type: 'addRecipe' }; render(); return; }
      if (action === 'view-recipe') { state.modal = { type: 'recipeDetail', recipeId: button.dataset.recipeId }; render(); return; }
      if (action === 'plan-recipe') { state.modal = { type: 'chooseDay', recipeId: button.dataset.recipeId }; render(); return; }
      if (action === 'choose-day-for-recipe') { await planRecipeOnDate(state.modal.recipeId, button.dataset.date, true); return; }
      if (action === 'toggle-favorite') { await toggleFavorite(button.dataset.recipeId); return; }
      if (action === 'build-grocery') { await buildGroceryList(); state.view = 'grocery'; state.modal = null; render(); toast('Grocery list updated'); return; }
      if (action === 'clear-checked') { await store.clearChecked(weekKey()); await reloadData(); render(); return; }
      if (action === 'delete-grocery') { await store.deleteGrocery(button.dataset.id); await reloadData(); render(); return; }
      if (action === 'toggle-grocery' && button.matches('input')) { await toggleGrocery(button.dataset.id, button.checked); return; }
      if (action === 'recommend-week') { state.modal = { type: 'recommendWeek' }; render(); return; }
      if (action === 'cook') { state.modal = null; state.cook = { recipeId: button.dataset.recipeId, step: 0, finished: false }; render(); return; }
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
      if (action === 'signout') { if (realtimeChannel) { await sb.removeChannel(realtimeChannel); realtimeChannel = null; } await sb.auth.signOut(); state.user = null; state.authMessage = ''; state.authError = ''; renderAuth(); return; }
      if (action === 'signup') { await authAction('signup'); return; }
    } catch (error) {
      console.error(error);
      toast(error.message || 'Something went wrong');
    }
  }

  function handleInput(event) {
    if (event.target.id === 'recipe-search') {
      state.recipeSearch = event.target.value;
      const active = document.activeElement;
      render();
      const input = document.getElementById('recipe-search');
      if (active && input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    }
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
    if (event.target.id === 'recipe-form') { await saveNewRecipe(event.target); return; }
  }

  async function authAction(kind) {
    const form = document.getElementById('auth-form');
    if (!form) return;
    const fd = new FormData(form);
    const email = String(fd.get('email') || '').trim();
    const password = String(fd.get('password') || '');
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
        state.authMessage = 'Account created. Check the email for a confirmation link, then sign in on both phones.';
        renderAuth(); return;
      }
      await initializeShared(data.user);
      return;
    }
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) { state.authError = error.message; renderAuth(); return; }
    await initializeShared(data.user);
  }

  async function setEatingOut() {
    await store.upsertMeal({ meal_date: state.modal.date, type: 'eatout', recipe_id: null, label: 'Eating Out' });
    await reloadData(); state.modal = null; render(); toast('Eating out added');
  }

  async function selectPlanRecipe(recipeId, leftover) {
    const date = state.modal.date;
    await planRecipeOnDate(recipeId, date, !leftover, leftover);
  }

  async function planRecipeOnDate(recipeId, date, offerLeftovers = true, leftover = false) {
    const recipe = recipeById(recipeId);
    await store.upsertMeal({ meal_date: date, type: leftover ? 'leftover' : 'meal', recipe_id: recipeId, label: recipe?.name || '' });
    await reloadData();
    if (offerLeftovers && !leftover) state.modal = { type: 'leftoverPrompt', date, recipeId };
    else state.modal = null;
    render();
  }

  async function addLeftoverNext() {
    const nextKey = dateKey(addDays(parseLocalDate(state.modal.date), 1));
    if (mealForDate(nextKey)) { state.modal = null; render(); return; }
    const recipe = recipeById(state.modal.recipeId);
    await store.upsertMeal({ meal_date: nextKey, type: 'leftover', recipe_id: state.modal.recipeId, label: recipe?.name || '' });
    await reloadData(); state.modal = null; render(); toast('Tomorrow set to leftovers');
  }

  async function toggleFavorite(recipeId) {
    const recipe = recipeById(recipeId);
    if (!recipe) return;
    await store.saveRecipe({ ...recipe, favorite: !recipe.favorite });
    await reloadData(); render();
  }

  async function saveNewRecipe(form) {
    const fd = new FormData(form);
    const ingredients = String(fd.get('ingredients') || '').split('\n').map(s => s.trim()).filter(Boolean).map(line => {
      const [amount = '', name = '', category = 'Other'] = line.split('|').map(s => s.trim());
      return { amount, name: name || amount, category: normalizeCategory(category) };
    });
    const steps = String(fd.get('steps') || '').split('\n').map(s => s.trim()).filter(Boolean);
    const recipe = {
      name: String(fd.get('name') || '').trim(), cuisine: String(fd.get('cuisine') || '').trim(),
      prep_minutes: clampNumber(fd.get('prep_minutes'), 0, 240), cook_minutes: clampNumber(fd.get('cook_minutes'), 0, 360),
      difficulty: String(fd.get('difficulty') || 'Easy'), favorite: false, rating: '', is_new: true,
      tags: inferTags(String(fd.get('ingredients') || ''), clampNumber(fd.get('prep_minutes'), 0, 240), clampNumber(fd.get('cook_minutes'), 0, 360)),
      ingredients, steps, source_url: String(fd.get('source_url') || '').trim()
    };
    if (!recipe.name) return;
    const saved = await store.saveRecipe(recipe);
    await reloadData(); state.modal = { type: 'recipeDetail', recipeId: saved.id }; render(); toast('Recipe saved');
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
    const start = weekKey();
    const end = dateKey(addDays(state.weekStart, 6));
    const weekMeals = state.meals.filter(m => m.meal_date >= start && m.meal_date <= end && m.type === 'meal' && m.recipe_id);
    const uniqueRecipeIds = [...new Set(weekMeals.map(m => m.recipe_id))];
    const existing = currentWeekGroceries();
    const checkedByName = new Map(existing.map(i => [String(i.name).toLowerCase(), i.checked]));
    const map = new Map();

    uniqueRecipeIds.forEach(id => {
      const recipe = recipeById(id);
      (recipe?.ingredients || []).forEach(ingredient => {
        const name = String(ingredient.name || '').trim();
        if (!name) return;
        const key = name.toLowerCase();
        const amount = String(ingredient.amount || '').trim();
        if (!map.has(key)) map.set(key, { name, amount, category: normalizeCategory(ingredient.category), amounts: [] });
        if (amount) map.get(key).amounts.push(amount);
      });
    });

    const generated = [...map.values()].map(item => ({
      week_start: start,
      name: item.name,
      amount: item.amounts.join(' + '),
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
    await store.saveGrocery({ ...item, checked });
    await reloadData(); render();
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
    root.innerHTML = `<main class="auth-shell"><section class="auth-card"><h1>Weeknight</h1><div class="error-box">${escapeHtml(error.message || 'Unable to start the app.')}</div></section></main>`;
  });
})();
