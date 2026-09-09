# Mealz — V4

A mobile-first shared dinner planner and recipe keeper for a busy family week.

**Main loop:** **Tonight → This Week → Recipes → Grocery → Cook**

## New in V4

### Stay signed in
Shared Mealz now explicitly uses persistent Supabase sessions. After you sign in on a phone, Mealz should keep that household session until you deliberately choose **More → Sign Out**.

### Stronger This Week calendar
The weekly calendar has been promoted visually so **This Week** has similar hierarchy to **Tonight**. It remains the main planning surface for the next seven days.

### Recipes organized by dish type
Recipes are grouped and filterable by dish/protein type, including defaults such as:

- Chicken
- Beef
- Pork
- Turkey
- Seafood
- Lamb
- Vegetarian
- Pasta
- Soup
- Other

When adding or editing a recipe, Mealz prompts for **Dish type**. The field remembers types already used in your recipe collection. You can select an existing one or simply type a new one.

### Recipe Keeper bulk import
The Recipes screen now has **Import Recipe Keeper**.

Mealz accepts either:

- the `.zip` exported by Recipe Keeper, or
- the `recipes.html` file inside that export.

The file is parsed in the browser. Mealz imports usable recipe text directly into your shared Mealz database and skips recipes whose names already exist.

Imported data includes:

- recipe name
- ingredients
- directions
- prep/cook times when available
- favorites
- rating signal when available
- Recipe Keeper course/category labels
- source URL when available
- inferred dish/protein type

**Recipe photos are not imported in V4.**

## Existing features

- Visual Monday–Sunday planner
- Color-coded planned meals, quick meals, leftovers, new recipes, and open nights
- Specific-day meal planning
- One-tap next-day leftovers
- Shared household database through Supabase
- Recipe add/edit/rename/duplicate/delete
- Clean recipe import from a website URL
- Automatic categorized grocery list
- Manual grocery additions
- Shared grocery check-off state
- Step-by-step cooking mode
- Make Again / Fine / Skip rating
- Rule-based recommendations
- iPhone Home Screen support
- Accidental double-tap zoom suppression while retaining pinch zoom

## Important: upgrading from V3

**No new Supabase SQL is required for V4.** Dish type is stored inside the existing recipe tag data, so your current shared database continues to work.

To update:

1. **Do not delete or replace your existing `config.js` in GitHub.** It contains the Supabase connection you already set up.
2. Upload/replace the other V4 files and folders. This update ZIP intentionally does not include `config.js`.
3. Commit the changes.
4. Let Vercel redeploy.
5. Open Mealz and refresh once on each phone.

## Import your existing Recipe Keeper collection

After V4 is deployed:

1. Open Recipe Keeper.
2. Use its backup/import-export area to export your recipes as the Recipe Keeper `.zip` file.
3. Open **Mealz → Recipes**.
4. Tap **Import Recipe Keeper**.
5. Choose the exported `.zip`.
6. Mealz shows a preview and tells you how many recipes are ready to import.
7. Tap **Import Recipes**.

Mealz skips exact recipe-name duplicates rather than creating copies.

## Files

- `index.html` — app shell and browser libraries
- `styles.css` — mobile-first UI
- `app.js` — Mealz application behavior
- `api/import-recipe.js` — Vercel function for website recipe import
- `lib/recipe-parser.js` — server-side clean URL recipe parser
- `lib/recipekeeper-client.js` — browser-side Recipe Keeper bulk importer
- `config.js` — your existing Supabase connection file (intentionally not included in the V4 update ZIP)
- `supabase-setup.sql` — initial database setup (no need to rerun for V4)
- `manifest.webmanifest` — installable app settings
- `icon.svg` / `apple-touch-icon.png` — app icons
- `package.json` / `vercel.json` — deployment settings

## Current intentional limits

- Recipe Keeper photos are not imported yet.
- Ingredient quantity combining remains conservative rather than guessing unit conversions.
- No pantry inventory.
- One household login rather than individual profiles.
- Recommendations are still rules-based, but imported favorites and future Mealz meal history make them increasingly useful.

## Good next additions

1. Prep-ahead mode that combines prep across the week's meals
2. Serving/leftover scaling for four people plus next-day leftovers
3. Smarter “similar but new” recommendations using actual Mealz cooking history
4. Optional recipe photo storage/import

The product rule stays the same: **make dinner planning easier, not make the app more complicated.**
