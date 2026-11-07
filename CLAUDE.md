# Mealz: handoff for Claude Code

Read this first. It carries everything decided in the planning chat (Nov 7, 2026) so you can pick up at Phase 2.

## Who and what

* Owner: Greg Zirkle. He directs AI to build; he does not write code himself.
* Users: Greg and his wife Stephanie, one shared household. Used almost entirely on iPhone, added to the home screen.
* Mealz is a dinner planner and recipe keeper: plan the week, shop, cook. V7 adds a MealsMealsMeals style plan, shop, cook loop: pantry, real costs, macros, smart shopping list.
* Full spec and phase plan: https://claude.ai/artifact/G19dxWrLzfQUckkWwRgnCG (Mealz Build Spec and Development Plan).

## How Greg wants to work (follow these)

1. Never use dashes of any kind (hyphens, en dashes, em dashes) in anything written for Greg: chat replies, README text, commit messages, and visible app text. Code identifiers and file names are the only exception.
2. Q and A before building. Ask short questions when something is open, then build.
3. Get his approval before running SQL on the live database, pushing to main, or anything that changes production. Show what will change first.
4. Keep replies concise and direct.
5. Interface direction: keep the bottom tab bar; use iPhone style tile grids for actions inside screens; phone layout first.
6. Each phase ships as: changed files, one idempotent SQL file (`supabase-v7-phaseN.sql`, safe to run twice), and a README section in plain language. Greg also likes a zip of all changed files.
7. He is fine running Supabase SQL migrations rather than working around the schema.

## Stack and deploy

* Plain HTML, CSS and JavaScript. No framework, no build step. `index.html` loads `supabase-js` and JSZip from jsDelivr, then `config.js`, `lib/recipekeeper-client.js`, `app.js`.
* `app.js` is one IIFE (about 1,720 lines): state, LocalStore (demo mode), SupabaseStore, render functions, one click handler keyed on `data-action`.
* Vercel project `meal-z` (team `team_pgOZRHnyRQJqKt1f7CoawFOn`, project `prj_wBWvzYOK9fH5AK03cpFoRSxGsVJe`). Production: https://meal-z.vercel.app. Pushing to `main` on github.com/gregzirkle-ux/MealZ deploys automatically.
* Vercel functions live in `api/` (CommonJS, Node 24): `import-recipe.js` (website recipe import), `keep-alive.js` (daily ping).
* Supabase project `qcezhjociexuinglumuk` on the free plan. `config.js` holds the URL and publishable key (public, protected by RLS). Never commit secret keys.
* Secrets go in Vercel environment variables only, called only from `api/` functions: `ANTHROPIC_API_KEY` (Phase 2), `USDA_API_KEY` (Phase 4). Greg is getting both.

## Testing approach that worked

* SQL: run every migration against a local Postgres 16 with a stub `auth` schema (`auth.users`, `auth.uid()` reading `request.jwt.sub`) and roles `anon` and `authenticated`, run it twice, then test RLS as each user with `set role authenticated; set request.jwt.sub = '...'`.
* App: serve the folder locally and drive it with Playwright, swapping the `supabase-js` CDN script for a fake client that keeps data in memory. Check sign in, planning, and sharing flows, and take phone sized screenshots (390 x 844).

## Done so far

### Phase 0: keep alive (live)
* `api/keep-alive.js` reads one row from `public.keep_alive`. `vercel.json` cron runs it daily at 11:00 UTC. Verified returning `{"ok":true}`.
* The project had already been paused once and was resumed on Nov 7.

### Phase 1: households and two logins (live)
* Tables: `households`, `household_members` (household_id, user_id unique, display_name, email), `household_invites` (email, household_id, display_name).
* Functions: `current_household_id()` and `claim_household_invite()`, both security definer. The app calls the claim function after sign in; an invited email joins automatically, and an uninvited email is signed out with a message.
* `recipes`, `weekly_meals`, `grocery_items` now have `household_id` (not null, default `current_household_id()`), `updated_by` (set by trigger `stamp_updated`), `updated_at`. RLS on all three is `household_id = current_household_id()`.
* `weekly_meals` is unique on `(household_id, meal_date)`; the app upserts with `onConflict: 'household_id,meal_date'`.
* Greg is a member (display name Greg). stephanie.strecker@gmail.com is invited as Stephanie and has not signed up yet.
* Live data at migration: 80 recipes, 22 meals.
* App: SupabaseStore takes the member and stamps `household_id` on inserts; realtime filters on `household_id`; More shows who is signed in and the household; the meal sheet shows "Planned by".
* Deferred from Phase 1: splitting `app.js` into a few modules. Do it when convenient, with no behavior change.

## Current data shapes

* `recipes.ingredients` is jsonb: `[{ amount: "1 lb", name: "ground turkey", category: "Meat" }]`, free text amounts. Dish type lives in `tags` as `dish:Chicken`.
* `weekly_meals`: one row per date, `type` in (`meal`, `leftover`, `eatout`), `recipe_id`, `label`, `notes`.
* Today's leftovers: after planning, a prompt sets only the next day to `leftover`. Nothing scales.
* Today's grocery list (`buildGroceryListForWeek`): unique recipes from `meal` rows, amounts joined as text ("1 lb + 2 lb"), not summed.

## Phase plan (approved)

0. Keep alive. Done.
1. Households and two logins. Done.
2. Structured recipes, servings and leftovers. Next.
3. Pantry, smart list and add ons.
4. Macros (USDA), switchable units, spend history.
5. iPhone push alerts (meal added by the other person, list ready) and copy or share list.
6. Leftover View and pantry from photos (AI reads the photo, user confirms).
7. Harris Teeter (Kroger API) prices, cost per serving and week, Swap product, send to cart, Instacart link. Needs Kroger and Instacart developer keys.

Each phase is tested on Greg's phone before the next starts.

## Phase 2 requirements (signed off)

1. Structured ingredients
   * New table `recipe_ingredients`: recipe_id, household_id, position, raw text, qty (numeric), unit, item, prep note, category, confidence flag.
   * Conversion is fully automatic using the Anthropic API from a Vercel function (for example `api/convert-ingredients.js`). Check current model names in the Anthropic docs before choosing one.
   * Convert on recipe save and import, and backfill all existing recipes once.
   * Lines the model is unsure about get a small flag on the recipe. Nothing blocks planning.
   * Keep the old `ingredients` jsonb as a backup until the backfill is verified.
2. Servings
   * Add `recipes.servings` (the recipe's own yield) and `recipes.course` (entree, side, app, dessert).
   * Every recipe is always prepared at a base of 4 servings: scale from the recipe's own servings to 4 first.
3. Leftovers
   * Keep the existing leftovers checkbox or tile, and extend it.
   * Checking it opens a multiplier choice: 1.5x, 2x or 3x.
   * Then pick leftover days, default 1, up to 3 (a big pot of chili might cover 3).
   * Those days fill in automatically as Leftovers Nights linked to the cook night. Add `weekly_meals.multiplier`, `leftover_days`, and `source_meal_id`.
   * Never overwrite a day that already has a plan; ask first. Unchecking clears the linked Leftovers Nights.
4. Shopping
   * The grocery list uses cook nights only, scaled to 4 times the multiplier.
   * Amounts are actually added up with unit conversion where possible.
   * Leftovers Nights buy nothing.
5. Costs (Phase 7): full cost lands on the cook night; Leftovers Nights show $0.
6. Macros (Phase 4): per serving, the same regardless of multiplier.

## Other decisions on record

* Macros: USDA FoodData Central, per serving, no daily targets.
* Notifications: iPhone web push (needs a service worker; works only from the home screen icon).
* Pantry start: photos, typed entry, and a staples checklist.
* Ordering: copy or share list first; Instacart and Harris Teeter cart in Phase 7. Order complete alerts come from those apps, not Mealz.
* Prices: Harris Teeter through the Kroger Public API (needs a store location id; the cart is add only). Confirm Harris Teeter is in the Kroger chain list near 28208 before building pricing.
