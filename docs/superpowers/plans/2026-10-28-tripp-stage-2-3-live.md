# Tripp Stages 2 and 3: Live Connection, Admin Alerts and Calls — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give signed-in parties a secured live connection, use it to push admin alerts and show who is online, and run two-party audio and video calls (peer-to-peer and STUN only) with call metadata on the audit record.

**Architecture:** On unlock the browser makes a Supabase **anonymous** auth session and binds its user id to the Tripp session token through a SECURITY DEFINER RPC. Realtime Authorization policies on `realtime.messages` allow private channels only to bound, unexpired sessions: a guest reaches only `conv:<own id>`, and the admin reaches `admin` and every `conv:<id>`. The database pushes alerts to `admin` from `tripp.log_event` with `realtime.send`. Calls signal over `conv:<id>` broadcast, and media goes peer-to-peer. `m_call` writes `call_start`, `call_answer` and `call_end` to the hash-chained events log.

**Tech Stack:** Supabase Realtime (private channels, broadcast, presence), Supabase Auth anonymous sign-ins, `@supabase/supabase-js@2.117.3` UMD (vendored into `site/vendor/`), WebRTC, Postgres plpgsql, Node `node:test`, Playwright 1.48.2 headless with fake media devices.

**Spec:** `docs/superpowers/specs/2026-10-27-tripp-media-and-audit-design.md`: §5 (scoped tokens), §8 (calls), §9 (admin alerts), §12a (scoped-token risk, many sessions on one password, admin catch-up), §14 Q1 (metadata only), §3 (non-goals).

**Order change (owner, 2026-10-28):** Stages 2 and 3 now run before Stage 0.5 (export) and Stage 1 (recorded messages). Task 9 records this in spec §11.

## Global Constraints

- No GitHub Actions or workflows of any kind. Scheduled jobs use pg_cron inside Supabase or Docker on the owner's machine.
- No disclaimer, consent, recording or legal wording anywhere on the site. Every user-visible string in this plan is listed in **Strings for owner approval** below. No other user-visible text ships.
- The lock screen stays exactly as it is: one password box and the Unlock button.
- Never read message bodies. Alert payloads and call events carry ids, types and times only.
- Never touch `tripp.admin_key` in tests. Admin-path tests insert a temporary `tripp.sessions` row (`conversation_id` null) and delete it afterwards.
- Never drive the owner's visible Chrome. Use headless Playwright only.
- Never push `main`. `scripts/deploy.ps1` (which pushes `gh-pages`) and Edge Function or schema deploys are covered by approval of this plan.
- The DB password reaches commands only as `TRIPP_DB_PASSWORD` set per command. Never write it to a file, a commit or a report.
- Call **media** is never recorded (§14 Q1). Only metadata is logged.
- Calls are two-party only (§3). Several endpoints may ring, but the first one to answer wins (§12a).
- SQL style follows `supabase/*.sql`: `security definer set search_path = ''`, errors returned as `json_build_object('ok', false, 'error', <code>)` and never raised, `revoke all … from public` then explicit grants, and `notify pgrst, 'reload schema'` at the end.
- Script URLs: no CDN. The Supabase client is vendored as `site/vendor/supabase-2.117.3.js`, because the CSP is `script-src 'self'`.
- Each session idles out after 30 minutes and expires after 12 hours (`tripp.session_scope`). Live access must follow the same rule.

## Owner actions before Task 1

1. In the Supabase dashboard, open Authentication → Sign In / Providers and turn on **Allow anonymous sign-ins**.
2. Open Realtime → Settings and turn off **Allow public access**, so only private channels exist.
3. Provide the DB password per command, as in Stage 0.

## Strings for owner approval

Plain labels and statuses. Nothing ships beyond these, and the owner may change any of them before Task 5.

| Where | Text |
| --- | --- |
| Admin alert, guest signed in | `<label> signed in` |
| Admin alert, guest message | `<label> sent a message` |
| Admin alert, guest file | `<label> sent a file` |
| Admin alert, guest calling | `<label> is calling` |
| Admin sidebar button (shown only while desktop notifications are undecided) | `Desktop alerts` |
| Audit log button with unseen events | `Audit log (N)` |
| Online dot (screen-reader label only) | `Online` |
| Call buttons | `Call`, `Video call` |
| Incoming call, admin | `<label> is calling` |
| Incoming call, guest | `Incoming call` |
| Incoming buttons | `Answer`, `Decline` |
| In-call buttons | `Mute` / `Unmute`, `Camera off` / `Camera on`, `Hang up` |
| Call status | `Calling`, `Connecting`, `Call ended`, `No answer`, `Call failed` |
| Error when mic or camera is refused | `Microphone or camera blocked.` |

## Review Focus

1. **A guest switches away during a call.** The existing focus-loss lock still applies, so the call must end on both sides (`call_end` reason `lock`) and the guest must land on the lock screen. The camera and mic light must go off. Tested in Task 8.
2. **The browser's mic or camera permission prompt takes focus from a guest.** This is handled like the file picker: blank the page without locking, with a 60-second fallback. Without this the guest locks the moment they press Answer. Tested in Task 8.
3. **A session expires or locks while channels are open.** `TrippLive.stop()` must remove every channel and sign out the anonymous user. A stale anonymous JWT must not be able to rejoin, because `live_scope` returns null. Tested in Tasks 2 and 4.
4. **Two guest tabs on one password, or both sides ringing at once.** First accept wins and the other endpoints stop ringing. When both sides ring, the smaller call id survives. Tested in Tasks 7 and 8.
5. **`realtime.send` failing.** It must never roll back a message, upload or sign-in. `tripp.live_alert` swallows the error. Tested in Task 2 by the method Task 1 Step 6b finds. If there is none, the reviewer checks it by reading the code.
6. **A message with files fires both a `message` and an `upload` event.** The admin should see one alert, not two. Handled in Task 5 Step 1.

---

### Task 1: Spike: anonymous sessions + private-channel authorization

Throwaway. Nothing ships. Results are written into this section, as in Stage 0's Task 1.

**Files:**
- Create (scratchpad only, deleted at the end): `spike-live.mjs`, which uses `@supabase/supabase-js@2.117.3` from a scratch `npm i`
- Modify: this plan, filling in **Spike results** below

- [ ] **Step 1:** With pg and the DB password, create a throwaway function `public.spike_bind()` that returns `auth.uid()`, a throwaway table `tripp.spike_ok(uid uuid)`, and a throwaway policy `spike_read` on `realtime.messages` for `authenticated`, using `realtime.topic() = 'spike:' || auth.uid()::text and exists (select 1 from tripp.spike_ok where uid = auth.uid())`. The policy has to go through a SECURITY DEFINER helper, because `authenticated` cannot read `tripp`. Record whether that works.
- [ ] **Step 2:** In Node, `createClient(url, publishableKey, { auth: { persistSession: false } })` and then `signInAnonymously()`. Record success, the JWT's `role` and `is_anonymous` claims, and the expiry.
- [ ] **Step 3:** Subscribe to `spike:<uid>` with `{ config: { private: true } }` before inserting into `spike_ok`. Expect `CHANNEL_ERROR`. Insert the uid, re-subscribe, and expect `SUBSCRIBED`. Record both.
- [ ] **Step 4:** From pg run `select realtime.send('{"x":1}'::jsonb, 'event', 'spike:<uid>', true)`. Record whether the subscriber receives it and how long it takes.
- [ ] **Step 5:** Presence: call `channel.track({ a: 1 })` with only the select policy, then again with an insert policy limited to `realtime.messages.extension in ('presence','broadcast')`. Record which policy presence needs.
- [ ] **Step 6:** Check that `delete from auth.users where id = '<uid>'` works as `postgres`. Record the anonymous sign-in rate limit shown under Auth → Rate limits.
- [ ] **Step 6b:** Find a way to make `realtime.send` fail inside a rolled-back transaction as `postgres`, for example a `check (false) not valid` constraint added to `realtime.messages`, or a revoke. Record the method, or record that none is permitted.
- [ ] **Step 7:** Drop the spike function, table and policies, delete the spike anonymous users, and confirm none remain.
- [ ] **Step 8: Decision gate.** If Steps 2 to 4 all pass, continue with Task 2 as written. If anonymous sign-in or private-channel authorization fails, **stop and report to the owner**. The fallback (§12a option i) is an Edge Function that signs short-lived HS256 JWTs. It needs the legacy JWT secret stored as a function secret, which is an owner decision.

**Spike results:** (2026-10-28, rerun after the owner enabled anonymous sign-ins and disabled Realtime public access) PASS.
- Step 1: works as postgres. Policy shape that worked: `create policy spike_read on realtime.messages for select to authenticated using (realtime.topic() = 'spike:' || auth.uid()::text and public.spike_ok_for(auth.uid()))`, where `public.spike_ok_for(uuid)` is `language sql stable security definer set search_path = ''`, `revoke all ... from public`, `grant execute ... to authenticated`, reading `tripp.spike_ok`. `realtime.messages` had RLS on and no policies beforehand.
- Step 2: `signInAnonymously()` succeeded in about 0.5 to 0.9 s. JWT: `role=authenticated`, `is_anonymous=true`, `aal1`, lifetime 3600 s (exp minus iat). `auth.uid()` via rpc returns the user id. Call `realtime.setAuth(access_token)` before subscribing.
- Step 3: not in `spike_ok` gives `CHANNEL_ERROR` ("Unauthorized: You do not have permissions to read from this Channel topic: spike:<uid>"), taking about 4 to 4.7 s, repeatable. The very first private subscribe on the project gave `CHANNEL_ERROR` "MissingPartition: Realtime was unable to find the expected messages partition" instead (first-use partition creation), so the first denial test was not a clean policy denial; a second fresh user confirmed the Unauthorized error. After inserting the uid, subscribe gives `SUBSCRIBED` in about 50 ms. A topic for another uid is denied even when the caller is in `spike_ok`.
- Step 4: `select realtime.send('{"x":1}'::jsonb,'event','spike:<uid>',true)` from pg was received by the subscriber in about 43 ms (broadcast event 'event').
- Step 5: presence `track()` with only the select policy returns `'error'` (no presence state, though the channel subscribes). After adding `create policy spike_write on realtime.messages for insert to authenticated with check (<same topic and ok_for test> and realtime.messages.extension in ('presence','broadcast'))`, `track()` returns `'ok'` and presence state appears. So presence needs the INSERT policy as well as SELECT.
- Public access off: a NON-private channel subscribe still returns `SUBSCRIBED` (about 45 ms). Disabling public access does not stop subscribing to public channels; it needs to be handled by only ever using private topics (delivery on public channels not tested).
- Step 6: `delete from auth.users where id = any(...)` as postgres works (2 rows). The Auth rate limit for anonymous sign-ins is only visible in the dashboard and was not read (no dashboard or Management API access); 3 sign-ins in this spike were not limited.
- Step 6b: `alter table realtime.messages add constraint ... check (false) not valid` fails ("must be owner of table messages"); revoke on the function or table is a silent no-op (postgres is not owner/grantor, privilege stays true). A `before insert` trigger on `realtime.messages` that raises can be created by postgres, but `realtime.send` wraps its insert in `exception when others then raise warning 'WarnSendingBroadcastMessage'` (confirmed from its source), so it never errors and the transaction is not aborted. Result: no method found to make `realtime.send` fail; a failure cannot roll back the caller.
- Step 7: dropped policies spike_read and spike_write, functions spike_ok_for and spike_bind, table tripp.spike_ok; deleted both spike anonymous users; verified no spike policies, functions, tables or triggers and 0 anonymous users remain.
- Step 8 decision gate: Steps 2 to 4 all pass, so continue with Task 2 as written.
---

### Task 2: Live bindings, channel authorization and admin alerts (SQL)

**Files:**
- Create: `supabase/live.sql`
- Modify: `scripts/sql.mjs` (`SCHEMA_FILES` gets `live.sql` appended after `retention.sql`)
- Modify: `supabase/audit.sql` (`tripp.log_event` calls `tripp.live_alert` after its insert)
- Test: `tests/sql/070_live.sql`

**Interfaces:**
- Consumes: `tripp.sessions(token_hash, conversation_id, created_at, last_seen)`, `tripp.token_hash(text)`, `tripp.session_scope(text)`, `tripp.log_event(...)`, `tripp.settings`.
- Produces:
  - `tripp.live_bindings(uid uuid primary key, token_hash text not null references tripp.sessions(token_hash) on delete cascade, created_at timestamptz not null default now())`, with RLS enabled and no policies.
  - `public.m_live_bind(p_token text) returns json`: `{ok:true, scope}`, or the errors `no_user` (no `auth.uid()`) and `expired`. It upserts on `uid`. Granted to `authenticated` only.
  - Schema `tripp_live` (`create schema if not exists`; `revoke all on schema tripp_live from public`; `grant usage on schema tripp_live to authenticated`). It is not a PostgREST-exposed schema. It holds the two policy helpers below, because a `realtime.messages` policy runs as `authenticated`, which has no usage on `tripp` (Task 1 finding).
  - `tripp_live.live_scope() returns bigint`, SECURITY DEFINER and stable: the scope of the session bound to `auth.uid()`, using the same freshness rule as `session_scope` (`last_seen > now()-30 min`, `created_at > now()-12 h`). It **does not** touch `last_seen`. It returns null when there is no binding or the session is stale. Granted to `authenticated`.
  - `tripp_live.live_topic_ok(p_topic text) returns boolean`, SECURITY DEFINER and stable. For scope 0 it is true for `'admin'`, and for `'conv:<n>'` when conversation n exists. For scope > 0 it is true only for `'conv:' || scope`. Anything else is false, including a null scope and malformed topics (`'conv:abc'`, `'conv:'`, `'conv:1:2'`). Granted to `authenticated`.
  - Policies on `realtime.messages`: `tripp_live_read` (select, to authenticated, `using (tripp_live.live_topic_ok(realtime.topic()))`) and `tripp_live_write` (insert, to authenticated, `with check (realtime.topic() <> 'admin' and tripp_live.live_topic_ok(realtime.topic()))`). Adjust the insert policy if Task 1 Step 5 showed presence needs something different.
  - `tripp.live_alert(p_id bigint, p_type text, p_scope bigint, p_at timestamptz) returns void`: `perform realtime.send(jsonb_build_object('id',p_id,'type',p_type,'conversation',p_scope,'at',p_at), 'event', 'admin', true)` inside `begin … exception when others then null; end`.
  - `tripp.log_event` calls `tripp.live_alert` when `p_type in ('login','message','upload','call_start') and p_scope > 0`.
  - `tripp.settings.audit_seen bigint`, plus `public.m_audit_seen(p_token text, p_id bigint) returns json`, which is admin only and stores `greatest(audit_seen, p_id)`. `m_audit(... 'events' ...)` with `p_before null` also returns `'seen', audit_seen`.
  - `tripp.live_cleanup() returns void`: deletes `auth.users` where `is_anonymous` and `created_at < now() - interval '13 hours'`, and bindings whose session has gone. pg_cron job `tripp-live-cleanup` at `'45 8 * * *'`.

- [ ] **Step 1: Write the failing test `tests/sql/070_live.sql`**, using the existing harness style (assertions with `raise exception` on mismatch, inside the harness transaction). Simulate the caller with `set local role authenticated` where it matters, and with `select set_config('request.jwt.claims', json_build_object('sub', <uuid>, 'role','authenticated')::text, true)`. Cases:
  - no `sub` → `m_live_bind` returns `no_user`
  - bad token → `expired`
  - a guest session for conversation A binds and returns scope A. `live_topic_ok('conv:'||A)` is true; `conv:<B>`, `admin`, `conv:abc` and `conv:` are false
  - an admin session binds and returns scope 0. `admin` and `conv:<A>` are true; `conv:<max id + 1000>` is false
  - after `update tripp.sessions set last_seen = now() - interval '31 minutes'`, `live_scope()` is null and `live_topic_ok('conv:'||A)` is false
  - after `last_seen` is checked through `live_scope()`, its value is unchanged
  - after `delete from tripp.sessions where token_hash = …`, the binding row is gone
  - `tripp.log_event('message', A, null, null, '{}')` adds one `realtime.messages` row with `topic='admin'`, `event='event'`, `private=true`, and its payload `type='message'` and `conversation=A`
  - `tripp.log_event('message', 0, null, null, '{}')` adds no `realtime.messages` row
  - with `realtime.send` made to fail by the method recorded in Task 1 Step 6b, `tripp.log_event('message', A, …)` still returns an id. If Step 6b found no method, leave this case out, and the task's reviewer must confirm by reading that the only call to `realtime.send` sits inside the `exception when others` block
  - `m_audit_seen` from a guest → `forbidden`. From the admin with 5 and then 3, `audit_seen` is 5
- [ ] **Step 2: Run it and confirm it fails**

  Run: `TRIPP_DB_PASSWORD=… node scripts/sql.mjs test 070`
  Expected: `FAIL 070_live.sql`, because `m_live_bind` does not exist.
- [ ] **Step 3: Write `supabase/live.sql`** with the interfaces above, add it to `SCHEMA_FILES`, and add the `live_alert` call in `log_event`. Every statement must be idempotent (`create … if not exists`, `create or replace`, `drop policy if exists` before `create policy`, and `cron.unschedule` guarded by `exists` before `cron.schedule`).
- [ ] **Step 4: Apply the schema and run the whole suite**

  Run: `TRIPP_DB_PASSWORD=… node scripts/sql.mjs apply` then `TRIPP_DB_PASSWORD=… node scripts/sql.mjs test`
  Expected: every file reports `PASS`, including 070.
- [ ] **Step 5: Check exposure.** Run the Supabase security advisors. Also confirm that no table or view in `public` grants to `authenticated` anything beyond what `anon` already had, because anonymous users are `authenticated`. Expected: no new findings.
- [ ] **Step 6: Commit** `supabase/live.sql supabase/audit.sql scripts/sql.mjs tests/sql/070_live.sql` with the message "Live bindings, channel authorization and admin alerts".

---

### Task 3: Browser live client (`TrippLive`)

**Files:**
- Create: `site/vendor/supabase-2.117.3.js` (copied from `node_modules/@supabase/supabase-js/dist/umd/supabase.js` after `npm i -D @supabase/supabase-js@2.117.3`)
- Create: `site/live.js`
- Modify: `site/index.html`: load `vendor/supabase-2.117.3.js` then `live.js`, both before `app.js`. In the CSP, `connect-src` becomes `https://*.supabase.co wss://ohhkzjsdabdimlrgnagw.supabase.co`
- Modify: `scripts/deploy.ps1`: add `live.js` and `call.js` to the stamping list. The vendor file is named by version and is not stamped
- Modify: `package.json`: devDependencies `@supabase/supabase-js` `2.117.3` and `playwright` `1.48.2`, plus a script `"test:live": "node --test \"tests/live/*.test.mjs\""`
- Test: `tests/live/realtime.test.mjs`

**Interfaces:**
- Consumes: `m_live_bind`, `live_topic_ok` (Task 2); `window.supabase.createClient` (UMD global); `config.url` and `config.key`.
- Produces `window.TrippLive`:
  - `start(token: string) -> Promise<{scope: number}>`. It creates the client with `{ auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false } }`, then calls `signInAnonymously()`, then `client.rpc('m_live_bind', { p_token: token })`, then `client.realtime.setAuth()`. It rejects with an `Error` whose message is the RPC error code, or `'live'` for any other failure.
  - `channel(topic: string, presenceKey?: string) -> RealtimeChannel`, created with `{ config: { private: true, broadcast: { self: false }, presence: { key: presenceKey || '' } } }`.
  - `stop() -> Promise<void>`: `removeAllChannels()`, then `auth.signOut()`. It never rejects, and does nothing when not started.
  - `peerId: string`: `crypto.randomUUID()`, fixed for each page load.

- [ ] **Step 1: Write the failing test `tests/live/realtime.test.mjs`.** It runs against the live project. With pg (`TRIPP_DB_PASSWORD`) it inserts temporary sessions: admin (`conversation_id` null) and guest for a temporary conversation A it creates. In `after()` it deletes the sessions and the conversation and runs `tripp.live_cleanup()` style deletes for the anonymous users it made. It uses `@supabase/supabase-js` from node_modules (the same API as the vendored file). It writes nothing to `tripp.events` (no `log_event`), so the audit chain stays clean. Tests:
  - an unbound anonymous user subscribing to `conv:A` gets `CHANNEL_ERROR`
  - a bound guest gets `SUBSCRIBED` on `conv:A`, `CHANNEL_ERROR` on `conv:<A+1000>`, and `CHANNEL_ERROR` on `admin`
  - a bound admin gets `SUBSCRIBED` on `admin` and on `conv:A`
  - a guest broadcast on `conv:A` (`event 'call'`) reaches the admin within 5 s
  - a guest `send` to `admin` is not delivered to the admin within 3 s
  - `select realtime.send(..., 'event', 'admin', true)` from pg reaches the admin within 5 s
  - presence: the guest tracks on `conv:A`, and the admin's `presenceState()` holds the guest's key within 5 s
  - after the guest session row is deleted, a **new** guest subscribe with the same anonymous JWT gets `CHANNEL_ERROR`
- [ ] **Step 2: Run it and confirm the binding tests pass and nothing leaks.** Task 2 is already live, so this suite tests the server side directly. Any failure here is a Task 2 bug: fix it there first.

  Run: `TRIPP_DB_PASSWORD=… npm run test:live`
  Expected: all PASS.
- [ ] **Step 3: Write `site/live.js`** (IIFE that sets `window.TrippLive`, in the style of `crypto.js`), copy the vendor file in, and update `index.html`, the CSP, `deploy.ps1` and `package.json` as listed.
- [ ] **Step 4: Smoke-test in a browser.** Serve `site/` on `http://localhost:8000` (an allowed origin), using a headless Playwright page with a temporary admin session injected the Stage 0 way. Evaluate `TrippLive.start(token)` and subscribe to `admin`. Expected: `{scope: 0}` and `SUBSCRIBED`, with no CSP violations in the console.
- [ ] **Step 5: Commit** the vendor file, `live.js`, `index.html`, `deploy.ps1`, `package.json`, `package-lock.json` and the test, with the message "Live client with anonymous binding".

---

### Task 4: Wire the live connection into unlock and lock

**Files:**
- Modify: `site/app.js` (unlock path, `lock()`)

**Interfaces:**
- Consumes: `TrippLive.start/stop` (Task 3).
- Produces in `app.js`: `liveReady: Promise<number|null>`, set on unlock to `TrippLive.start(token).then(r => r.scope).catch(() => null)`. Every later live feature awaits it. A null value means live features stay hidden and the portal otherwise works as today.

- [ ] **Step 1:** In the unlock success path, start the live connection without delaying the portal: messages still render even if live fails. In `lock()`, call `TrippLive.stop()` after the portal is hidden. Keep the existing order: hide first, then clean up inside try/finally.
- [ ] **Step 2: Headless check.** As admin, unlock and then `lock()`. Expected: `supabase.auth` has no session after the lock, and `getChannels().length === 0`.
- [ ] **Step 3: Headless check.** Unlock as a guest of a temporary conversation through the `open` function, then fire `blur`. Expected: the guest is locked, and their anonymous user is signed out.
- [ ] **Step 4:** Run `npm run test:js` and `TRIPP_DB_PASSWORD=… node scripts/sql.mjs test`. Expected: all PASS.
- [ ] **Step 5: Commit** with the message "Start live connection on unlock, stop on lock".

---

### Task 5: Admin alerts, online dots and audit catch-up

**Files:**
- Modify: `site/index.html` (button `#desktop-alerts` hidden by default; `div#toasts` with `aria-live="polite"`; per-conversation `span.online-dot` in the list template)
- Modify: `site/app.js`
- Modify: `site/styles.css` (toast stack, online dot)

**Interfaces:**
- Consumes: the `admin` broadcast `event` payload `{id, type, conversation, at}` (Task 2); `liveReady`; `m_audit_seen` and the `seen` value from `m_audit` (Task 2).
- Produces in `app.js`:
  - `convChannels: Map<number, RealtimeChannel>` (admin: one per conversation in the list; guest: just its own)
  - `isOnline(conversationId) -> boolean`, true when that channel's presence holds a guest key
  - `onCallMessage(conversationId, payload)`, a hook that Task 7 fills in. Until then it does nothing

- [ ] **Step 1: Admin channels.** Once `liveReady` resolves to 0, subscribe to `admin` and handle broadcast `event`:
  - **Toast:** text from the strings table (`<label>` comes from the loaded conversation list). It shows for 6 s, at most 4 are on screen, and the oldest goes first.
  - **One alert per message:** an `upload` that arrives within 2 s of a `message` from the same conversation replaces that `message` toast with `<label> sent a file`, instead of adding a second toast.
  - **Unread:** mark that conversation unread in the list, reusing any existing unread styling or else a bold label.
  - **Desktop:** if `document.hidden` and `Notification.permission === 'granted'`, show `new Notification(text)`.
  - **Audit count:** increment the Audit log count.

  Admin also subscribes to `conv:<id>` for every listed conversation, tracking presence as `{role:'admin'}` keyed by `TrippLive.peerId`. Keep the set in step with list reloads, creation and deletion. Channel `call` broadcasts go to `onCallMessage`.
- [ ] **Step 2: Guest channel.** Once `liveReady` resolves to a scope > 0, subscribe to `conv:<scope>` and track presence `{role:'guest'}`.
- [ ] **Step 3: Online dots.** On presence `sync`, show the dot (aria-label `Online`) next to each conversation whose channel holds a guest key. The guest gets the same dot in their own header when an admin key is present.
- [ ] **Step 4: Desktop alerts button.** Show `#desktop-alerts` to the admin only, and only while `Notification.permission === 'default'`. Clicking it calls `Notification.requestPermission()` and hides the button.
- [ ] **Step 5: Audit catch-up.** The Audit log button reads `Audit log (N)`, where N counts events with id > `seen`. N is worked out from the first `m_audit('events')` page loaded at unlock, capped at 99+. Opening the viewer calls `m_audit_seen` with the newest id, and the label goes back to `Audit log`.
- [ ] **Step 6: Headless end-to-end** (Playwright, two contexts: admin through an injected session, guest through `open` for a temporary conversation T with a known password; delete T afterwards). Expected:
  - the admin sees `T signed in` within 5 s of the guest unlocking
  - the admin sees the online dot on T, and the guest sees the admin dot
  - the admin sees `T sent a message` within 5 s of the guest posting a body
  - after the guest locks, the admin's dot clears within 10 s

  Write the visit and event ids it created into `docs/OPS-NOTES.md`.
- [ ] **Step 7:** Run the JS and SQL suites and confirm everything passes. **Commit** with the message "Admin alerts, presence dots, audit catch-up".

---

### Task 6: Call metadata RPC (SQL)

**Files:**
- Modify: `supabase/live.sql`
- Test: `tests/sql/080_calls.sql`

**Interfaces:**
- Consumes: `session_scope`, `token_visit`, `log_event`.
- Produces `public.m_call(p_token text, p_conversation bigint, p_call uuid, p_action text, p_detail jsonb default '{}') returns json`, granted to anon and authenticated (it is token-checked like every `m_*`):
  - **Scope:** guest calls use their own scope, so `p_conversation` must be null or equal to it, or the call returns `forbidden`. The admin must give an existing conversation, or the call returns `bad_conversation`.
  - **Actions:**
    - `'start'` needs `p_detail.kind` set to `'audio'` or `'video'` (else `bad_input`) and logs `call_start`.
    - `'answer'` logs `call_answer`.
    - `'end'` needs `p_detail.reason` in (`'hangup'`,`'declined'`,`'missed'`,`'failed'`,`'lock'`) and `p_detail.relay` in (`'host'`,`'srflx'`,`'prflx'`,`'relay'`,`'unknown'`), else `bad_input`. It logs `call_end`.
    - Any other action returns `bad_input`.
  - **Event detail:** `{call, conversation, kind?, reason?, relay?, duration_s?}`. The scope follows the Stage 0 convention: a guest logs under their own id, the admin under 0 with `detail.conversation`. `duration_s` is the whole seconds from the first `call_answer` event with the same `detail.call` to now, or null if the call was never answered. `ref_id` is null.
  - **Result:** returns `{ok:true, event: <id>}`. Both parties may log `end` for the same call, and both rows stay, because each party's observation goes on the record.

- [ ] **Step 1: Write the failing test `tests/sql/080_calls.sql`.** Cases:
  - a guest `start` with kind `video` logs `call_start` with scope A and the right detail
  - a guest with `p_conversation` set to another id → `forbidden`
  - an admin `start` without a conversation → `bad_conversation`; with conversation A it logs scope 0 and `detail.conversation = A`
  - `answer`, then `end` with `hangup`/`host`, gives `duration_s >= 0`
  - `end` without an answer gives a null `duration_s`
  - a bad reason, a bad relay, a bad kind or an unknown action → `bad_input`
  - an expired token → `expired`
  - a guest `start` adds a `realtime.messages` alert row (from Task 2) of type `call_start`
- [ ] **Step 2: Run the test and confirm it fails.** Run: `… node scripts/sql.mjs test 080`. Expected: FAIL.
- [ ] **Step 3: Implement `m_call` in `live.sql`.**
- [ ] **Step 4:** Apply and run the full suite. Expected: all PASS.
- [ ] **Step 5: Commit** with the message "Call metadata on the audit record".

---

### Task 7: Calls in the browser (`TrippCall`)

**Files:**
- Create: `site/call.js`
- Modify: `site/index.html` (load `call.js` before `app.js`; add the call buttons, `dialog#call-incoming` and `dialog#call-panel` with `video#remote-video` (`autoplay playsinline`) and `video#local-video` (`autoplay playsinline muted`); add the CSP `media-src blob: mediastream:` only if Step 6 shows it is needed)
- Modify: `site/config.js` (`iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }]`)
- Modify: `site/app.js` (fill in `onCallMessage`, the buttons, the incoming flow, and ending the call from `lock()`)
- Modify: `site/styles.css`
- Test: `tests/js/call.test.mjs`

**Signaling protocol:** broadcast event `call` on `conv:<id>`. Every payload has `{t, call, from}`, where `call` is a UUID and `from` is `TrippLive.peerId`.

| `t` | Extra fields | Sent by | Meaning |
| --- | --- | --- | --- |
| `ring` | `kind` | caller | Ring every endpoint on the other side |
| `accept` | — | callee endpoint | Wants the call |
| `taken` | `by` | caller | First accept won; other endpoints stop ringing |
| `offer` | `to`, `sdp` | caller → winner | |
| `answer` | `to`, `sdp` | winner → caller | |
| `ice` | `to`, `candidate` | either | |
| `end` | `reason` | either | Tear down; the receiver logs its own `end` |
| `decline` | — | callee endpoint | That endpoint stops ringing. When every ringing endpoint on the other side has declined, the caller ends with `declined` |

Messages carrying `to` are ignored by every other peer. A side only rings for messages from the opposite role, so admin endpoints ignore other admin tabs. Timers: no `accept` within 45 s → the caller ends with `missed`. ICE state `failed`, or `disconnected` for more than 10 s → `failed`.

**Interfaces:**
- Consumes: `TrippLive.peerId`, `convChannels`, `m_call` (Task 6), `config.iceServers`.
- Produces pure helpers on `window.TrippCall`, unit-tested in Node:
  - `glareWinner(myCallId: string, theirCallId: string) -> 'mine'|'theirs'`, where the lexicographically smaller id wins
  - `relayFromStats(report: Iterable<RTCStats>) -> 'host'|'srflx'|'prflx'|'relay'|'unknown'`, which follows the `transport.selectedCandidatePairId`, or else the nominated succeeded `candidate-pair`, to its `local-candidate.candidateType`
  - `shouldHandle(msg, me: {peerId, role}, senderRole) -> boolean`, which handles the `to` filtering and the opposite-role rule
  - `CallSession`: wraps `RTCPeerConnection` plus `getUserMedia`. `constructor({channel, conversationId, kind, role, onState})`. Methods: `placeCall()`, `acceptIncoming(ringMsg)`, `decline(ringMsg)`, `handle(msg)`, `toggleMute()`, `toggleCamera()`, `hangUp(reason)`. `onState(state)` fires with `'calling'|'ringing'|'connecting'|'connected'|'ended'` plus `{reason}`. `hangUp` stops every track, closes the connection, broadcasts `end`, and calls `m_call('end', {reason, relay})` exactly once per session.

- [ ] **Step 1: Write the failing test `tests/js/call.test.mjs`**, loading `site/call.js` through `vm.runInThisContext`, as `crypto.test.mjs` does. Cases:
  - `glareWinner('a','b') === 'mine'` and `glareWinner('b','a') === 'theirs'`
  - `relayFromStats` with a selected pair whose local candidate is `relay` gives `'relay'`; with no transport but a nominated succeeded `srflx` pair it gives `'srflx'`; empty gives `'unknown'`
  - `shouldHandle`: a message with `to` set to another peer → false; a message from the same role → false; `ring` from the opposite role with no `to` → true
- [ ] **Step 2:** Run `npm run test:js` and confirm `call.test.mjs` fails.
- [ ] **Step 3: Implement `site/call.js`.**
  - Media constraints are `{audio:true}`, plus `video:{width:{ideal:1280},height:{ideal:720}}` for video calls.
  - The caller logs `start` once the ring is broadcast, and the winning callee logs `answer` once its local description is set.
  - The ring tone is a Web Audio oscillator (no audio file): 440 Hz, 1 s on and 2 s off, while incoming or calling.
- [ ] **Step 4: Wire it into `app.js`.**
  - **Buttons:** `Call` and `Video call` appear in the conversation header only when `isOnline(current)` (admin) or the admin dot is on (guest), and no call is active.
  - **Incoming:** `dialog#call-incoming` shows the strings from the table, with Answer and Decline. Admin rings come from any conversation channel.
  - **Permission prompt:** set `askingMedia` around `getUserMedia`. While it is set, guest `blur`/`visibilitychange` blanks the page without locking, with a 60-second fallback, reusing the `pickingFile` mechanism.
  - **Lock:** `lock()` calls `activeCall.hangUp('lock')` before `TrippLive.stop()`.
  - **Only one call at a time:** a second incoming `ring` while busy gets a `decline`.
  - **Glare:** while ringing out, an incoming `ring` from the other side triggers `glareWinner`. The loser has already logged `start` for its own call id, so it logs `end` with reason `hangup` and relay `unknown` for that id, sends no `end` broadcast, and answers the winning ring.
- [ ] **Step 5:** Run `npm run test:js`. Expected: all PASS.
- [ ] **Step 6: Headless two-context check** with `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`, an admin plus a guest of temporary conversation T. Check that:
  - the admin video-calls, the guest answers, and both reach `connected`
  - `getStats` shows `bytesReceived` growing on both sides for 3 s
  - hang up ends both sides
  - no CSP violations appear
- [ ] **Step 7: Commit** with the message "Two-party audio and video calls over Realtime signaling".

---

### Task 8: Call scenarios end to end + audit check

**Files:**
- Create: `tests/e2e/calls.mjs` (Playwright script, run with `TRIPP_DB_PASSWORD=… node tests/e2e/calls.mjs`, against `http://localhost:8000`)
- Modify: `docs/OPS-NOTES.md`

- [ ] **Step 1: Write the scenario script.** Admin uses an injected session; guests sign in through `open` for a temporary conversation T. Each scenario asserts both UIs and then the `tripp.events` rows (read with pg) whose `detail->>'call'` matches:
  1. **Guest audio call, admin answers, admin hangs up:** `call_start` (scope T, kind audio), `call_answer` (scope 0), and two `call_end` rows, both reason `hangup`, `duration_s >= 2` on the admin row, relay in (`host`, `srflx`, `prflx`)
  2. **Admin calls, guest declines:** `call_start` (scope 0, conversation T); the caller logs `call_end` with reason `declined`; no `call_answer`
  3. **Admin calls, nobody answers:** after 45 s, `call_end` with reason `missed`
  4. **Guest is in a call and fires `blur`:** the guest is locked; the admin UI shows `Call ended` within 10 s; there are `call_end` rows with reason `lock` (guest) and `hangup` or `failed` (admin); the guest's tracks have `readyState === 'ended'`
  5. **The guest is mid-permission-prompt** (simulate by firing `blur` while `askingMedia` is true): the page blanks but does not lock; the call proceeds once focus is back
  6. **Two guest tabs on T, admin calls:** both ring; tab 1 answers; tab 2 stops ringing within 3 s; only one `call_answer` row
  7. **Glare:** admin and guest press Call within 100 ms; exactly one call connects. There are two `call_start` rows (one per call id). The losing call id has exactly one `call_end` with reason `hangup`, and only the winning call id has a `call_answer`
- [ ] **Step 2: Run it.** Expected: all 7 pass. Run the full SQL suite and confirm `tripp.verify_chain('events')` and `('visits')` are still true.
- [ ] **Step 3: Clean up and record.** Delete T and the test sessions, and run the anonymous-user cleanup. Record every visit and event id the run created in `docs/OPS-NOTES.md` under "Test sign-ins during the Stage 2–3 build".
- [ ] **Step 4: Commit** with the message "End-to-end call scenarios".

---

### Task 9: Deploy, spec update, handover

**Files:**
- Modify: `docs/superpowers/specs/2026-10-27-tripp-media-and-audit-design.md`:
  - §11: the new order is 0 → 2 → 3 → 0.5 → 1 → 4 → 5, with a dated owner-directive note
  - §12a: record the spike result (anonymous binding, or the fallback)
  - §5: the token is a Supabase anonymous session bound by `m_live_bind`, not a self-minted JWT, if that is what Task 1 chose

- [ ] **Step 1:** Run the SQL, JS and live suites. Expected: all PASS.
- [ ] **Step 2:** Run `pwsh scripts/deploy.ps1`. Fetch the published `index.html` and confirm it references `live.js?v=`, `call.js?v=` and `vendor/supabase-2.117.3.js`, and that the CSP contains `wss://ohhkzjsdabdimlrgnagw.supabase.co`.
- [ ] **Step 3:** Run a headless smoke test against `https://cv.princerehman.com/Tripp/`: admin injected session plus a guest of temporary conversation T. Check the alert, the dot, and one audio call reaching `connected`. Clean up, then record the ids in OPS-NOTES.
- [ ] **Step 4:** Commit the spec, OPS-NOTES and plan results with the message "Stages 2 and 3 live". Do not push `main`.
- [ ] **Step 5:** Hand over:
  - Ask the owner to check, in a real browser on two devices: an alert, the online dot, a video call from phone to desktop, and a guest switching apps mid-call.
  - Ask the owner to click **Desktop alerts** once.
  - Mention the limit: calls across strict networks (some mobile carriers, corporate firewalls) may fail until Stage 4 adds a relay.

**Task 9 results (2026-10-28):** SQL, JS (44) and live (9) suites pass. Deployed to gh-pages; published index.html carries `live.js`, `call.js` and `app.js` with `?v=20261029042122`, `vendor/supabase-2.117.3.js`, and `wss://ohhkzjsdabdimlrgnagw.supabase.co` in the CSP. Headless smoke test against the live URL passed 7/7 (alert, unread mark, both online dots, audio call connected and ended, no CSP violations); ids are in `docs/OPS-NOTES.md`.
