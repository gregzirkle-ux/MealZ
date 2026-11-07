# Mealz V7

A shared dinner planner and recipe keeper built for phones first.

**Main loop:** Plan the week, pick a recipe, add notes, shop, cook.

## V7 Phase 2: Structured recipes, servings and leftovers

Mealz now understands what is in each recipe, cooks at least 4 servings, plans leftovers, and adds up the grocery list for real.

### What changed
1. **Ingredients are organized automatically.** Each ingredient line is split into amount, unit, item, prep note and grocery section, using Claude through a new Vercel function (`api/convert-ingredients.js`). It happens in the background when a recipe is saved or imported, and all existing recipes are converted the first time someone opens the app after the update. More shows the progress. The original ingredient text is kept as a backup.
2. **Flags instead of blocking.** If Mealz is not sure about a line, or had to estimate the servings, the recipe gets a small ⚑. Open it to see what is marked, then tap Looks Right, or Edit to fix it. Nothing stops you from planning.
3. **Servings and course.** Recipes have a servings number (what the recipe makes as written) and a course: entree, side, app or dessert. Recipe Keeper recipes take servings from their "Serves" tag. Recipes with no servings get an estimate. You can change both in Edit.
4. **Never less than 4.** A cook night always makes the recipe's servings or 4, whichever is more.
5. **Leftovers.** Tap Leftovers on a cook night, or Add Leftovers after planning. Pick Lunch Only or 1, 2 or 3 leftover dinners, then the total servings to cook. Each dinner adds 4, and you can adjust it up or down, never below 4. The nights right after fill in as Leftovers Nights linked to the cook night. If one of those days already has a plan, Mealz asks first. Remove Leftovers clears them. Clearing or swapping a cook night asks, then clears its Leftovers Nights too.
6. **Smarter grocery list.** Only cook nights count, each scaled to the servings planned. Leftovers Nights buy nothing. Amounts are added up across recipes with unit conversion, so 2 lb plus 8 oz shows as 2 lb 8 oz. The same recipe planned twice counts twice. A recipe that has not been organized yet still shows its original amounts, marked with the scale, like "1 lb (2x)".
7. **Your unit setting.** More has Amounts (1 1/2 or 1.5) and Weights (Ounces, Lb and oz, or Pounds). Each person has their own setting, and it applies to the grocery list and recipes.
8. **Sign in with an emailed code.** Type your email, tap Email Me a Code, and type the code from the email. No password to remember. It works inside the home screen app (a link would open Safari, which keeps a separate login). Password sign in still works too.

### Installing Phase 2
1. In Vercel, Settings, Environment Variables, add `ANTHROPIC_API_KEY` for Production and Preview.
2. In Supabase, SQL Editor, run `supabase-v7-phase2.sql` once. Do this before deploying the app files. It only adds tables and columns.
3. In Supabase, Authentication, Emails, edit the **Magic Link** and **Confirm signup** templates and add a line with `{{ .Token }}` so the email shows the sign in code.
4. Deploy the changed files: `app.js`, `styles.css`, `index.html`, `vercel.json`, `package.json`, `package-lock.json`, `.gitignore`, `README.md`, plus the new `api/convert-ingredients.js`, `lib/units.js` and `supabase-v7-phase2.sql`.
5. Open Mealz and leave it open for a few minutes. More, Ingredients shows the conversion progress. If you close it partway, it picks up where it left off next time.
6. Look through recipes marked ⚑ when convenient.

### Cost
Conversion uses Claude Opus 5.5 at low effort, about 2 to 3 cents per recipe, so roughly $2 for the existing recipes and pennies after that. To use a cheaper model, set `ANTHROPIC_MODEL` in Vercel to `claude-haiku-5-5`.

## V7 Phase 1: Two logins, one household

Greg and Stephanie now each sign in with their own email and share the same recipes, week, and grocery list.

### What changed
1. New household tables. The existing Mealz account becomes Greg's login, and stephanie.strecker@gmail.com is invited.
2. Every recipe, meal, and grocery row now belongs to the household instead of one login.
3. Mealz records who last changed each row. The meal sheet shows "Planned by Greg" or "Planned by Stephanie".
4. The sign in screen says Create Account instead of Create Shared Account. An email that was never invited gets a clear message and is signed back out.
5. More shows who is signed in and who is in the household.

### Installing Phase 1
1. In Supabase, SQL Editor, run `supabase-v7-phase1.sql` once. Do this before deploying the app files.
2. Replace `app.js`, `styles.css`, and `README.md`, and add `supabase-v7-phase1.sql`.
3. Commit and let Vercel redeploy, then refresh Mealz on Greg's phone. Greg stays signed in.
4. Stephanie opens Mealz, taps Create Account with stephanie.strecker@gmail.com, confirms the email if Supabase sends one, then signs in.

## V7 Phase 0: Keep alive

Supabase pauses free projects that go quiet for a week. Mealz now pings its own database once a day so that never happens.

### What changed
`api/keep-alive.js` is a small Vercel function that reads one row from a new `keep_alive` table. `vercel.json` schedules it every day at 11:00 UTC (6 or 7 AM Charlotte time). It reuses the Supabase address and public key already in `config.js`, so there is nothing new to set up in Vercel.

### Installing Phase 0
1. In Supabase, SQL Editor, run `supabase-v7-phase0.sql` once.
2. Add `api/keep-alive.js` and `supabase-v7-phase0.sql`, and replace `vercel.json` and `README.md`.
3. Leave `config.js` alone.
4. Commit and let Vercel redeploy.
5. Check it: open `/api/keep-alive` on your Mealz site. You should see `"ok":true`. In Vercel, Settings, Cron Jobs should list the job.

No app screens change in Phase 0.

## New in V6

### Look
New highlight color, #FF8200. Backgrounds are white and bright, lines are lighter, and the tagline is now "plan, eat, survive". The app icon is the skull with fork and knife, recolored onto the orange background.

### Recipes are tiles
Both the Recipes page and the Swap picker now use the same two column tile grid. Each tile has a colored block by dish type, the name, and the total time. When photos arrive later, they drop into that colored block with no other change.

### One Filter button
The rows of chips are gone. Both pages have Search, a Filter button, and a heart toggle for favorites. Filter opens a sheet with dish type, where you can select as many as you want, and total time. The dish type list is built from your recipes, so new categories appear on their own. The count on the button shows how many filters are active.

### Back goes back
Opening a recipe from a meal night now returns you to that meal night. The close button turns into a back arrow whenever there is somewhere to go back to.

### Grocery
The controls at the top are tiles: Rebuild, Hide Checked, Clear Checked, and Clear All. Clear All asks first.

### Two layout fixes
The filter row was pushing about 28 pixels past the screen edge, which cut off the last options. Fixed. The wide screen layout is now locked to devices with a real pointer, so an iPhone cannot fall into the desktop layout even if Safari is set to request the desktop site.

## Installing V6

1. Replace `app.js`, `styles.css`, `index.html`, `manifest.webmanifest`, `apple-touch-icon.png`, and `README.md`, and add `icon-192.png`, `icon-512.png`, and `icon-maskable-512.png`.
2. Delete `icon.svg` from the repo. Nothing points at it now.
3. Leave `config.js` alone.
4. Commit, let Vercel redeploy, then refresh on your phone. To see the new icon on your home screen, delete the old Mealz icon and add it again from Safari.

No database changes in V6.

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
