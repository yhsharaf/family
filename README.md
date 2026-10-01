# Family · Aquila — guild website

The history of the MapleStory Idle RPG guild **Family** (and Famlly, FamiIy, FamlIy, Folks): Founders, every member and
when they joined, the family tree, memories, a walkable Henesys, the Hall of Shame with its whip and the traitor stew.

It's a plain static site (no build step), so it runs on **GitHub Pages**.

## 1. Put it on GitHub Pages
1. Create a new public repository on GitHub, e.g. `family-guild`.
2. Upload everything in this `site/` folder to it (Add file → Upload files, drag the folder contents in, Commit).
3. Repository → **Settings → Pages** → Source: *Deploy from a branch* → Branch `main`, folder `/ (root)` → Save.
4. After a minute the site is live at `https://<your-username>.github.io/family-guild/`.

Everything works at this point except the shared features (guestbook, guild-wide whip/stew counters, photo votes,
photo uploads), which show "coming soon" / count on your device only.

## 2. Turn on the shared features (free Supabase database, ~10 minutes)
1. Sign up at **supabase.com** → **New project** (any name, e.g. `family-guild`; pick a region near the guild; save the
   database password somewhere — you won't need it for this).
2. When the project is ready: **SQL Editor** → New query → paste all of `supabase_setup.sql` → **Run**.
3. **Project Settings → API**: copy the **Project URL** and the **publishable / anon public** key.
   *Never* use the `service_role` / secret key on the site.
4. Open `config.js` and paste them:
   ```js
   supabaseUrl: "https://xxxx.supabase.co",
   supabaseKey: "eyJ... (the anon / publishable key)",
   ```
5. Upload the changed `config.js` to the GitHub repo. Done — the guestbook, counters, votes and uploads are live.

## 3. Moderating
- **Uploaded photos never appear until you approve them.** Supabase → Table Editor → `memory_uploads` → tick
  `approved` for the ones you like. Bad ones: delete the row, and the file in Storage → `memories`.
- **Guestbook** messages appear right away (with a bad-word filter). Delete a message: Table Editor → `guestbook` →
  delete the row. To make every message wait for approval, run in the SQL Editor:
  `alter table guestbook alter column approved set default false;`
- Don't want uploads at all? In `config.js` set `uploads: false`.
- Photos are shrunk in the browser before upload (max 1600 px, WebP, usually 150–400 KB), so the free 1 GB lasts a long time.

## 4. Updating the history
On the project computer: `python3 make_sprite_sheet.py --all --export && python3 make_full_sheet.py --export && python3 build_site.py`,
then upload the changed `data.js`, `sprites/` and `memories/` to GitHub.
