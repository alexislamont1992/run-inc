# Run Inc 🏃

Shared half-marathon training log for Alexis, Ryan and Justin (race: **2 May 2027**).
It's one static page on GitHub Pages, with Supabase as the shared database and live sync between phones.

Files: `index.html`, `styles.css`, `app.js`, `config.js` (Supabase URL/key, race date, names) and `schema.sql`.

## Setup

### 1. Supabase (database)
1. Sign up at <https://supabase.com> (GitHub login works) → **New project**.
   Name it `run-inc`, set a database password (keep it somewhere; the app doesn't need it), pick the region closest to you, and use the Free plan.
2. When the project is ready, go to **SQL Editor → New query**, paste all of `schema.sql`, and click **Run**.
   This creates the `runs` table, the RLS policies (anon may read and write `runs` only) and enables Realtime on it.
3. Go to **Project Settings → API** (or the **Connect** button), copy the **Project URL** and the **anon / publishable** key, and paste them into `config.js`.
   ⚠️ Never use the `service_role` / secret key: it bypasses RLS.

### 2. GitHub Pages (hosting)
1. Sign up at <https://github.com> and create a **public** repository named `run-inc` (leave it empty).
2. Push this folder:
   ```bash
   git remote add origin https://github.com/<your-username>/run-inc.git
   git push -u origin main
   ```
   (Or upload the files with **Add file → Upload files** on the repo page.)
3. Repo **Settings → Pages → Build and deployment**: Source = *Deploy from a branch*, Branch = `main`, folder `/ (root)` → **Save**.
4. After about a minute the site is live at `https://<your-username>.github.io/run-inc/`. Send that link to the others.

## Using it
- Tap **+** in a runner's column to add a run, and tap a card to edit it (status, actuals, interval splits, notes).
- Use **‹ / ›**, **Today**, the date label (opens a date picker) or a horizontal swipe to change week.
- **⧉ Copy last wk** copies that runner's previous week into the current week as *planned*.
- Fill in any two of **distance, time and pace/speed** and the app calculates the third (shown in orange). Durations accept `45` (minutes), `45:30` or `1:05:00`.
- **Intervals** get rep blocks with a split time per rep. **Long** and **Tempo** runs get simple blocks (e.g. warm-up / tempo / cool-down), each with distance, target pace or time, and an actual time. *Use as planned/actual total* copies the block totals into the run.
- **⧉ Copy this workout** (at the bottom of the editor) copies one run to any days this week or next week, for any of the three runners.
- Quick copy: **long-press a card** (or right-click on a computer), then tap **⧉ Paste** on any day or runner, in any week. Tap **Done** when finished.
- If `config.js` is empty, the app runs in **Demo mode** and stores data only in that browser.

## Notes
- No login: anyone with the link can edit everything, so share the link only with the three of you.
- Free Supabase projects pause after about a week with no activity. If that happens, open the Supabase dashboard and click **Restore**.
- To change names, update `RUNNERS` in `config.js` **and** the `check (runner in (...))` constraint in `schema.sql`.
