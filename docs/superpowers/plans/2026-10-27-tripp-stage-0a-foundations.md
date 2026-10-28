# Tripp Stage 0a — Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add append-only audit logging, a consent notice with logged acknowledgement, non-admin anti-leak UI, and a Supabase keep-alive — all without introducing Storage, Edge Functions, encryption, or Realtime.

**Architecture:** Extend the existing model: a private `tripp` schema reached only through SECURITY DEFINER `m_*` functions that the browser calls with the publishable key, plus a static `site/`. Audit rows are written only by those functions and are hash-chained for tamper-evidence. UI changes are plain additions to `site/app.js` / `site/styles.css`. Keep-alive is a GitHub Actions cron that pings two public endpoints.

**Tech Stack:** PostgreSQL (Supabase, project `ohhkzjsdabdimlrgnagw`), vanilla ES5-style JS (`site/app.js`), GitHub Actions, Node `pg` for tests (BEGIN/ROLLBACK on the live DB).

**Spec:** `docs/superpowers/specs/2026-10-27-tripp-media-and-audit-design.md` (§6 audit, §9/§9a anti-leak, §10 keep-alive, §14 Q3 consent). Read it alongside this plan.

## Deferred from Stage 0 (deliberate)

- **Retention window + legal-hold** (design §14 Q2) moves to **Stage 0b**: there is
  little to purge until media/attachments exist, and the retention *duration* is
  set only after the owner's legal consult. The legal-hold flag and a parameterized
  purge function are built alongside the media they protect.

## Global Constraints

- No new Supabase subsystems in Stage 0a: no Storage, Edge Functions, Realtime, or encryption. (Those are Stage 0b.)
- No password composition rules anywhere; any password value is accepted (existing invariant).
- Audit tables are append-only: functions only `INSERT` into them; never expose an `UPDATE`/`DELETE` path for `tripp.visits` or `tripp.events`.
- The admin is logged on the same footing as everyone else — no exemption from audit rows.
- Repo and schema stay public; no secret may be added to `site/` or the repo (keep-alive uses only already-public keys).
- Schema file `supabase/schema.sql` must stay idempotent (safe to re-run), matching its current header promise.
- Tests run inside `BEGIN ... ROLLBACK` against the live DB; never read message bodies, count only; restore any mutated hash string exactly in a `finally`.
- Browser JS matches the existing ES5 idiom in `site/app.js` (no new build step, no framework).

## Review Focus

- **Geo/UA enrichment must never block or fail login.** A slow or failed IP lookup, or an absent/garbage `User-Agent`, must still produce a visit row and a valid session. → Task 4 tests login success with enrichment unavailable and with a null/empty UA.
- **Hash-chain integrity across concurrent inserts.** Two logins racing must not produce two rows claiming the same `prev_hash` such that the chain silently forks. → Task 2 tests sequential chaining and a serialized-append guarantee.
- **Failed logins are still recorded.** A denied/locked `m_open` must write a `login_failed` visit+event (scope null) — the denial pattern is evidence. → Task 4 tests the denied and locked paths write rows.
- **Focus-loss blank is synchronous and fires before unlock completes.** A non-admin tab hidden mid-read must blank *before* a paint that could be captured, and must not wipe an admin session. → Task 6 e2e asserts content hidden on `visibilitychange` for guest, not for admin.
- **Consent acknowledgement is required once per session and is itself logged.** A session that never acknowledges cannot read/post; the ack writes an event exactly once. → Task 5 tests the gate and the single ack event.

---

### Task 1: Supabase keep-alive (GitHub Actions)

**Files:**
- Create: `.github/workflows/keepalive.yml`
- Create: `scripts/keepalive.mjs`
- Test: `scripts/keepalive.test.mjs`

**Interfaces:**
- Produces: `ping(project: {url: string, key: string}) -> Promise<{ok: boolean, status: number}>` in `scripts/keepalive.mjs`; pings `${url}/rest/v1/` with `apikey` header, adding `Authorization: Bearer <key>` only when the key does not start with `sb_` (mirrors `site/app.js:75`).

- [ ] **Step 1: Write the failing test** — `ping` returns `{ok:true}` for a mocked 200, `{ok:false}` for a mocked 500, and sets `Authorization` only for a non-`sb_` key. Two project configs: Tripp (`https://ohhkzjsdabdimlrgnagw.supabase.co`, `sb_publishable_...`) and HOPE (`https://rjzzumzzdlsdfvyntlzu.supabase.co`, legacy `eyJ...` anon JWT).
- [ ] **Step 2: Run test, verify it fails** — Run: `node --test scripts/keepalive.test.mjs` → FAIL (module/function missing).
- [ ] **Step 3: Implement `ping` and a `main()`** that pings both projects and exits non-zero if either fails. Keys are public, so they live in the script, not in secrets. Use `fetch`.
- [ ] **Step 4: Run test, verify it passes** — Run: `node --test scripts/keepalive.test.mjs` → PASS.
- [ ] **Step 5: Author the workflow** — `keepalive.yml`: `on.schedule` cron every 3 days (`0 7 */3 * *`) plus `workflow_dispatch`; one job on `ubuntu-latest` running `node scripts/keepalive.mjs`.
- [ ] **Step 6: Commit** — `git add .github/workflows/keepalive.yml scripts/keepalive.mjs scripts/keepalive.test.mjs && git commit -m "feat: supabase keep-alive for Tripp and HOPE"`

---

### Task 2: Audit schema + append helper (hash-chained)

**Files:**
- Modify: `supabase/schema.sql` (add after the `tripp.attempts` block, before the version-1→2 migration `do $$`)
- Test: `supabase/tests/audit_chain.test.mjs`

**Interfaces:**
- Produces tables `tripp.visits` and `tripp.events`, and `tripp.audit_append(p_scope bigint, p_kind text, p_type text, p_ref bigint, p_detail jsonb) returns bigint` (returns the new row id). `p_kind` is `'visit'` or `'event'` and routes to the right table. Each row stores `prev_hash text`, `row_hash text`, computed as `sha256(canonical_fields || prev_hash)`; `prev_hash` is the previous row's `row_hash` in that table (empty string for the first). Appends are serialized via `pg_advisory_xact_lock` on a per-table key so the chain cannot fork.

- [ ] **Step 1: Write the failing test** — against a throwaway schema in BEGIN/ROLLBACK: three sequential `audit_append` calls produce rows whose `prev_hash` equals the prior `row_hash`; recomputing `sha256` over the stored canonical fields + prev_hash reproduces each `row_hash`; the first row's `prev_hash` is `''`.
- [ ] **Step 2: Run test, verify it fails** — Run: `node --test supabase/tests/audit_chain.test.mjs` → FAIL (objects missing).
- [ ] **Step 3: Implement the tables and `tripp.audit_append`** in `supabase/schema.sql`. Columns — `visits`: id, at timestamptz default now(), scope bigint null, ip text, isp text null, geo jsonb null, os_family text null, browser_family text null, user_agent text null, prev_hash, row_hash. `events`: id, at, scope bigint null, type text, ref bigint null, detail jsonb null, prev_hash, row_hash. Both RLS-enabled with no policies (owner-only), like the existing `tripp` tables. `audit_append` takes the advisory lock, reads the last `row_hash`, computes the new hash with `extensions.digest`, inserts, returns id. Keep idempotent (`create table if not exists`, `create or replace function`).
- [ ] **Step 4: Run test, verify it passes** — Run: `node --test supabase/tests/audit_chain.test.mjs` → PASS.
- [ ] **Step 5: Commit** — `git add supabase/schema.sql supabase/tests/audit_chain.test.mjs && git commit -m "feat: append-only hash-chained audit tables"`

---

### Task 3: User-agent parsing helper (pure SQL)

**Files:**
- Modify: `supabase/schema.sql` (internal helpers section)
- Test: `supabase/tests/ua_parse.test.mjs`

**Interfaces:**
- Produces `tripp.ua_parse(p_ua text) returns table(os_family text, browser_family text)` — simple, documented pattern matches. OS: Windows / macOS / iOS / Android / Linux / other. Browser: Edge / Chrome / Firefox / Safari / other (order matters: Edge before Chrome, Chrome before Safari). Null/empty UA → (`unknown`, `unknown`).

- [ ] **Step 1: Write the failing test** — table of representative UA strings → expected (os, browser), including a Windows/Edge string (must not misclassify as Chrome), an iPhone Safari string, an empty string → unknown/unknown.
- [ ] **Step 2: Run test, verify it fails** — Run: `node --test supabase/tests/ua_parse.test.mjs` → FAIL.
- [ ] **Step 3: Implement `tripp.ua_parse`** using `case`/`position`/`ilike`. Pure, `stable`, `set search_path = ''`. Document the match order.
- [ ] **Step 4: Run test, verify it passes** — Run: `node --test supabase/tests/ua_parse.test.mjs` → PASS.
- [ ] **Step 5: Commit** — `git add supabase/schema.sql supabase/tests/ua_parse.test.mjs && git commit -m "feat: user-agent family parser"`

---

### Task 4: Wire audit into the m_* functions (+ best-effort geo enrichment)

**Files:**
- Modify: `supabase/schema.sql` — `m_open`, `m_post`, `m_msg`, `m_conv_save`, `m_conv_delete`, `m_admin_key`; add `tripp.enrich_visit(bigint)`
- Test: `supabase/tests/audit_wiring.test.mjs`

**Interfaces:**
- Consumes: `tripp.audit_append` (Task 2), `tripp.ua_parse` (Task 3), `tripp.client_ip()` (existing).
- Produces: every auth/action path writes audit rows. `m_open` success → a `visit` row (scope, ip, ua parsed, prev enrichment null) + an `event` `login`; denied/locked → a `visit` (scope null) + `event` `login_failed`. `m_post` → `event` `message` (ref = conversation id). Admin actions → `event` `admin_hide|admin_unhide|admin_archive|admin_unarchive|admin_delete` (from `m_msg`), `admin_conv_save`, `admin_conv_delete`, `admin_key_change`. `tripp.enrich_visit(p_id)` best-effort fills `isp`/`geo` via `pg_net` to a geo-IP endpoint; failure leaves them null and never raises. The user-agent reaches SQL via a `request.headers` read inside `m_open` (same mechanism as `client_ip()`), not a new parameter, so the browser contract is unchanged.

- [ ] **Step 1: Write the failing tests** — in BEGIN/ROLLBACK with a test admin hash swapped in (restore in `finally`): a successful `m_open` adds one `visit` and one `login` event with the right scope; a denied `m_open` adds a `login_failed` row with scope null; `m_post` adds a `message` event; `m_msg(...,'hide')` adds `admin_hide`. Assert counts only, never bodies.
- [ ] **Step 2: Run tests, verify they fail** — Run: `node --test supabase/tests/audit_wiring.test.mjs` → FAIL.
- [ ] **Step 3: Implement the wiring** — add `audit_append` calls at the decision points in each function, reading UA from `current_setting('request.headers', true)`. Add `tripp.enrich_visit` and call it after the visit insert (fire-and-forget; wrap in a sub-block that swallows errors). `pg_net` guarded by `create extension if not exists`; if unavailable, enrichment is a no-op. Login path must not depend on enrichment success.
- [ ] **Step 4: Run tests, verify they pass** — Run: `node --test supabase/tests/audit_wiring.test.mjs` → PASS.
- [ ] **Step 5: Commit** — `git add supabase/schema.sql supabase/tests/audit_wiring.test.mjs && git commit -m "feat: write audit rows from all m_* paths with best-effort geo enrichment"`

---

### Task 5: Consent notice + logged acknowledgement

**Files:**
- Modify: `supabase/schema.sql` — new `public.m_ack(p_token text)`; grant like the other `m_*`
- Modify: `site/index.html` (notice markup on the lock screen), `site/app.js` (gate + ack call), `site/styles.css`
- Test: `supabase/tests/ack.test.mjs`

**Interfaces:**
- Consumes: `tripp.session_scope`, `tripp.audit_append`.
- Produces: `public.m_ack(p_token text) returns json` — validates the token, writes one `event` `consent_ack` for that session scope, returns `{ok:true}`; idempotent per session (a second call does not double-log — track via a `tripp.sessions.acked_at` column set on first ack). The lock screen shows the §14-Q3 notice text and a button; `app.js` calls `m_ack` immediately after a successful `m_open` and before showing the portal.

- [ ] **Step 1: Write the failing test** — `m_ack` with a valid token writes exactly one `consent_ack` event and sets `acked_at`; a second `m_ack` writes no further event; `m_ack` with a bad token returns `{ok:false, error:'expired'}`.
- [ ] **Step 2: Run test, verify it fails** — Run: `node --test supabase/tests/ack.test.mjs` → FAIL.
- [ ] **Step 3: Implement** — add `acked_at timestamptz` to `tripp.sessions`; implement `m_ack`; revoke-all + grant execute to anon, authenticated (match existing pattern). Add the lock-screen notice + acknowledge control in `index.html`/`styles.css`, and in `app.js` call `m_ack` after login success. Notice copy: short statement that access and activity (IP, approximate location, device) are logged and communications may be retained; acknowledgement recorded.
- [ ] **Step 4: Run test, verify it passes** — Run: `node --test supabase/tests/ack.test.mjs` → PASS.
- [ ] **Step 5: Live UI check** — load the deployed page, confirm the notice shows, acknowledging reveals the portal, and a `consent_ack` event is present (count only).
- [ ] **Step 6: Commit** — `git add supabase/schema.sql site/index.html site/app.js site/styles.css supabase/tests/ack.test.mjs && git commit -m "feat: consent notice with logged acknowledgement"`

---

### Task 6: Non-admin anti-leak UI (focus-loss blank+lock, identity watermark)

**Files:**
- Modify: `site/app.js` (blur/visibility handlers, watermark render), `site/styles.css` (blank overlay, tiled watermark), `site/index.html` (watermark + blank layers)
- Test: `supabase/tests/antileak.e2e.mjs` (or extend the existing live e2e harness)

**Interfaces:**
- Consumes: `role`, `token`, and the existing lock/unlock functions in `app.js`.
- Produces: for `role === 'guest'` only — a `visibilitychange`/`blur`/`pagehide` handler that synchronously adds a `blanked` class (CSS hides all content instantly) and then calls the existing lock routine (wipes `token`, returns to lock screen); a tiled semi-transparent watermark overlay stamped with the conversation label + current timestamp + IP (IP returned in the `m_list`/`m_open` payload for display). Admin sessions install none of this.

- [ ] **Step 1: Write the failing e2e checks** — guest session: dispatching `visibilitychange` (hidden) adds `blanked` and clears the token; admin session: the same dispatch does neither; guest view contains a watermark element bearing the label and IP; admin view does not.
- [ ] **Step 2: Run checks, verify they fail** — Run: `node --test supabase/tests/antileak.e2e.mjs` → FAIL.
- [ ] **Step 3: Implement** — add the layers in `index.html`; CSS `.blanked *{visibility:hidden}` on a top-level container plus a solid cover, and a `.watermark` tiled overlay (`pointer-events:none`, low opacity, `position:fixed`); in `app.js` install the guest-only handlers on login and remove them on lock. Keep it ES5-style. Return the caller IP in the session payload for the stamp.
- [ ] **Step 4: Run checks, verify they pass** — Run: `node --test supabase/tests/antileak.e2e.mjs` → PASS.
- [ ] **Step 5: Live UI check** — as a guest, switch tabs and confirm instant blank + lock; confirm the watermark is visible and legible; confirm admin is unaffected.
- [ ] **Step 6: Commit** — `git add site/index.html site/app.js site/styles.css supabase/tests/antileak.e2e.mjs && git commit -m "feat: non-admin focus-loss blank+lock and identity watermark"`

---

### Task 7: Deploy and end-to-end verification

**Files:** none (uses `scripts/deploy.ps1`)

- [ ] **Step 1:** Apply the updated `supabase/schema.sql` to the live DB (idempotent re-run) and confirm no errors; confirm the schema advisor warnings are only the known SECURITY DEFINER ones.
- [ ] **Step 2:** `pwsh scripts/deploy.ps1` to publish `site/` to `gh-pages`; clear cache / version-stamp per the existing deploy flow.
- [ ] **Step 3:** Live e2e: a full guest login → notice ack → post → tab-switch blank+lock; an admin login → each moderation action; confirm audit rows accrue (count only) and the hash chain verifies.
- [ ] **Step 4:** Confirm the keep-alive workflow runs green via `workflow_dispatch`.
- [ ] **Step 5: Commit** any version-stamp/deploy artifacts — `git commit -m "chore: deploy Stage 0a"`.
