# Tripp Stage 0 — Audit Logging, Encrypted Attachments, Anti-Leak, Keep-Alive — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver spec §11 Stage 0. It ships in two parts, each releasable on its own.
- **0a:** keep-alive, a tamper-evident audit log of every visit and action, a consent notice, and the non-admin focus-loss lock with a watermark.
- **0b:** client-side-encrypted file attachments, the key store, and retention with a legal hold.

**Architecture:** The site stays static on GitHub Pages. Two new Supabase Edge Functions run as server code we control:
- `open` replaces the browser's direct `m_open` call. It does sign-in and enriches the visit with geo and user-agent data.
- `media` issues signed Storage URLs and clears out deleted files.

Every audit row is written by SECURITY DEFINER SQL into append-only, hash-chained tables. Files are encrypted in the browser with AES-GCM under a per-conversation key. That key is wrapped twice: once for the owner (RSA-OAEP, under a private key that is itself wrapped by the passphrase-derived KEK) and once for the guest (under a key derived from the conversation password).

**Tech Stack:**
- Postgres (Supabase), plpgsql, pgcrypto, pg_cron
- Supabase Storage and Edge Functions (Deno; `npm:postgres@3.4.4`, `npm:@supabase/supabase-js@2.45.4`)
- Browser WebCrypto, vanilla ES5-style JS (matching `site/app.js`)
- Node 25 (`node --test`, `pg@8.13.1`)
- Docker (keep-alive container on the owner's machine)

**Spec:** `docs/superpowers/specs/2026-10-27-tripp-media-and-audit-design.md` (read it alongside this plan)

## Decisions this plan makes that the spec left open (approve or change before Task 1)

- **D1 — Guest access to encrypted files.** The spec puts the KEK only in the owner's hands, but guests must read and write files too. Each conversation key (DEK) is stored twice in the key store:
  - `wrapped_owner`: RSA-OAEP-3072 under the owner's public key. The private key is stored only wrapped under the KEK.
  - `wrapped_guest`: AES-GCM under PBKDF2(conversation password, per-conversation salt).

  A guest's browser can create the DEK on the guest's first sign-in. The admin rewraps the guest copy whenever they change a conversation's password, which needs the admin's files to be unlocked first. The trade-off: a stolen database lets an attacker brute-force a weak guest password offline. Today's bcrypt hash already allows the same thing.
- **D2 — Sign-in moves into the `open` Edge Function.** `public.m_open` is dropped. Sign-in, the geo lookup, and the user-agent parse then write one append-only visit row instead of writing a row and editing it later.
- **D3 — KDF is PBKDF2-SHA256 at 600,000 iterations (WebCrypto), not Argon2id.** WebCrypto has no Argon2, and a WASM Argon2 build would need `'wasm-unsafe-eval'` in the CSP. The KDF name and iteration count are stored with each wrapped key, so this can be upgraded later. The keyfile factor plugs in as `SHA-256(keyfile) ‖ UTF-8(passphrase)`, and Stage 0 passes `keyfile = null`.
- **D4 — Geo provider is ip-api.com free tier (spec Q4 is still open).** It sits behind a single `lookupGeo(ip)` function, so swapping providers touches one file. Two costs: the free tier is non-commercial only, and it is plain HTTP, so visitor IPs cross the network unencrypted between Supabase and ip-api.
- **D5 — Audit event types beyond the spec's list:** `logout`, `consent_ack`, `admin_unhide`, `admin_unarchive`, `admin_legal_hold`, `admin_retention_set`, `key_setup`, `retention_purge`. `call_start`, `call_answer`, and `call_end` are allowed now so Stage 3 needs no constraint change.
- **D6 — Retention deletes only the oldest stretch of each log** (the rows with the lowest ids). The purge stops at the first row that is inside the retention window or tied to a conversation under legal hold. It then writes a `retention_purge` event carrying the last purged `row_hash` as an anchor, and verification accepts a chain that starts at a recorded anchor. While `retention_days` is null (the default, until the lawyer sets it), nothing expires.
- **D7 — A minimal read-only admin audit viewer ships in 0a**, with a chain-verified indicator. Without it the log can't be seen at all. The "unread since last seen" catch-up waits for Stage 2.

## Owner action items for Stage 0

- **Database password** each working session. It goes in the env var `TRIPP_DB_PASSWORD` for that command only and is never stored.
- **Supabase personal access token**, needed to deploy Edge Functions: Dashboard → Account → Access Tokens. It goes in the env var `SUPABASE_ACCESS_TOKEN` per session and is never stored. This is not the OAuth link.
- **Final consent-notice wording** from you or the lawyer. Task 6 ships the placeholder text below as notice version 1.
- **Run the keep-alive on the Mac Studio:** copy `ops/keepalive/` there and run `docker compose up -d --build`. Rebuild after Task 12 adds the sweep.
- **Your files passphrase**, typed into the browser once at setup (after Task 12). Nobody else ever sees it.

## Global Constraints

- No application server. The site stays static under `site/` and is deployed with `pwsh scripts/deploy.ps1`.
- Supabase project `ohhkzjsdabdimlrgnagw`. HOPE project `rjzzumzzdlsdfvyntlzu` (legacy anon JWT).
- No password composition rules. Any non-empty password the owner sets is accepted.
- Repo and specs stay public. No secret ever goes into a committed file.
- Every new table lives in the private schema `tripp`, except the key store, which lives in its own schema `tripp_keys`. RLS is enabled with no policies. Browser access goes only through `public.m_*` functions that check a token. Each new `m_*` function revokes EXECUTE from `public` and grants it to `anon, authenticated`, the same way `supabase/schema.sql:481-501` does.
- SQL style follows `supabase/schema.sql`: tabs, `set search_path = ''`, fully qualified names, errors returned as `json_build_object('ok', false, 'error', '<code>')`, never raised to the browser.
- Browser JS style follows `site/app.js`: an IIFE, `'use strict'`, `var`, no build step, no external scripts. Each new browser error code gets an `ERRORS` entry.
- Audit tables are append-only. No function updates or deletes their rows, except `tripp.retention_purge` (D6).
- No function or test ever reads or prints message bodies. Tests count rows only.
- Limits: file 25 MB = 26,214,400 bytes of plaintext. Encryption chunk size is 1,048,576 bytes. Signed upload URLs live 120 s and signed download URLs 60 s.
- The non-admin focus-loss lock and the watermark never apply to admin sessions.
- Live call media is never recorded (spec Q1).
- No GitHub Actions or GitHub-hosted workflows, ever. Scheduled jobs run in Docker on the owner's machine, or in pg_cron inside Supabase.

## Review Focus

1. **The guest opens the OS file picker.** The window blurs, but the guest must not be locked out mid-attach. Picking a file and coming back keeps the session, while switching tabs or apps still locks. (Test: Task 7 Step 4.)
2. **Two sign-ins or events land at the same instant.** Two rows must never share a `prev_hash`. (Test: Task 3 `concurrent_chain` uses an advisory lock, checked in Task 3 Step 1.)
3. **The admin changes the password on a conversation that already has a key while files are locked.** The change must be refused (`needs_unlock`), not save silently and leave the guest unable to read anything. (Test: Task 11 Step 1.)
4. **An upload is reserved but never posted, or posted with a path from another conversation or a size that doesn't match.** `m_post` must reject it. (Test: Task 10 Step 1, `foreign_path`, `size_mismatch`.)
5. **The geo service is down or slow.** Sign-in must still succeed within the 1.5 s timeout plus normal latency, with geo fields set to `unknown`. (Test: Task 4 Step 1, `lookupGeo` timeout case.)

---

## File Structure

| File | Responsibility |
|---|---|
| `.gitignore` | Create: `node_modules/` |
| `package.json` | Create: dev dependency `pg@8.13.1`. Scripts `test:sql`, `test:js`, `db:apply` |
| `scripts/sql.mjs` | Create: applies `SCHEMA_FILES` in order, or runs them plus `tests/sql/*.sql` inside BEGIN/ROLLBACK |
| `supabase/schema.sql` | Modify: core functions gain audit calls. `m_open` is dropped. `m_post`, `m_list`, and `m_conv_save` gain attachment and key parameters |
| `supabase/audit.sql` | Create: `visits`, `events`, the hash chain, `open_session`, `verify_chain`, `m_audit`, `m_ping` |
| `supabase/keys.sql` | Create: schema `tripp_keys`, `m_keys`, `m_key_setup`, `m_key_conv`, `m_keys_backup` |
| `supabase/media.sql` | Create: bucket, `attachments`, `uploads`, `storage_trash`, `media_*` internals |
| `supabase/retention.sql` | Create: `settings`, legal hold, `retention_purge`, pg_cron job, `m_settings`, `m_conv_hold` |
| `supabase/functions/_shared/ua.js` | Create: `parseUserAgent` |
| `supabase/functions/_shared/geo.js` | Create: `lookupGeo` |
| `supabase/functions/_shared/http.js` | Create: `clientIp`, `cors`, `json` |
| `supabase/functions/open/index.ts` | Create: the sign-in Edge Function |
| `supabase/functions/media/index.ts` | Create: the signed-URL and sweep Edge Function |
| `supabase/functions/spike/index.ts` | Temporary (Task 1), deleted afterward |
| `site/crypto.js` | Create: `window.TrippCrypto` (all WebCrypto) |
| `site/app.js` | Modify: sign-in through `open`, consent, focus lock, watermark, audit viewer, attachments, key UI, hold and retention UI |
| `site/index.html`, `site/styles.css`, `site/config.js` | Modify: new elements, CSP, `functions` URL, notice |
| `scripts/deploy.ps1:36` | Modify: add `crypto.js` to the version-stamped files |
| `ops/keepalive/*` | Create: keep-alive container (Dockerfile, script, crontab, compose) |
| `tests/sql/*.sql` | Create: one file per task, `do $$ … assert … $$` blocks |
| `tests/js/*.test.mjs` | Create: `node --test` |

`scripts/sql.mjs` exports `SCHEMA_FILES = ['supabase/schema.sql', 'supabase/audit.sql', 'supabase/keys.sql', 'supabase/media.sql', 'supabase/retention.sql']` and skips any file that doesn't exist yet. Every SQL file stays safe to run more than once, the same as `schema.sql`.

---

# Part 0a — Audit, consent, anti-leak, keep-alive

### Task 1: Test harness + platform spike

Two things in this task are guessed rather than known. The spike settles both before anything is built on them.

**Files:**
- Create: `.gitignore`, `package.json`, `scripts/sql.mjs`, `tests/sql/000_harness.sql`, `supabase/functions/spike/index.ts`

**Interfaces:**
- Produces: `TRIPP_DB_PASSWORD=… node scripts/sql.mjs test [pattern]` runs every schema file and then each `tests/sql/*.sql` matching the pattern. Each test file runs in its own BEGIN/ROLLBACK. The script prints `PASS <file>` or `FAIL <file>: <message>` and exits non-zero on any failure. `node scripts/sql.mjs apply` runs the schema files in one transaction and commits.
- Produces: a written answer, recorded in this plan under Task 1, Step 6, to three questions:
  - (a) Inside an Edge Function, which `x-forwarded-for` entry is the real client IP when the client sends its own spoofed `x-forwarded-for`?
  - (b) Are `SUPABASE_DB_URL` and `SUPABASE_SERVICE_ROLE_KEY` present in the Edge runtime?
  - (c) Does `npx supabase@2.54.11 functions deploy --use-api` work without Docker?

- [ ] **Step 1:** Create `tests/sql/000_harness.sql` with `do $$ begin assert (select count(*) from tripp.admin_key) = 1, 'admin key row'; end $$;`. Create a second, temporary file `tests/sql/001_fail.sql` that runs `assert false, 'deliberate'`.
- [ ] **Step 2:** Run `npm install`, then `TRIPP_DB_PASSWORD=… node scripts/sql.mjs test`. Expected: `PASS 000_harness.sql`, `FAIL 001_fail.sql: deliberate`, exit 1. Delete `001_fail.sql` and run it again. Expected: exit 0.
- [ ] **Step 3:** Write `spike/index.ts`. It responds with JSON holding every request header whose name starts with `x-` and the boolean presence of each of `SUPABASE_DB_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_URL`. It never returns the values.
- [ ] **Step 4:** Deploy it with `npx supabase@2.54.11 functions deploy spike --project-ref ohhkzjsdabdimlrgnagw --no-verify-jwt --use-api`. Then run `curl -s -H "x-forwarded-for: 6.6.6.6" https://ohhkzjsdabdimlrgnagw.supabase.co/functions/v1/spike`. Compare against `curl -s https://api.ipify.org`.
- [ ] **Step 5:** Delete the spike with `npx supabase@2.54.11 functions delete spike --project-ref ohhkzjsdabdimlrgnagw` and remove the folder.
- [ ] **Step 6:** Record the answers here and choose `clientIp`'s rule from them: the entry that matches ipify even when the header is spoofed. If (b) fails, stop and report. D2 and Task 8 would have to change.
- [ ] **Step 7:** Commit: `git add .gitignore package.json package-lock.json scripts/sql.mjs tests/sql/000_harness.sql docs/superpowers/plans && git commit -m "Add SQL test harness; record Edge runtime spike results"`

### Task 2: Keep-alive (Tripp + HOPE)

The owner's standing rule: no GitHub Actions or GitHub-hosted workflows, ever. The keep-alive is a Docker container that runs on the owner's own machine (the Mac Studio).

**Files:**
- Create: `ops/keepalive/Dockerfile`, `ops/keepalive/keepalive.sh`, `ops/keepalive/crontab`, `ops/keepalive/compose.yaml`
- Modify: `supabase/audit.sql` (create the file holding only `m_ping` for now)
- Test: `tests/sql/010_ping.sql`

**Interfaces:**
- Produces: `public.m_ping() returns json` → `{"ok": true}`, granted to `anon`. It writes nothing.
- Produces: `keepalive.sh` (POSIX sh). It runs every ping in the order below, printing `OK <name>` or `FAIL <name> <http status>` for each, and exits non-zero if any fail. Task 12 adds a third ping, `sweep`.
- Produces: the image `alpine:3.20` with `curl` and busybox `crond`. The crontab line is `23 14 */3 * * /keepalive.sh`, and the container also runs `keepalive.sh` once at start. `compose.yaml` sets `restart: unless-stopped` and `TZ=UTC`.

- [ ] **Step 1:** Test: `assert (public.m_ping() ->> 'ok')::boolean;` plus `assert has_function_privilege('anon', 'public.m_ping()', 'execute');`
- [ ] **Step 2:** Run `node scripts/sql.mjs test 010`. Expected: FAIL, function does not exist.
- [ ] **Step 3:** Implement `m_ping` (`language sql stable security definer`).
- [ ] **Step 4:** Run it again. Expected: PASS. Then run `node scripts/sql.mjs apply`.
- [ ] **Step 5:** Write `keepalive.sh` with two `curl -sS -o /dev/null -w '%{http_code}'` pings. Both keys are public by design and are written inline. No secrets.
  - `tripp`: `POST https://ohhkzjsdabdimlrgnagw.supabase.co/rest/v1/rpc/m_ping` with header `apikey: <Tripp publishable key from site/config.js>`, `content-type: application/json`, body `{}`, expecting 200.
  - `hope`: `GET https://rjzzumzzdlsdfvyntlzu.supabase.co/rest/v1/signature_count?select=*` with headers `apikey` and `Authorization: Bearer` set to the HOPE anon JWT from `C:\Code\GitHub\Hope\index.html`, expecting 200.
- [ ] **Step 6:** Verify locally: `docker compose -f ops/keepalive/compose.yaml run --rm keepalive /keepalive.sh`. Expected: `OK tripp`, `OK hope`, exit 0. Then `docker compose -f ops/keepalive/compose.yaml up -d --build` and `docker compose -f ops/keepalive/compose.yaml logs` → the start-up run printed both OK lines. Stop it with `docker compose -f ops/keepalive/compose.yaml down`. It runs for real on the Mac Studio (owner action).
- [ ] **Step 7:** Commit with `git commit -m "Add Docker keep-alive for Tripp and HOPE"`.

### Task 3: Hash-chained audit tables

**Files:**
- Modify: `supabase/audit.sql`
- Test: `tests/sql/020_chain.sql`

**Interfaces:**
- Produces:
  - `tripp.visits(id bigint identity pk, at timestamptz not null, outcome text check in ('ok','denied','locked'), scope bigint null, ip text, isp text, org text, country text, region text, city text, lat numeric, lon numeric, geo_source text, os text, browser text, user_agent text, prev_hash text not null, row_hash text not null unique)`
  - `tripp.events(id bigint identity pk, at timestamptz not null, scope bigint null, visit_id bigint null, type text not null check (type in (<spec §6 list + D5 list>)), ref_id bigint null, detail jsonb not null default '{}', prev_hash text not null, row_hash text not null unique)`. `scope` is 0 for admin, the conversation id for a guest, and null for system.
  - `tripp.chain_hash(p_prev text, p_payload jsonb) returns text`: `encode(sha256(convert_to(p_prev || '|' || p_payload::text, 'UTF8')), 'hex')`
  - `tripp.visit_payload(v tripp.visits) returns jsonb` and `tripp.event_payload(e tripp.events) returns jsonb`. Each holds every column except `id`, `prev_hash`, and `row_hash`, with `at` as `(extract(epoch from at) * 1000000)::bigint`. The insert path and the verifier share these functions, so they can never disagree.
  - `tripp.log_visit(p_outcome text, p_scope bigint, p_ip text, p_ua text, p_os text, p_browser text, p_geo jsonb) returns bigint`. `p_geo` keys are `isp, org, country, region, city, lat, lon, source`. A missing key is stored as `'unknown'` (null for `lat`/`lon`).
  - `tripp.log_event(p_type text, p_scope bigint, p_visit bigint, p_ref bigint, p_detail jsonb) returns bigint`
  - `tripp.verify_chain(p_table text) returns json`: `{"ok": bool, "rows": n, "first_bad_id": id|null}`. `p_table` is `'visits'` or `'events'`.
  - The genesis `prev_hash` is `repeat('0', 64)`.

- [ ] **Step 1: Write the failing tests.** `020_chain.sql` checks five things:
  - (a) Two `log_event` calls: the second row's `prev_hash` equals the first row's `row_hash`, and `verify_chain('events') ->> 'ok' = 'true'`.
  - (b) After `alter table tripp.events disable trigger user; update tripp.events set detail = '{"x":1}' where id = <first>; enable trigger user`, `verify_chain` returns `ok = false` and `first_bad_id = <first>`.
  - (c) A plain `update tripp.events set ...` raises `append-only`. Check this inside a `begin … exception when others then v := sqlerrm; end` block and assert `v like '%append-only%'`.
  - (d) The same three checks for `log_visit` and `'visits'`.
  - (e) `concurrent_chain`: assert `pg_get_functiondef('tripp.log_event'::regproc) like '%pg_advisory_xact_lock%'` (the advisory lock serializes chain appends).
- [ ] **Step 2:** Run `node scripts/sql.mjs test 020`. Expected: FAIL, missing relation.
- [ ] **Step 3: Implement.**
  - `log_*` take `pg_advisory_xact_lock(hashtext('tripp.<table>'))`. They read the latest `row_hash` with `order by id desc limit 1` and set `at := clock_timestamp()`. They build the row, compute `row_hash := chain_hash(prev, *_payload(row))`, and insert it.
  - A `before update or delete` row trigger on both tables raises `'tripp.<table> is append-only'` unless `current_setting('tripp.purge', true) = 'on'`.
  - Revoke every new function from `public, anon, authenticated`. RLS is on.
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5:** Commit with `git commit -m "Add append-only hash-chained visits and events"`.

### Task 4: Edge helpers — UA parse, geo lookup, client IP

**Files:**
- Create: `supabase/functions/_shared/ua.js`, `geo.js`, `http.js`
- Test: `tests/js/ua.test.mjs`, `tests/js/geo.test.mjs`, `tests/js/http.test.mjs`

**Interfaces:**
- Produces (ESM, no Deno-only APIs, so Node tests and Deno share them):
  - `parseUserAgent(ua: string) → {os: 'Windows'|'macOS'|'iOS'|'Android'|'Linux'|'other', browser: 'Edge'|'Chrome'|'Firefox'|'Safari'|'Opera'|'Samsung Internet'|'other'}`
  - `lookupGeo(ip: string, opts?: {fetch?: typeof fetch, timeoutMs?: number = 1500}) → Promise<{isp, org, country, region, city, lat, lon, source}>`. This never rejects. On any failure the strings are `'unknown'`, `lat`/`lon` are `null`, and `source` is `'none'`. It requests `http://ip-api.com/json/<ip>?fields=status,country,regionName,city,lat,lon,isp,org`, and `source` is `'ip-api.com'`. A private or loopback IP skips the lookup.
  - `clientIp(headers: Headers) → string`: the rule from Task 1 Step 6, falling back to `'unknown'`.
  - `cors(origin: string|null) → Record<string,string>`. It allows exactly `https://cv.princerehman.com` and `http://localhost:8000`. Methods are `POST, OPTIONS`. Allowed headers are `content-type, apikey, authorization, x-client-info`.
  - `json(body: object, status = 200, origin) → Response`

- [ ] **Step 1: Write the failing tests.**
  - UA, one case per OS: Win11 Edge UA → `{os:'Windows', browser:'Edge'}`; iPhone Safari → `{os:'iOS', browser:'Safari'}`; iPad desktop-mode UA (`Macintosh` + `Mobile/`) → `iOS`; Android Chrome; Linux Firefox; macOS Chrome; `''` → `{other, other}`.
  - Geo, with an injected fake `fetch`:
    - A success payload maps its fields.
    - `{status:'fail'}` → all `'unknown'`.
    - A fetch that never resolves → resolves in under 1700 ms with `source:'none'`.
    - `10.0.0.5` and `127.0.0.1` → fetch is never called.
  - `clientIp` follows the Task 1 rule, using the spoofed and real header values recorded there.
- [ ] **Step 2:** Run `node --test tests/js/`. Expected: FAIL, module not found.
- [ ] **Step 3:** Implement. Use ordered regex checks, testing Edge and Opera before Chrome, and Chrome before Safari. Use `AbortController` for the timeout.
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5:** Commit with `git commit -m "Add UA, geo and client-IP helpers for Edge Functions"`.

### Task 5: `open_session` + audit wiring into every `m_*`

**Files:**
- Modify: `supabase/schema.sql` (drop `public.m_open` and its grants; add `visit_id` to `tripp.sessions`; add event calls to `m_post`, `m_close`, `m_conv_save`, `m_conv_delete`, `m_msg`, `m_admin_key`)
- Modify: `supabase/audit.sql` (`open_session`, `token_visit`, `m_audit`)
- Test: `tests/sql/030_open.sql`, `tests/sql/031_events.sql`

**Interfaces:**
- Consumes: `log_visit`, `log_event`, `verify_chain` (Task 3)
- Produces:
  - `tripp.open_session(p_password text, p_ip text, p_ua text, p_os text, p_browser text, p_geo jsonb, p_notice_version int) returns json`. This is `m_open`'s current logic, with these changes:
    - The lockout is keyed on `p_ip`.
    - Each outcome writes one visit: `ok` with scope 0 or the conversation id, `denied` with scope null, or `locked` with scope null.
    - A failure also writes event `login_failed`, with detail `{"reason": "denied"|"locked"}`.
    - On success it writes event `login` and then event `consent_ack` with detail `{"notice_version": n}`.
    - It stores `visit_id` on the session row.
    - A null or <1 `p_notice_version` returns `{"ok":false,"error":"no_consent"}` and writes nothing except the attempt row.
    - The return adds `"watermark": {"conversation": id, "ip": p_ip}` for guests.

    It is not granted to anon. Only the Edge Function calls it.
  - `tripp.token_visit(p_token text) returns bigint`
  - `public.m_audit(p_token text, p_kind text, p_before bigint default null, p_limit int default 100) returns json`. It is admin-only and returns rows newest first, at most 200. `p_kind` is `'events'` or `'visits'`. It returns `{"ok":true,"rows":[…],"verified":{…}}`, where `verified` (the `verify_chain` result) is included only when `p_before` is null. Events carry `type, at, scope, ref_id, detail`. Visits carry every column except the hashes.
  - Event mapping:

    | Function | Event | `ref_id` | `detail` |
    |---|---|---|---|
    | `m_post` | `message` | message id | `{"author","length"}` |
    | `m_msg` | `admin_<action>` | message id | (none) |
    | `m_conv_save` | `admin_conv_save` | conversation id | `{"created","label_changed","password_changed"}` |
    | `m_conv_delete` | `admin_conv_delete` | conversation id | `{"messages": n}`, counted before the delete |
    | `m_admin_key` | `admin_key_change` | (none) | (none) |
    | `m_close` | `logout` | (none) | (none) |

    `m_close` logs only when a session row was actually deleted. Every event takes `scope` from `session_scope` and `visit_id` from `token_visit`.

- [ ] **Step 1: Write the failing tests.** Each test sets a known admin hash with `update tripp.admin_key set hash = extensions.crypt('t-admin', extensions.gen_salt('bf', 4))`, which ROLLBACK restores, and creates a conversation with password `t-guest`. Assert:
  - `open_session('t-admin','198.51.100.7','UA','Windows','Edge','{}',1)` → `ok`, `role = admin`. The latest visit has `outcome = 'ok'`, `scope = 0`, `isp = 'unknown'`. The last two events are `login` then `consent_ack` with `notice_version = 1`.
  - A wrong password → `denied`, a visit with `outcome = 'denied'` and scope null, and a `login_failed` event.
  - 8 wrong tries from one IP, then a 9th → `locked` and a `locked` visit.
  - `p_notice_version = 0` → `no_consent` and no new visit.
  - The guest `open_session` return has `watermark.conversation` equal to the conversation id.
  - `to_regprocedure('public.m_open(text)') is null`.
  - `031_events.sql`: each row of the mapping table yields exactly one event of that type with the right `ref_id`. `m_close` on an unknown token adds zero events. `verify_chain` is ok on both tables at the end. `m_audit` with a guest token → `forbidden`.
- [ ] **Step 2:** Run `node scripts/sql.mjs test 03`. Expected: FAIL.
- [ ] **Step 3:** Implement. Do not edit `m_open`; replace it. Keep its comment block above `open_session`.
- [ ] **Step 4:** Run `node scripts/sql.mjs test`, the full suite. Expected: all PASS.
- [ ] **Step 5:** Commit with `git commit -m "Log every visit and action; move sign-in to open_session"`. Do not apply yet. Task 6 deploys the function and the schema together, so live sign-in never breaks.

### Task 6: `open` Edge Function, consent notice, sign-in UI

**Files:**
- Create: `supabase/functions/open/index.ts`
- Modify: `site/config.js` (`functions: 'https://ohhkzjsdabdimlrgnagw.supabase.co/functions/v1'` and the `notice` object), `site/index.html` (notice and checkbox on the lock form), `site/app.js` (sign-in path), `site/styles.css`

**Interfaces:**
- Consumes: `parseUserAgent`, `lookupGeo`, `clientIp`, `cors`, `json` (Task 4); `tripp.open_session` (Task 5)
- Produces:
  - `POST {functions}/open` with body `{"password": string, "notice_version": number}` → the same JSON `open_session` returns. `OPTIONS` → 204 with CORS headers. Any other method → 405. A body that won't parse → `{"ok":false,"error":"bad_request"}`.
  - The DB is reached with `postgres(Deno.env.get('SUPABASE_DB_URL'), {prepare: false})`, then `select tripp.open_session($1,…)`.
  - `app.js`: `fn(name, body) → Promise<{ok,…}>`. It does for Edge Functions what `rpc` does, with the same `network`/`setup` error shape.
  - `config.notice = { version: 1, text: '…' }`. Version 1 text (placeholder until the owner supplies the final wording): "Everything you do here is recorded: when you visit, your IP address and approximate location, your device and browser, and every message and file. Records are kept and may be shared with legal counsel or produced in legal proceedings. Tick the box to continue."
  - New `ERRORS`: `no_consent: 'Tick the box to agree before signing in.'` and `bad_request` (generic).

- [ ] **Step 1:** Add `<p id="lock-notice">` with its text set from `config.notice.text` and a required `<input type="checkbox" id="lock-ack">` labelled "I have read this and agree" above Unlock. Submit sends `notice_version: el['lock-ack'].checked ? config.notice.version : 0`.
- [ ] **Step 2:** Implement `open/index.ts`. Pass `parseUserAgent(req.headers.get('user-agent') || '')`, `await lookupGeo(ip)`, and `p_ua` truncated to 512 characters.
- [ ] **Step 3: Deploy in order.**
  1. `npx supabase@2.54.11 functions deploy open --project-ref ohhkzjsdabdimlrgnagw --no-verify-jwt --use-api`
  2. `node scripts/sql.mjs apply`
  3. Serve `site/` locally with `npx http-server@14.1.1 site -p 8000`.
- [ ] **Step 4: Verify live (Chrome).** Use the memory-documented test-hash swap on `tripp.admin_key`, restoring the saved hash in `finally`. Then:
  - Unticked box → "Tick the box…".
  - Ticked box with the test admin password → the portal opens.
  - Run `select outcome, ip, os, browser, country, geo_source from tripp.visits order by id desc limit 1`. Expect your real IP, `Windows`, your browser, a real country, and `ip-api.com`.
- [ ] **Step 5:** Run `pwsh scripts/deploy.ps1`. Then sign in on `https://cv.princerehman.com/Tripp/` and repeat the visits query.
- [ ] **Step 6:** Commit with `git commit -m "Sign in through the open Edge Function with a recorded consent notice"`.

### Task 7: Non-admin focus-loss lock, watermark, copy deterrents

**Files:**
- Modify: `site/app.js`, `site/index.html` (`<div id="watermark" aria-hidden="true" hidden>`), `site/styles.css`

**Interfaces:**
- Consumes: `watermark` from the `open` response (Task 6)
- Produces:
  - `awayLock()`: guest only. It synchronously adds `is-blanked` to `<body>`, which sets `#portal { visibility: hidden }`, and then calls `lock('away')`. `lock()` removes `is-blanked` and hides the watermark. New `ERRORS.away: 'Locked because this window lost focus. Enter your password again.'`
  - Triggers: `window` `blur`, and `document` `visibilitychange` when `document.hidden`. While `pickingFile` is true, `blur` is ignored but `visibilitychange` is not. `pickingFile` is set right before any file input's `.click()` and cleared on that input's `change` or `cancel` event, and on the next window `focus`.
  - Watermark: the text is `'Conversation ' + id + ' · ' + ip + ' · ' + <local date-time>`. It is repeated in absolutely positioned spans filling the viewport at 240 px × 120 px spacing and rotated −30°, with `opacity: .12` and `pointer-events: none`. The time is refreshed every 60 s and on resize.
  - Guest deterrents:
    - `#portal { user-select: none }`, except the compose textarea.
    - `contextmenu`, `copy`, and `cut` call `preventDefault()` outside the textarea.
    - `@media print { body.is-guest #portal { display: none } }`.
  - `body.is-guest` is set in `unlock` for guests.

- [ ] **Step 1:** Implement.
- [ ] **Step 2:** Run the site locally and sign in as the test guest. Then:
  - Alt-tab away → you are back on the lock screen showing the `away` message.
  - The watermark is visible and shows your IP.
  - Right-click does nothing, and Ctrl+P prints blank.
- [ ] **Step 3:** Sign in as the admin. Alt-tab → you stay signed in, with no watermark.
- [ ] **Step 4 (Review Focus 1):** Leave this unchecked until Task 12 adds the attach button, then test it there: guest clicks Attach, picks a file, and returns → still signed in. Clicking Attach, cancelling, then alt-tabbing → locked.
- [ ] **Step 5:** Deploy, repeat the guest alt-tab check on the live URL, and commit with `git commit -m "Lock guests on focus loss; watermark and copy deterrents"`.

### Task 8: Admin audit viewer

**Files:**
- Modify: `site/index.html` (sidebar button `open-audit` and `<dialog id="audit-dialog">` with tabs Events | Visits, a table, a "Load older" button, and a `#audit-verified` badge), `site/app.js`, `site/styles.css`

**Interfaces:**
- Consumes: `m_audit` (Task 5)
- Produces:
  - Rows render newest first. Events show time, who (Admin / Conversation `<label>`), type, and detail as `key: value` pairs. Visits show time, outcome, who, IP, ISP, city/region/country, OS, and browser.
  - The badge reads "Record intact: N rows verified" or, in the error colour, "Record altered at entry #<id>".
  - "Load older" passes the last id as `p_before`.

- [ ] **Step 1:** Implement.
- [ ] **Step 2:** Verify live, as admin: the dialog shows Task 6's sign-in visit and its `login` and `consent_ack` events, and the badge says intact.
- [ ] **Step 3:** Deploy and commit with `git commit -m "Add read-only audit log viewer with chain check"`.

**Part 0a release checkpoint:** run the full `node scripts/sql.mjs test` and `node --test tests/js/`, and confirm the live checks in Tasks 6–8 passed. Then ask the owner to push `main`.

---

# Part 0b — Encrypted attachments, key store, retention

### Task 9: Key store + `site/crypto.js`

**Files:**
- Create: `supabase/keys.sql`, `site/crypto.js`, `tests/js/crypto.test.mjs`
- Test: `tests/sql/050_keys.sql`

**Interfaces:**
- Produces (SQL):
  - Schema `tripp_keys`, with `revoke all … from public, anon, authenticated`.
  - `tripp_keys.owner(id int pk default 1 check (id = 1), public_jwk jsonb not null, wrapped_private text not null, private_iv text not null, kdf text not null default 'pbkdf2-sha256', kdf_salt text not null, kdf_iterations int not null, keyfile boolean not null default false, created_at timestamptz default now())`
  - `tripp_keys.conversations(conversation_id bigint pk references tripp.conversations on delete cascade, wrapped_owner text not null, wrapped_guest text null, guest_salt text null, guest_iv text null, guest_iterations int null, changed_at timestamptz default now())`
  - `public.m_keys(p_token text, p_conversation bigint default null) returns json`:
    - For a guest: `{ok, public_jwk|null, conv: {wrapped_guest, guest_salt, guest_iv, guest_iterations}|null}`.
    - For the admin: `{ok, owner: {public_jwk, wrapped_private, private_iv, kdf, kdf_salt, kdf_iterations}|null, conv: {wrapped_owner}|null}`.
  - `public.m_key_setup(p_token, p_public_jwk jsonb, p_wrapped_private text, p_private_iv text, p_kdf_salt text, p_iterations int) returns json`: admin only. It returns `exists` if an owner row exists, and logs `key_setup`.
  - `public.m_key_conv(p_token, p_conversation bigint, p_wrapped_owner text, p_wrapped_guest text, p_guest_salt text, p_guest_iv text, p_guest_iterations int) returns json`:
    - A guest may insert for its own conversation only when no row exists. Otherwise it gets `exists`. A guest passes null for `p_conversation`.
    - The admin may insert, or replace the guest fields.
    - With no owner row, it returns `no_keys`.
  - `public.m_keys_backup(p_token text) returns json`: admin only. It returns `{ok, owner, conversations:[…], exported_at}`, all of it ciphertext apart from the public key.
- Produces (`window.TrippCrypto`; every binary value crosses the API as base64 strings):
  - `ITERATIONS = 600000`, `CHUNK = 1048576`
  - `deriveKek(passphrase, keyfileBytes|null, saltB64, iterations) → CryptoKey`. The input is `SHA-256(keyfile) ‖ utf8(passphrase)`, or just `utf8(passphrase)` when the keyfile is null. The result is AES-GCM-256 with usages `wrapKey, unwrapKey`.
  - `createOwnerKeys(kek) → {publicJwk, wrappedPrivate, privateIv}`: RSA-OAEP 3072 with SHA-256, the private key wrapped as pkcs8 under AES-GCM.
  - `openOwnerKey(kek, wrappedPrivate, privateIv) → CryptoKey`. It throws an `Error` whose `message` is `'bad_passphrase'` when unwrapping fails.
  - `newConversationKey() → CryptoKey` (extractable)
  - `wrapForOwner(dek, publicJwk) → b64` and `unwrapForOwner(b64, privateKey) → CryptoKey` (extractable)
  - `deriveGuestKey(password, saltB64, iterations) → CryptoKey`, `wrapForGuest(dek, guestKey) → {wrapped, iv}`, and `unwrapForGuest(wrapped, iv, guestKey) → CryptoKey` (non-extractable)
  - `encryptFile(dek, blob) → {ciphertext: Blob, nonce: b64, chunkSize}`. The per-chunk IV is `nonce(8 random bytes) ‖ uint32BE(index)`. The AAD is `utf8(index + '|' + (isLast ? 1 : 0))`. An empty file is one empty chunk.
  - `decryptFile(dek, arrayBuffer, nonce, chunkSize) → Uint8Array`. It throws on tampering or truncation.
  - `encryptText(dek, text) → b64(iv‖ct)` and `decryptText(dek, b64) → string`
  - `cipherSize(plain, chunkSize) → number`, which must equal SQL `cipher_size`.
  - `randomB64(n) → string`

- [ ] **Step 1: Write the failing JS tests.** Load the file with `vm.runInThisContext(fs.readFileSync('site/crypto.js','utf8'))` and use Node's `globalThis.crypto`. Use `ITERATIONS = 1000` in tests for speed. Assert:
  - Owner round-trip: create → open with the right passphrase works; the wrong one rejects with `bad_passphrase`.
  - DEK round-trips through owner wrap/unwrap and through guest wrap/unwrap.
  - Encrypting 2.5 MiB of random bytes and decrypting gives the identical bytes, and `ciphertext.size === cipherSize(2.5 MiB)`.
  - Dropping the last chunk → `decryptFile` rejects (truncation).
  - Flipping one byte → it rejects.
  - A 0-byte file round-trips.
  - `encryptText` and `decryptText` round-trip a unicode filename.
  - `cipherSize(1048576, CHUNK) === 1048592`.
- [ ] **Step 2: Write the failing SQL tests (`050_keys.sql`).** Assert:
  - `m_key_setup` twice → the second returns `exists`.
  - A guest calling `m_key_conv` before setup → `no_keys`. After setup it succeeds once and the second call returns `exists`.
  - The admin can replace `wrapped_guest`.
  - The guest's `m_keys` never contains `wrapped_private` or `wrapped_owner` (check with `::text not like`).
  - `m_keys_backup` with a guest token → `forbidden`.
  - Deleting the conversation removes its key row.
- [ ] **Step 3:** Run both. Expected: FAIL.
- [ ] **Step 4:** Implement. `crypto.js` is an IIFE that sets `(typeof window !== 'undefined' ? window : globalThis).TrippCrypto`.
- [ ] **Step 5:** Run both. Expected: PASS. Run the full suites.
- [ ] **Step 6:** Commit with `git commit -m "Add key store and browser crypto (owner keypair, per-conversation keys, chunked AES-GCM)"`.

### Task 10: Storage bucket, attachments, `m_post`/`m_list` extension

**Files:**
- Create: `supabase/media.sql`
- Modify: `supabase/schema.sql` (relax `messages.body` to 0–10,000 characters; `m_post` gains `p_attachments jsonb default '[]'`; `m_list` returns attachments)
- Test: `tests/sql/040_media.sql`

**Interfaces:**
- Consumes: `tripp_keys.conversations` (Task 9)
- Produces:
  - Bucket `tripp-media`: private, with `file_size_limit = 26215424`. It is created with `insert into storage.buckets … on conflict do nothing`. No `storage.objects` policies, so only the service role can reach it.
  - `tripp.attachments(id identity pk, message_id bigint not null references tripp.messages on delete cascade, conversation_id bigint not null, path text not null unique, kind text check in ('file','audio','video'), mime text not null check (char_length(mime) <= 255), bytes bigint not null check (bytes between 1 and 26214400), name_enc text not null check (char_length(name_enc) <= 2048), nonce text not null, chunk_size int not null, duration_ms int null, created_at timestamptz default now())`
  - `tripp.uploads(path text pk, conversation_id bigint not null, kind text, bytes bigint, created_at timestamptz default now())`: reservations. Rows older than 1 day are removed in `media_reserve`.
  - `tripp.storage_trash(path text pk, queued_at timestamptz default now())`, with an `after delete` row trigger on `attachments` that inserts `old.path`. Cascades from message and conversation deletes fire it.
  - `tripp.cipher_size(p_plain bigint) returns bigint` = `p_plain + 16 * greatest(1, ceil(p_plain / 1048576.0))`.
  - `tripp.media_reserve(p_token text, p_conversation bigint, p_kind text, p_bytes bigint) returns json`. It returns `{ok, path:'conversation/<id>/<uuid>'}` or the errors `expired | no_conversation | too_large | bad_kind | no_keys`. `no_keys` is returned when there is no `tripp_keys.conversations` row (table from Task 9).
  - `tripp.media_readable(p_token text, p_attachment bigint) returns json` → `{ok, path}` or `expired | no_attachment`. A guest gets `no_attachment` when the parent message is hidden or archived, or belongs to another conversation.
  - `tripp.media_trash_take(p_limit int) returns setof text` and `tripp.media_trash_done(p_paths text[]) returns void`

    These four media functions are revoked from everyone and are called only by the `media` Edge Function.
  - `m_post` accepts at most 10 attachment objects. Each is `{path, kind, mime, bytes, name_enc, nonce, chunk_size, duration_ms?}`. Each must:
    - be a reservation for the same conversation,
    - not already be attached,
    - have `storage.objects` metadata size = `cipher_size(bytes)` in bucket `tripp-media`.

    Otherwise it returns `bad_attachment`, `foreign_path`, `missing_upload`, or `size_mismatch`. If an attachment is present the body may be empty; if neither is, the error is still `empty`. It writes event `message` with `detail.attachments = n`, plus one `upload` event per attachment with `ref_id` = attachment id and detail `{kind, mime, bytes}`. Then it deletes the reservation.
  - `m_list` gives each message `"attachments": [{id, kind, mime, bytes, name_enc, nonce, chunk_size, duration_ms}]`, or `[]`.

- [ ] **Step 1: Write the failing tests.** Seed an owner row and a key row for each test conversation directly in `tripp_keys`. Fake an uploaded object with `insert into storage.objects (bucket_id, name, metadata) values ('tripp-media', <path>, jsonb_build_object('size', tripp.cipher_size(1000)))` (inside the rolled-back transaction). Assert:
  - The happy path stores one attachment, and `m_list` returns it under the message.
  - `foreign_path`: a reservation for conversation A posted from B.
  - `size_mismatch`: object metadata size ≠ `cipher_size(bytes)`.
  - `missing_upload`: a reservation with no object.
  - Body `''` with no attachments → `empty`.
  - A guest's `m_list` omits the attachments of a hidden message.
  - Deleting the message puts its path into `storage_trash`.
  - `cipher_size(1048576) = 1048592` and `cipher_size(1048577) = 1048609`.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement. Check first whether `storage.objects` has a delete-protection trigger in this project; the tests insert into it but never delete from it.
- [ ] **Step 4:** Run it. Expected: PASS, along with the full suite.
- [ ] **Step 5:** Commit with `git commit -m "Add attachment rows, upload reservations and Storage trash queue"`.

### Task 11: `m_conv_save` key rewrap guard

**Files:**
- Modify: `supabase/schema.sql` (`m_conv_save` gains `p_wrapped_guest text default null, p_guest_salt text default null, p_guest_iv text default null, p_guest_iterations int default null`. Drop the old 4-argument signature and re-grant.)
- Test: `tests/sql/051_rewrap.sql`

**Interfaces:**
- Produces:
  - A password change on a conversation with a key row but no `p_wrapped_guest` → `needs_unlock`, and nothing changes.
  - With `p_wrapped_guest`, the password and the guest key fields update in the same transaction.
  - A new conversation with key params given → inserts the key row as well. This requires an owner row.

- [ ] **Step 1:** Tests cover exactly those three bullets, plus "a label-only change never needs unlock".
- [ ] **Step 2:** Run it. Expected: FAIL. **Step 3:** Implement. **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5:** Commit with `git commit -m "Require unlocked files to re-password a keyed conversation"`.

### Task 12: `media` Edge Function + attachment and key UI

**Files:**
- Create: `supabase/functions/media/index.ts`
- Modify: `site/index.html` (CSP adds `img-src blob:; media-src blob:`; a `crypto.js` script tag before `app.js`; compose gets an `#attach` button, a hidden `<input type="file" id="attach-input" multiple>`, and an `#attach-list`; sidebar gets `#files-key` "Unlock files" and `#key-backup` "Download key backup"; new `<dialog id="key-dialog">`), `site/app.js`, `site/styles.css`, `scripts/deploy.ps1:36` (add `'crypto.js'`)

**Interfaces:**
- Consumes: `m_keys`, `m_key_setup`, `m_key_conv`, `m_keys_backup`, `TrippCrypto` (Task 9); `media_reserve`, `media_readable`, `media_trash_*` (Task 10); `m_conv_save` key params (Task 11)
- Produces (`POST {functions}/media`, `{action, token, …}`):
  - `upload_url`, with `{conversation?, kind, bytes}` → `media_reserve`, then `storage.from('tripp-media').createSignedUploadUrl(path)` (lifetime 120 s) → `{ok, path, signed_url}`
  - `download_url`, with `{attachment}` → `media_readable`, then `createSignedUrl(path, 60)` → `{ok, signed_url}`
  - `sweep` (no token) → take 100 paths, `storage.remove(paths)`, mark them done → `{ok, removed: n}`. Call it from `app.js` after any successful message or conversation delete, and add a third ping, `sweep`, to `ops/keepalive/keepalive.sh` (`POST {functions}/media` with body `{"action":"sweep"}`, expecting 200).
- Produces (`app.js` state, all cleared in `lock()`):
  - `ownerKey` (admin private key)
  - `convKeys` (map from conversation id to DEK)
  - `guestDek`

  The guest flow keeps the password in a local variable through sign-in, derives the guest key, then drops it. If there is no conversation key and `public_jwk` exists, it creates the DEK and calls `m_key_conv`.
- Admin key dialog:
  - **Setup mode** (no owner row): passphrase twice plus the warning "If this passphrase is lost, every file is lost for good. Nobody can recover it."
  - **Unlock mode:** one passphrase field.
  - A wrong passphrase gives `ERRORS.bad_passphrase: 'That passphrase did not unlock your files.'`.
- Admin conversation dialog: when files are unlocked, creating a conversation or changing its password also sends the wrapped guest key. A `needs_unlock` result gives `ERRORS.needs_unlock: 'Unlock your files first, so their key can be moved to the new password.'`.
- Attach flow: per file,
  1. Reject if over 26,214,400 bytes (`ERRORS.too_large: 'Files can be up to 25 MB.'`).
  2. `encryptFile`.
  3. `upload_url`.
  4. `PUT` the ciphertext to `signed_url` with `content-type: application/octet-stream`.
  5. Collect the attachment object (`name_enc = encryptText(dek, file.name)`, `mime = file.type || 'application/octet-stream'`).

  Then `m_post` with `p_attachments`. Attach is hidden when no DEK is available, and the compose status explains why: admin → "Unlock files to attach"; guest → "Attachments are not set up yet".
- Thread: each attachment renders as a button showing the decrypted name and its size. Clicking it runs `download_url` → `fetch` → `decryptFile` → `Blob` → a temporary `<a download>`. A locked admin sees "Locked file" instead of a name.
- `#key-backup` downloads `tripp-key-backup-<yyyy-mm-dd>.json`.

- [ ] **Step 1:** Implement the function and UI.
- [ ] **Step 2:** Deploy the function (same command as Task 6, with `media`). Then run `node scripts/sql.mjs apply` and serve locally.
- [ ] **Step 3: Verify live in Chrome.** Use test hashes for the admin and for a test conversation `Stage0 test`, created and then deleted at the end, with `finally` restoring the admin hash.
  1. Admin sets up files with a throwaway passphrase *only if no owner row exists*. If one exists, ask the owner to unlock it, and never run setup over the real one.
  2. Guest signs in, attaches a 3 MB PDF and sends it. Admin opens it, and the downloaded file is byte-identical (compare `certutil -hashfile <f> SHA256` against the original).
  3. Run `select (metadata->>'size')::bigint from storage.objects where name = <path>`. It must equal `cipherSize(3 MB)`, and the stored bytes must not start with `%PDF`.
  4. Re-password the conversation while locked → the `needs_unlock` message.
  5. Delete the test conversation → `storage_trash` empties after sweep.
  6. Do Task 7 Step 4 (the file-picker focus case).
- [ ] **Step 4:** Run `pwsh scripts/deploy.ps1` and commit with `git commit -m "Encrypted file attachments end to end"`.

**Owner step after Task 12:** sign in as admin on the live site, choose **Set up files** with your real passphrase, then **Download key backup** and store it on your backup layer.

### Task 13: Retention window + legal hold

**Files:**
- Create: `supabase/retention.sql`
- Modify: `site/index.html` and `site/app.js` (conversation dialog: "Legal hold" checkbox; admin password dialog → rename to "Settings" and add "Delete messages and logs older than [ ] days (empty = keep everything)")
- Test: `tests/sql/060_retention.sql`

**Interfaces:**
- Produces:
  - `tripp.settings(id int pk default 1 check (id = 1), retention_days int null check (retention_days >= 1))`, seeded with one null row.
  - `alter table tripp.conversations add column if not exists legal_hold boolean not null default false`. `m_convs` returns `legal_hold`.
  - `public.m_settings(p_token text, p_retention_days int default null, p_save boolean default false) returns json`: admin only. It reads, or saves when `p_save` is true, and the save logs `admin_retention_set` with `{"days": n|null}`.
  - `public.m_conv_hold(p_token text, p_id bigint, p_hold boolean) returns json`: admin only. It logs `admin_legal_hold` with `ref_id` = conversation id and `{"hold": bool}`.
  - `tripp.retention_purge() returns json`. When `retention_days` is null it returns `{"ok":true,"skipped":true}`. Otherwise it purges in three steps:
    1. It deletes messages older than the window in conversations not on hold. Attachments cascade, and the trash trigger queues their files.
    2. For each of `visits` and `events`, under `set local tripp.purge = 'on'`, it deletes the lowest ids. It stops before the first row that is newer than the window, or whose `scope` belongs to a held conversation.
    3. If it purged anything, it writes `retention_purge` with `{"table", "rows", "anchor": <row_hash of the last purged row>}`.
  - `verify_chain` (Task 3) is changed: the first row's `prev_hash` may be the genesis value or an `anchor` recorded for that table.
  - pg_cron: `create extension if not exists pg_cron`, then `select cron.schedule('tripp-retention', '30 8 * * *', 'select tripp.retention_purge()')` guarded by `where not exists (select 1 from cron.job where jobname = 'tripp-retention')`.

- [ ] **Step 1: Write the failing tests.** Backdate rows with `set local tripp.purge = 'on'` and `update … set at = now() - interval '40 days'`, then re-hash them via a test helper that rebuilds the chain. Assert:
  - Null retention → `skipped`, and nothing is deleted.
  - 30 days → an old message in an unheld conversation is gone, while one in a held conversation stays.
  - Old events are purged up to the first held-scope row, the `retention_purge` anchor matches, and `verify_chain` is still ok.
  - A hold toggle writes `admin_legal_hold`.
  - A guest calling `m_settings` → `forbidden`.
- [ ] **Step 2:** Run it. Expected: FAIL. **Step 3:** Implement. **Step 4:** Run it. Expected: PASS, along with the full suite.
- [ ] **Step 5:** Apply, then check `select jobname, schedule from cron.job where jobname = 'tripp-retention'` returns one row. Wire up the UI and deploy. In the live admin dialog, toggle hold on the test conversation → the audit viewer shows `admin_legal_hold`.
- [ ] **Step 6:** Commit with `git commit -m "Add retention window and legal hold"`.

**Part 0b release checkpoint:** all SQL and JS suites pass, Task 12 Step 3 passed live, and the owner has set up files and stored the key backup. Then ask the owner to push `main`. Retention stays off until the owner enters a number of days after talking to the lawyer.
