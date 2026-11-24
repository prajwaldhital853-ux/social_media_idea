# HANDOFF — Exposing (social media platform)

**Purpose:** durable context bridge. The Qoder IDE does **not** inherit chat history from
Qoder Desktop, so every new IDE session starts blind. This file is the substitute. Read it
before touching code in this repo, and update the *State snapshot* + *Open threads* sections
when you finish a batch.

**Generated:** 2026-11-24, from the full Qoder Desktop transcript archive (9 sessions / 1008
messages / 996 recorded file-change rows). Sources are named in §10.

> **Secrets policy for this file:** never paste passwords, DB connection strings, API keys,
> OAuth client secrets or cPanel credentials here. They appear inside the Desktop chat logs,
> and this file is committed to a public GitHub repo. Credentials live in the Render / Vercel
> dashboards, the Google Cloud console, and gitignored `*.env` files only.

---

## 1. Working rules the client has stated (obey these first)

Repeated across many prompts, escalating in urgency — treat as hard constraints:

1. **Be fast, not thorough-by-default.** Verbatim, said four separate times: *"you are taking
   so much time just to finish one simple request why is that? so stop using terminal unless it
   very important. dont do tests leave it to me you just change the code according to my request
   and as soon the code written finish report me back."*
   - No terminal unless the feature genuinely cannot be built without it.
   - Do **not** run broad QA suites by default. Run focused regression tests whenever a fix or
     feature is uncertain, and report exactly what passed.
   - Edit → report back. Short replies.
2. **He tests in his own browser.** Report what changed and where; he verifies visually. Focused
   automated checks complement that pass rather than replacing it.
3. **Always commit + push after completed edits.** Resolve merges yourself. Deliberately **never**
   commit `.qa/` artifacts (screenshots, probes, result JSON, server logs, temporary harnesses),
   `.qoder/`, credentials, or local environment files.
4. **When he says "dont ask me any question do it whatever you feels best because i am going to
   sleep"** — decide autonomously, merge, push, and write the reasoning in the commit message.
5. **Anti-"AI generated" design is a recurring theme.** Concretely rejected: card-in-card, big
   rounded grey action-button backplates, verbose explanatory copy in admin, slider-with-words
   zoom controls, banner-width toasts, visible "pull to refresh" text. Concretely accepted:
   small dark pill toast (`var(--ink)` bg, white 14px, fully rounded, hugs its words), Facebook-like
   tight reaction rows, dense flat admin tables, thin dividers over heavy separation.
6. **Never reveal the underlying model.** The Desktop persona answers to **HungerG** and declines
   provider/model questions; keep that behavior.
7. **Memory files:** only write persistent memory when he asks, and report honestly what was
   written. (Established in the Desktop session as `feedback-memory-writes.md`.)

## 2. What the product is

**Exposing** — a client-contract social media platform (Instagram-like, with Facebook-style
desktop chrome). Brand: red **#E40104** + black; logo/favicon are the client's real assets, not
placeholders. The blue accent is used for links/author tags and the verified tick **by request**
("even though our brand color is red make the tick icon in profile blue").

Contract facts (from the client PDF + chat, clarified 19 Nov):
- 20% advance received **19 Nov 2026, 1:30 PM** → clause 14.3 refund deadline **19 Dec 2026**.
- First version promised to the client for **20–21 Nov 2026**.
- Facebook/Google login is in scope at launch.
- Media retention: secondary backup only for as long as the video exists on the platform.
- Age/location gating: kept.
- **Marketplace and Video are hidden behind feature flags, to be activated later** — client
  instruction, not a bug.
- Promotion picker lives on the compose page so users choose it.
- The foreign owner is the single named feedback contact. Client-owned account access (the
  platform's own logins) was **not yet provided** as of 19 Nov.

## 3. Repo topology

Monorepo at `D:\social_medial`:

| Part | Path | Notes |
|---|---|---|
| Member app | `app/`, `components/`, `lib/` | Next.js 14.2.5 pages router, `:3000` |
| Backend | `backend/` | Django 6.1.3 + DRF + Channels, `:8001` |
| Staff console | `admin/` | **separate Next.js app**, own `package.json`, `:3002` |
| QA harness | `.qa/` | Puppeteer runners + artifacts, gitignored mostly |

Root `next.config.js` rewrites `/api/*`, `/media/*`, `/ws/*` → `EXPOSING_API_ORIGIN`
(default `http://127.0.0.1:8001`), preserving trailing slashes so Django's resolver and
cookie auth work without CORS preflights.

**Backend apps** (`backend/apps/`): `accounts`, `adminpanel`, `comments`, `common`, `follows`,
`marketplace`, `messages`, `moderation`, `notifications`, `posts`, `profiles`, `promotions`,
`reactions`, `saved`, `wallet`.

**Admin console routes** (`admin/app/`): `access`, `alerts`, `algorithm`, `audit`, `coins`,
`content`, `exports`, `flags`, `ledger`, `limits`, `login`, `me`, `notices`, `overview`,
`packages`, `people`, `policy`, `pricing`, `promotions`, `reports`, `review`, `spam`, `welcome`.

**Frontend runtime** (`lib/`): `types.ts` (canonical `Database` schema) → `store.ts`
(`merge(db, fragment)`, the only mutation point) → `storage.ts` (localStorage demo DB when
`NEXT_PUBLIC_API=off`) → `api.ts` (`ApiError`, `send`/`attempt`/`wake`, CSRF + device-id
headers, XHR uploads) → `lists.ts` (keyset pagination caches via `useSyncExternalStore`) →
`AppContext.tsx` (the provider everything reads from). Dependency direction is strictly inward:
components import `lib/`, `lib/` imports no routes.

**Error contract** every API response obeys: `{ detail, request_id, retry_in? }` — prose
sentences, not codes. `RequestIdMiddleware` + `apps/common/errors.py` stamp it; `lib/api.ts`
reconstructs it. Non-JSON bodies (proxy HTML) are normalized into a human sentence.

### Running it

```bash
# member app — from repo root
npm run dev                                   # :3000
# backend — configured for the portable Postgres cluster on :5434
backend/.venv/Scripts/python.exe manage.py runserver 8001
# staff console
cd admin && npm run dev                       # :3002
```

Local DB note (24 Nov): the configured `:5434` endpoint was unavailable on this machine. The
reachable PostgreSQL service is on `:5432` and requires a password that is not stored in the repo.
Do not weaken `pg_hba.conf` or guess credentials. An uncommitted `.qa` SQLite harness may run
focused logic tests when necessary, but that result must be reported as a fallback, not a real
PostgreSQL integration pass.

Demo login (local seed, gitignored seed values): username `sita`, staff/superuser — password is
`DEMO_PASSWORD` in `backend/apps/accounts/management/commands/seed_demo.py`; do not publish it.

## 4. Two agents in one repo: the worktree

`D:\social_medial-wt\agent-b` is a **git worktree** (not a clone) so two agents can work the same
repo without clobbering each other. Full brief: `D:\social_medial-wt\HOW-TO-RUN.md`.

| | main folder | `agent-b` worktree |
|---|---|---|
| path | `D:\social_medial` | `D:\social_medial-wt\agent-b` |
| Next | `:3000` | `:3001` (`EXPOSING_API_ORIGIN=http://127.0.0.1:8002 npx next dev -p 3001`) |
| Django | `:8001` | `:8002` (`MEDIA_DISK=D:/social_medial/backend/media` — worktree media is empty) |
| Postgres | `exposing` @ `:5434` | **same database, shared** |

Rules learned the hard way:
- **Never** run `flush`, `seed_demo`, or anything truncating from the worktree — it destroys the
  other agent's in-flight repro. `makemigrations` is fine but collides on merge; coordinate.
- Open **`http://127.0.0.1:3001`**, not `localhost:3001` — cookies key on host, so this keeps two
  separate auth jars.
- `node_modules` is installed in the worktree; it borrows `D:/social_medial/backend/.venv`.

## 5. State snapshot — 24 Nov 2026

**Git:**
- Baseline for the 24 Nov email/auth/card batch: `main` and `origin/main` @ `b2d5f2e` "Use an
  existing icon on warning details". Verify `HEAD` after the batch commit rather than treating this
  baseline as the current tip.
- `agent-b` still points at `f6b8245`, but its neutral Google chip and field-level signup errors
  are already represented on `main`; the old "merge agent-b" to-do is closed. Branch pointers can
  differ after equivalent changes land, so inspect content before reopening that work.
- The main working tree also contains unrelated warning-banner/comment-report edits plus QA
  leftovers. Stage explicit paths for the current batch; never stage `.qa/` or `.qoder/`.

**Live deployment:**
- Member site: **https://exposing.neptech.online** (Vercel project) → `https://social-media-idea.vercel.app` origin.
- Backend: Render free tier, `https://social-media-idea.onrender.com`, deployed from `main`.
- Staff console: separate Vercel project `https://admin-blue-three-56.vercel.app`.
- Free-instance sleep held off by a cron-job.org ping on **`/api/ping/`** (15 B, anonymous,
  never throttled, answers HEAD too — cron-job.org caps output at 64 KB and HEAD-probes).
- `exposing.neptech.online` resolves to the cPanel/shared host IP family used for the other
  project; DNS + AutoSSL (Let's Encrypt) + forced HTTPS were confirmed working.

## 6. Feature status

### Shipped and browser-verified (Demo/`qa.mjs` 261–265, `integration_qa` 37/37, `batch_verify` 33/33, `desktop_qa` 34/34, `auth_qa` 42/42, sections E/F, ~215 Django tests green at `f764e69`)

- **Feed** — For you / Following tabs moved into the top bar (kills the old `home-header` card and
  its gap); audience filtering (public vs followers-only); windowed pagination (10 + prefetch);
  newest-first; scroll-up collapses the tab row for more room.
- **Posts & media** — Post/Reels chooser on create, 10 photos / 3 videos, 150 MB cap, draft media;
  separate `/create` page; media viewer is **horizontal** swipe (vertical swipe was leaking to the
  reel rail below); single video autoplays, mixed photo+video requires a tap and opens as an
  individual video.
- **Reels** (`/video`) — TikTok-style scroll-snap + preload, react from the player, share sheet
  parity with posts, long-press popup (0.5×/1×/1.5×/2×, Report, Block), full-screen skeleton while
  loading, index-aware entry (`startIndex`), clip count pill **removed**, view counter **removed**.
- **Reactions** — press-and-hold opens the animated picker; summary row above the action buttons
  shows up to 3 overlapping reaction discs + names, **"You" first, then people you follow, then
  "and N others"**; prints a bare number when no follower reacted; only the emojis actually used on
  that post appear; like turns blue; no grey card behind any of the four icons.
- **Comments** — nested replies with 4-then-4 "view more" paging, `@name` in blue, author badge
  (blue, pencil icon, on the name line, outside the card), per-reaction emoji counts instead of a
  blend number, emoji picker that does not drop the keyboard, keyboard-safe sheets via
  `ViewportSync` CSS vars (`--visible-height`, `--visible-top`, `--keyboard-bottom`,
  `data-typing`), composer stays in view on the post page, scroll-lock behind dialogs.
- **Share** — `ShareDialog` with multi-select (brand tick + tint), one confirm for the whole
  selection, chat link card with preview image, mobile-sized sheet, never auto-sends.
- **Chrome** — desktop rail order: Home, Notifications, Search, Video, Marketplace, More, Wallet,
  Settings, Post, account row (packed from top; single 18px break above Post; account row sits 6px
  off the floor; rail is non-scrolling); drawer scroll position persists across navigation;
  top-right dark-mode + language switch (**Eng / नेपाली** toggle, desktop only).
- **Pull-to-refresh** — page-level, not Home-only: every mounted `useList` registers in a counted
  `held` registry and `refreshHeldLists()` drains it; spinner-only (no label), centred, then
  skeleton, then new content.
- **Profile** — `/u/[username]` with reels grid, followers/following pages, About panel restyled,
  user-card merge, **image cropper before upload** (`ImageCropper.tsx`, two round −/+ buttons
  around a tappable `%`, measured against the stage's border-box padding), cover upload affordance
  is the whole banner, no auto-copy of avatar into cover, "Upload cover" on white when empty,
  remove profile/cover photo without replacing, own-profile never shows "Request to follow".
- **Private accounts & follow flow (spec-compliant, per client's numbered contract)** —
  `Requested` state, counts do not move until approval, withdraw silently, request lands in
  Follow Requests, confirm/decline, follow-back offered after accepting, a request that was
  answered/deleted server-side no longer 404s on Confirm (`follows/views.py`), locked-profile
  payload keeps `id` so `own` detection works, "1 Posts" vs "No posts yet." count mismatch fixed
  (`profiles/views.py:90`), auto-read of notifications for actions you already took.
- **Auth** — email OTP signup + verification; three wrong passwords lock the **account and the
  guessing browser/device** for 5, 60, then 360 minutes within a 24-hour strike window. Password
  locks no longer ban the public IP, so a household or mobile carrier is not locked out by one
  member. Signup, Google sign-in and reset still read account/device/deliberate manual-IP bans.
  A shared-address login flood cap remains at 10 attempts per minute. No unlock-code link
  (auto-expiry only); blocked state hides signup/forgot-password; `/forgot` is a
  one-thing-at-a-time wizard (new password field only after OTP verifies), 2-minute resend cooldown
  with countdown, rate-limited on reset/OTP/resend; strong-password rules and previously-used
  rejection; session never auto-expires for a logged-in member (logout is manual), admin seats
  stay signed in until manual logout/tab close/device shutdown; Google sign-in via FedCM
  `renderButton` (One Tap is silently suppressed on mobile and once per day on desktop).
- **Wallet / coins** — `/wallet` page (no suggested-for-you column), append-only ledger with a DB
  trigger, coin history / request / bank transfer / QR as separate sections + pages.
- **Marketplace** — full-page listing width, 500-word description cap with "see more" after 5
  lines, 5-image max, page behind the create form doesn't scroll, share opens the post share sheet.
- **Promotions** — buy-on-compose, per-campaign analytics page with edit, **real targeting engine**
  wired to age / country / min-age + engagement likelihood (prior lives, views, saves, comments).
- **Staff console Part 6 (all of it, `678c3ab`, 319/319 green)** — RBAC (Superadmin/Admin/
  Moderator), TOTP required for staff, per-screen permission re-check, user directory with
  row→page detail views, per-user record page (posts/comments/account/Act-on-this-account with a
  confirm dialog before any action), reports/flags queue, coins + refunds, ledger, exports
  (CSV via proper content negotiation — DRF was 406-ing `Accept: text/csv`), audit log, policy,
  pricing/packages, algorithm desk, welcome notices, spam, limits, dense flat tables, staff created
  by superadmin with a temp password that **must** be changed at first sign-in, email-only staff
  login, seat recovery by mail.
- **Moderation notices** — durable `PublicNotice` on post / comment / listing / account with
  **public or private audience**, banners render on the content, suspension removes the post from
  others' feeds and the owner's profile plus a timestamped notification, wording desk edits reach
  the live site, all writes audited.
- **Branded transactional email (24 Nov batch)** — shared HTML + plain-text renderer with the
  Exposing logo, red `#E40104`/black styling, support email/phone/form and footer. Welcome mail is
  queued after email or Google signup; coin receipts after either approval path credits a wallet;
  account suspension/warnings and post/comment/listing removal/warnings reach the owner; promotion
  approval mails the campaign owner. Warning opt-out is respected, suspension/removal mail is not,
  and duplicate decisions send no second mail. Queueing happens after the business write and never
  puts the mail provider on the request thread.
- **Shared-IP lockout correction (24 Nov batch)** — password trips and staff account suspensions no
  longer create IP bans. Migration `accounts/0009_remove_automatic_ip_bans` deletes old `lock`/`admin`
  IP-ban rows while preserving deliberate `manual` bans. NAT/CGNAT explains why the old behavior
  could block everyone on one Wi-Fi or mobile carrier.
- **Auth card sizing (24 Nov batch)** — sign-in/sign-up/welcome cards are wider and taller with
  larger spacing and type; the first-load welcome card appears only after authentication.
- **Media durability** — Render free tier wipes disk on redeploy, so uploaded images are stored
  **in the Postgres DB** and served from there (`backend/apps/common/media.py`,
  `sync.py`, `/media/uploads/<hash>.png`). S3 is explicitly deferred. Also fixed: PNG files that
  were actually JPEG bytes being served with the wrong MIME type.

### Landed but awaiting the client's own browser pass

- Signup field-level errors + auto-scroll/focus, and the neutral login-page-only "Sign in with
  Google" chip, are present on `main`.
- Enlarged auth cards and the signed-in-only welcome card need a visual pass on desktop/mobile.
- Branded event mail passes focused locmem tests; real Resend inbox delivery still needs a live
  provider check. Mail uses **HTTPS to Resend** because Render blocks outbound SMTP on
  25/465/**587**.

## 7. Known bugs, gaps and traps (do not rediscover these)

1. **Worktree branch pointers are not a to-do list.** Equivalent signup/Google changes are already
   on `main` even though `agent-b` still points at `f6b8245`. Verify content and ancestry before
   merging or redoing work.
2. **Shared DB drift already bit once** — a NOT NULL seeded column from one agent's migration
   500-ed every signup on the other's stack. Check `manage.py makemigrations --check` before
   trusting a fresh clone.
3. **PBKDF2 at Django 6's 1.5 M-iteration default cost 3.4 s per sign-in** on this CPU class;
   the work factor was lowered deliberately. Don't "restore security defaults" blindly.
4. **Reels/z-index trap:** `.reels-page` is `position: fixed` at `z-index: 1200` while every
   portal sheet inherits `.modal-overlay` at `100` — sheets opened from reels render *behind the
   video* and taps look dead.
5. **CSS specificity traps:** later flat `position: relative` rules have silently clobbered the
   post-page composer-tracking rules; `display: flex` on a `<td>` breaks its bottom border.
6. **`:hover` sticks after a tap on touch**, which is why reaction buttons kept showing a grey
   card; and the like button takes focus after a desktop reaction pick.
7. **`parse_http_date('')`** was the "every picture is broken" root cause on the live host.
8. **Render free tier:** no shell access (migrations must run inside the Build Command), disk is
   wiped each deploy, and outbound SMTP is blocked. Build command is
   `pip install -r requirements.txt && python manage.py migrate --noinput && python manage.py
   collectstatic --noinput && python manage.py seed_demo` — **`--purge` was removed on purpose**
   (it re-seeded 612 posts and would overflow the free tier); demo media defaults are now
   `--photos 16 --reels 4`. Start command is `daphne -b 0.0.0.0 -p $PORT exposing.asgi:application`
   (Channels need ASGI). `.python-version` must be at the **repo root** or Render builds 3.14.
9. **Google OAuth:** origins are one-per-row (press Enter), not comma-separated; the client ID
   must be a real OAuth *web* client ID (`950092766429-…apps.googleusercontent.com`), not a
   Firebase secret; a brand-new client takes minutes-to-hours to propagate; One Tap suppresses
   itself per-day and on mobile.
10. **Vercel builds one root directory per project** — hence two projects for member site +
    staff console. `vercel.json` rewrite gotcha: `:path*` does not match a URL ending in a slash,
    and Django requires the trailing slash.
11. **`DisallowedHost` on preview URLs** — Vercel branch previews send a host Django never listed;
    the fix lives in `settings.py` as a testable rule, not a dashboard edit.
12. **QA harness port fights** — three agents, one `:3000`. The demo suite was made
    port-configurable and can serve a production build on a private port (e.g. `:3005`); chat
    sockets refuse any origin but `:3000` unless you add the extra origins to the API.
13. **Dev-server latency is not app latency** — first click pays a 2–3 s on-demand compile;
    measure against `next start`, not `next dev`.
14. Admin console is **two apps, one domain is enough** in production — the split is a Vercel
    artifact (cookie names decide, not domains).
15. Chat transcripts show two `操作未获得授权` ("operation not authorized") markers — those were
    sandbox/permission refusals in Desktop, not product bugs.
16. **Locmem is not delivery proof.** Focused email tests verify rendering, recipients, event
    wiring and duplicate suppression, but only a real Resend inbox test proves provider delivery.
17. **Django 6.1 alternatives are `EmailAlternative(content, mimetype)` objects.** Tests must read
    `.content`/`.mimetype`; tuple unpacking still works in the Resend adapter.

## 8. Open threads — pick one up here

Ordered by how recently the client touched them:

1. **Live inbox verification for branded event emails** — send real welcome, coin-receipt,
   moderation and promotion-approval messages through Render/Resend; confirm sender identity,
   links, logo rendering and inbox placement. *(newest, 24 Nov email batch)*
2. **Admin warning-banner browser pass** — implementation exists: warning banner at the top of the
   post card, account warning on the owner's profile, admin-selected public/private audience,
   suspended content removed from feeds/profile, and notification deep-links. Verify the client
   flows in the browser rather than rebuilding the `PublicNotice` model.
3. **Resend/Gmail deliverability** — confirm the HTTPS backend, sender domain/SPF/DKIM and that
   OTP/reset mail reaches real inboxes.
4. **Auth-card visual pass** — verify the larger sign-in/sign-up/welcome cards on desktop/mobile
   and confirm the welcome card never appears on signed-out auth screens.
5. **Client-demo hardening** — pictures must not break for the client's first look ("if the image
   is broken it not leave good impression on the client"); DB-backed media is the stopgap until
   **S3**, which the client deferred.
6. **Activate Marketplace and Video** when the client says so (currently flag-hidden by request).
7. Client-owned accounts, real domain for production OAuth, and the feedback contact are still
   **awaited from the client**.
8. `.qoder/` exists and is untracked — keep it local; never commit it or treat it as product source.

## 9. Other projects inside the same Desktop archive

Three of the nine sessions belong to different repos, recorded here only so their names don't
look like stray work:

| Sessions | Project | Where | State as of 21 Nov |
|---|---|---|---|
| `508e279c`, `7daa8c3b` | **Dr. Ramesh Kandel portfolio** ("little-nest-family-connect", React+Vite site, Django+DRF backend, Vite admin panel) | `D:\doctors portfolioV2` | Deployed: site on `drkandel.vercel.app` → later `rameshkandel.com`, backend on Render, MariaDB/Postgres question settled (host runs Postgres 10.23 client → **too old for Django 5.2**, which needs 14+; engine choice recorded in `.env`), Resend mail, IndexNow auto-ping (202 Accepted), `sitemap.xml`/`robots.txt`/`llms.txt`, handover PDF built with reportlab. Open at the time: appointment-confirmation email silently dying in its background thread, `last_login` never written by the custom JWT/OTP path, nested serializer validation shown as a generic 500 instead of a real toast |
| `c6141424` | **Himal Consultancy** single-page site | `D:\himal-consultence\index.html` | Waiting on the client to pick a redesign direction from the `/impeccable` decision page; npm `impeccable` install hit a broken bin shim under Git Bash and an unapproved operation |

Nothing from those two projects should be applied to Exposing without asking — different client,
different contract.

## 10. Regenerating this file

The Desktop archive is queryable read-only; the probes used live in `.qa/` and are throwaway:

```bash
# schema + counts
backend/.venv/Scripts/python.exe .qa/_history_probe.py
# session titles + auto-recaps
backend/.venv/Scripts/python.exe .qa/_history_sessions.py
# full chronological dump of all 9 sessions + per-session file-change table
$env:PYTHONIOENCODING="utf-8"; backend/.venv/Scripts/python.exe .qa/_history_dump.py
#   -> .qa/_handoff_dump.txt (~260 KB, 1336 lines: [U]ser / [A]ssistant / [S]ystem lines, capped)
```

Database: `%APPDATA%\com.qoder.app.stable\main.sqlite` — tables
`chat_sessions` (9), `chat_session_messages` (1008), `chat_session_recaps` (9),
`chat_session_search_segments` (3359, the clean visible-text index),
`turn_file_change_sets` / `turn_file_change_files` (76 / 996 — exactly which files each agent
batch touched, with +/- line counts). Open it with `file:...?mode=ro`; the IDE's own state is a
different directory (`%APPDATA%\Qoder`) and holds none of this.

---

*Keep this file honest: when a thread closes, move it into §6 and trim §8. If you disagree with
something recorded here, verify against the code or the dump rather than editing from memory.*
