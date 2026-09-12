# Mealz V5

A shared dinner planner and recipe keeper built for phones first.

**Main loop:** Plan the week, pick a recipe, add notes, shop, cook.

## New in V5

### Built for the phone
The layout is now phone first. Wide screens are the exception instead of the default, so the app no longer renders at desktop width and shrinks to fit on an iPhone. Type is larger, tap targets are bigger, and the bottom bar is anchored to the bottom edge with room for the home indicator.

### Tonight card removed
The week is the only planning surface now. Every day is a full width row you can tap.

### Tap a meal to open it
Tapping a planned meal opens a meal sheet for that night. It shows the meal, a notes box, and a grid of actions: Recipe, Cook, Swap, Leftovers, Clear.

### Notes on a planned meal
Either of you can open a night and add notes such as "potatoes as a side" or "red and yellow bell peppers". Notes are shared, they show on the calendar under the meal name, and a Send to Grocery button drops the note straight onto the grocery list.

### Plan screen is recipe selection
Tapping Plan on a day opens straight into choosing a recipe. A search box sits at the top, with filter chips for Suggested, Favorites, All, Leftovers, and one for each dish type. Eating Out, New Recipe, and Clear Day moved to small tiles below the results so they stop competing with the main job.

### Recipe library redesigned
Recipes are now compact rows with a dish type icon, name, type, time, and a favorite toggle. The search and filter bar stays pinned at the top while you scroll. Filters include favorites and every dish type in your collection.

### Faster and steadier
Typing in either search box no longer rebuilds the screen, so the keyboard and your place in the list stay put. Checking off groceries and tapping a favorite now respond immediately instead of waiting on the database. Scroll position survives a redraw.

### Grocery list
The list shows how many items are still to get, and a chip hides checked items while you shop.

## Installing V5

1. Run `supabase-v5.sql` once in Supabase, SQL Editor. It adds the notes column used by meal notes.
2. Do not delete or replace your existing `config.js` in GitHub. This update ZIP intentionally does not include it.
3. Replace `app.js`, `styles.css`, and `README.md`, and add `supabase-v5.sql`.
4. Commit, let Vercel redeploy, then refresh once on each phone.

If the app still looks zoomed out on your iPhone, open it in Safari, tap the aA menu in the address bar, and choose Request Mobile Website. Then use Share, Add to Home Screen so it opens as an app.

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

## Upgrading from V3

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

1. Recipe photos, imported from the Recipe Keeper export into Supabase storage
2. Offline support so the grocery list works in a store with weak signal
3. Cooked history, so you can filter by what you have not made in a while
4. Prep ahead mode that combines prep across the week's meals
5. Serving and leftover scaling

The product rule stays the same: **make dinner planning easier, not make the app more complicated.**
