# Weeknight — V1

A mobile-first shared meal planner for a busy family week.

The main loop is intentionally simple:

**Week calendar → pick meals → build grocery list → cook → rate**

## What already works

- Visual Monday–Sunday calendar
- Color-coded planned meals, quick meals, leftovers, new recipes, and open nights
- Tap any day to plan it
- Favorites, recommendations, all recipes, leftovers, and eating-out options
- One-tap prompt to make the following night leftovers
- Shared recipe keeper
- Six starter weeknight recipes
- Add your own recipe with ingredients, steps, timing, cuisine, and source URL
- Automatic grocery list generated from the week's planned meals
- Manual grocery additions
- Grocery categories and check-off state
- Step-by-step cooking mode
- Simple post-meal rating: Make Again / Fine / Skip Next Time
- Basic recommendation scoring based on speed, cuisine, favorite status, fresh ingredients, lean protein, and leftovers
- Demo mode using local browser storage
- Shared mode using Supabase email/password auth + database + optional live sync
- Installable web-app manifest for adding to an iPhone Home Screen

## Files

- `index.html` — app shell
- `styles.css` — mobile-first UI
- `app.js` — all V1 behavior
- `config.js` — Supabase connection values; blank = Demo Mode
- `config.example.js` — example shared-mode configuration
- `supabase-setup.sql` — database tables, security policies, and live-sync publication
- `manifest.webmanifest` — installable web app settings
- `icon.svg` — temporary app icon
- `vercel.json` — simple Vercel settings

# ELI5: Test it right now

1. Keep `config.js` exactly as it is with the two blank values.
2. Put these files on any static web host, or run a simple local web server.
3. Open the site.
4. It starts in **Demo Mode** and saves data only in that browser.

Do not judge shared-device behavior in Demo Mode. Demo Mode is specifically for testing the screens and workflow.

# ELI5: Make it shared between both phones

## 1. Create a Supabase project

Create a normal Supabase project. You only need one project for Weeknight.

## 2. Create the database

In Supabase:

1. Open **SQL Editor**.
2. Create a new query.
3. Paste the entire contents of `supabase-setup.sql`.
4. Run it once.

That creates:

- recipes
- weekly meals
- grocery items
- Row Level Security policies
- optional Realtime publication entries

## 3. Copy your two browser-safe connection values

In Supabase, open the project's **Connect** information / API key area and copy:

- Project URL
- Publishable key

Do **not** use a service-role key in this app.

## 4. Edit `config.js`

Change:

```js
window.WEEKNIGHT_CONFIG = {
  supabaseUrl: '',
  supabasePublishableKey: ''
};
```

to:

```js
window.WEEKNIGHT_CONFIG = {
  supabaseUrl: 'https://YOUR_PROJECT.supabase.co',
  supabasePublishableKey: 'YOUR_PUBLISHABLE_KEY'
};
```

## 5. Deploy to Vercel

This is a static site. There is no npm install or build step.

The easiest path is:

1. Create a GitHub repository.
2. Upload all the files in this folder to the repository root.
3. In Vercel, create a new project from that repository.
4. Leave the framework preset as **Other** / static if Vercel asks.
5. Deploy.

## 6. Create the shared household login

Open the deployed Weeknight site.

1. Tap **Create Shared Account**.
2. Use one email and password for the household.
3. If Supabase asks for email confirmation, confirm it.
4. Sign in.
5. Sign in with that same account on the other phone.

Both devices now use the same recipes, calendar, and grocery list.

# iPhone: make it feel like an app

Once the Vercel site is working:

1. Open it in Safari.
2. Tap the Share button.
3. Choose **Add to Home Screen**.
4. Launch Weeknight from the new icon.

# Important V1 limits

These are intentional, not bugs:

- Internet recipe discovery/sourcing is not automated yet. You can save a source URL now.
- Recipe Keeper import is not built yet.
- Ingredient quantities are combined conservatively. If two recipes both call for chicken, the list shows both amount strings rather than trying to do unreliable unit math.
- Pantry inventory is not tracked.
- There are no separate husband/wife profiles. Both people use the same household login, per the V1 plan.
- Recommendations are rules-based in V1. They already learn from Favorite and Make Again / Fine / Skip ratings, but there is no external AI recommendation service yet.

# Best next pass

After you and your wife use the basic workflow, the strongest Phase 2 additions are:

1. Recipe Keeper import
2. Paste-a-URL recipe import
3. Internet recipe discovery with actual recipe sources
4. Prep-ahead mode that combines tasks across the week's meals
5. Better serving/leftover scaling for four people + next-day leftovers
6. Smarter recommendations based on actual cooking history

The priority should stay the same: **make dinner planning easier, not make the app more impressive.**
