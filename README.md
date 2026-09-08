# Mealz — V3

A mobile-first shared dinner planner and clean recipe keeper for a busy family week.

**Main loop:** **Week calendar → pick meals → build grocery list → cook → rate**

## What works now

- Visual Monday–Sunday calendar
- Color-coded planned meals, quick meals, leftovers, new recipes, and open nights
- Tap any day to plan it
- Favorites, recommendations, all recipes, leftovers, and eating-out options
- One-tap prompt to make the following night leftovers
- Shared recipe keeper
- Six starter weeknight recipes
- **Clean recipe import from a URL**: Mealz extracts the recipe data and saves ingredients + directions inside Mealz instead of sending you back through the source site's ads/stories/popups
- Manual recipe entry
- Automatic categorized grocery list generated from the week's planned meals
- Manual grocery additions
- Grocery check-off state
- Step-by-step cooking mode
- Simple post-meal rating: Make Again / Fine / Skip Next Time
- Basic recommendation scoring based on speed, cuisine, favorite status, fresh ingredients, lean protein, and leftovers
- Demo mode using local browser storage
- Shared mode using Supabase email/password auth + database + optional live sync
- Installable web-app manifest for adding to an iPhone Home Screen
- iPhone double-tap zoom suppression while retaining ordinary scrolling and pinch zoom


## New in V3

### Recipe management
Open any saved recipe to **Edit / Rename**, **Duplicate**, or **Delete** it. Editing covers the recipe name, cuisine, prep/cook times, difficulty, ingredients, directions, and source URL while preserving its favorite/rating history. Deleting a recipe asks for confirmation; if it is already planned on the calendar, those planned meals are removed too and generated grocery lists for affected weeks are refreshed.

## Core V2 additions

### 1. Mealz branding
The app is now named **Mealz**. Existing V1 local demo data is migrated automatically when possible.

### 2. URL recipe import
Tap **Recipes → Add Recipe** and the default action is now:

1. Paste recipe URL
2. Tap **Import Clean Recipe**
3. Mealz reads structured recipe data from the source page
4. Review the cleaned ingredients/directions
5. Tap **Save Recipe**

The source URL is retained only for attribution/reference. Cooking happens from the saved clean copy in Mealz.

The importer first looks for standard Schema.org Recipe structured data (the format widely used by recipe publishers/search engines), with a limited microdata fallback.

Some sites may block automated access or may not publish usable recipe data. In that case Mealz gives a clear error and you can use manual entry.

### 3. Phone zoom fix
`touch-action: manipulation` is used so accidental double-taps do not zoom the app UI. Pinch zoom remains available.

## Files

- `index.html` — app shell
- `styles.css` — mobile-first UI
- `app.js` — browser app behavior
- `api/import-recipe.js` — Vercel server function that safely fetches a recipe page
- `lib/recipe-parser.js` — extracts and cleans structured recipe data
- `config.js` — Supabase connection values; blank = Demo Mode
- `config.example.js` — example shared-mode configuration
- `supabase-setup.sql` — database tables, security policies, and live-sync publication
- `manifest.webmanifest` — installable web app settings
- `icon.svg` / `apple-touch-icon.png` — app icons
- `package.json` — pins the Vercel function to Node 24
- `vercel.json` — Vercel settings

# ELI5: Test it

## Normal app workflow

With `config.js` left blank, all of the normal calendar / recipes / groceries / cooking features work in **Demo Mode** and save to that browser.

## URL import

The URL importer is a server function, so it works on the **Vercel deployment**. If you simply double-click `index.html` on your PC, the rest of Demo Mode works but URL import will not have a server endpoint to call.

# ELI5: Make Mealz shared between both phones

## 1. Create a Supabase project

Create one normal Supabase project for Mealz.

## 2. Create the database

In Supabase:

1. Open **SQL Editor**.
2. Create a new query.
3. Paste the entire contents of `supabase-setup.sql`.
4. Run it once.

If you already ran the V1 SQL, you do **not** need new database columns for V2.

## 3. Copy the browser-safe connection values

Copy your:

- Project URL
- Publishable key

Do **not** put a Supabase service-role/secret key in this browser app.

## 4. Edit `config.js`

```js
window.MEALZ_CONFIG = {
  supabaseUrl: 'https://YOUR_PROJECT.supabase.co',
  supabasePublishableKey: 'YOUR_PUBLISHABLE_KEY'
};
window.WEEKNIGHT_CONFIG = window.MEALZ_CONFIG;
```

## 5. Deploy to Vercel

1. Put all files/folders in this `mealz` folder at the root of the GitHub repository.
2. Push to GitHub.
3. Import/update that repository in Vercel.
4. Framework can remain **Other**.
5. Deploy.

The `/api/import-recipe` folder is automatically deployed as a Vercel Function alongside the app.

## 6. Use the same household login on both phones

Open the deployed Mealz site, create/sign into the shared account, then sign in with the same account on the other phone.

# iPhone: make it feel like an app

1. Open the deployed Mealz URL in Safari.
2. Tap Share.
3. Tap **Add to Home Screen**.
4. Open Mealz from the Home Screen.

# Intentional limits

- Recipe Keeper bulk migration is not built yet.
- URL import is only as good as the structured recipe data the source site provides.
- Some websites may block the importer.
- Ingredient quantity math remains conservative: if multiple recipes use the same ingredient, Mealz keeps the source amounts visible rather than guessing at unit conversions.
- Pantry inventory is not tracked.
- There are no separate profiles; both people use the same household login.
- Recommendations are rules-based for now.

# Strong next additions

1. Recipe Keeper bulk import/migration
2. Prep-ahead mode that combines tasks across the week's meals
3. Serving/leftover scaling for 4 people + next-day leftovers
4. Better “similar but new” recommendations with sourced recipe suggestions
5. Optional recipe photo import

The product rule stays the same: **make dinner planning easier, not make the app more complicated.**

## Recipe management

Saved recipes are fully editable. Open a recipe and use **Edit / Rename**, **Duplicate**, or **Delete**. Editing can change the name, cuisine, times, difficulty, ingredients, directions, and source URL. Deleting a recipe also removes any calendar meals that reference it and refreshes generated grocery lists for those affected weeks.
