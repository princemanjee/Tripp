# Tripp — Media, Live Calls, and Audit Logging

**Design document.** 2026-10-27. Status: **COMPLETE — all open questions resolved;
awaiting owner approval to proceed to the Stage 0 implementation plan.**

This describes an expansion of the Tripp secure messaging portal
(`cv.princerehman.com/Tripp/`). It is written so a competent builder could plan
and build from it without re-interviewing the owner. Functional truth for the
existing system lives in `specs/SPEC.md` and `supabase/schema.sql`; this document
sits on top of that and adds to it.

---

## 1. Intent and why

Tripp today is a password-gated messaging portal: one admin, many conversations,
each conversation with its own password. The browser holds only a Supabase
*publishable* key and may call a small set of password/token-checked `m_*` SQL
functions. Everything else in the database is private. There is no server to run.

The owner wants Tripp to become a richer, **evidentiary-grade** communications
portal. Two motives drive every decision here:

1. **Fuller communication** — not just text, but attached files, recorded audio
   and video messages, and live two-way audio/video calls when both parties are
   online at the same time.
2. **Truth and transparency, on the record** — because the portal may be audited,
   handed to counsel, or produced in an investigation or e-discovery, it should
   capture and retain as much verifiable context about each visit and action as
   is reasonable: who connected, when, from where, on what device and browser,
   and what they did. The record covers *everyone*, the admin included, and is
   written so that it cannot be quietly altered after the fact. A log that also
   binds the person who controls it is harder to attack and more credible in a
   proceeding.

The owner's stance, carried from prior sessions: the repo and specs stay public
(security through obscurity is not relied upon); passwords are whatever the owner
sets and any value is accepted (no composition rules); and infrastructure that
must be trusted should, where practical, run on hardware the owner controls.

## 2. Goals

- Attach files inline to any conversation message (both parties + admin).
- Send recorded **audio messages** and **video messages** in a conversation.
- Hold **live two-way audio/video calls** when both parties are logged in at once.
- **Admin alerts in the browser** when any user logs in, sends a message, or
  starts a call (and related events), in real time while the admin tab is open.
- **Per-visit audit logging**: date/time, IP address, ISP/organization,
  geolocation (country/region/city, approximate coordinates), device OS
  (Windows / macOS / iOS / Android / Linux / other), and browser. Logged for
  every party including the admin, and append-only (tamper-evident).
- **Per-action audit logging**: login success/failure, message sent, file/media
  uploaded, call initiated/answered/ended, admin moderation actions.
- A **three-tier relay strategy** for live calls, tried in this order:
  **(1) peer-to-peer / STUN → (2) cloud-hosted coturn → (3) self-hosted coturn on
  the Mac Studio** — all active at once, with automatic fallback.
- A **keep-alive** that prevents the Supabase projects for **Tripp** and **HOPE**
  from being cold-stored after 7 days idle.

## 3. Non-goals and anti-goals

- **NG — group calls / multi-party rooms.** Calls are strictly two-party
  (the admin and one conversation's other person). No conferencing bridge.
- **NG — true OS push notifications** in the first cut. Admin alerts require the
  admin's browser tab to be open. A service-worker/web-push layer is a possible
  later stage, explicitly deferred.
- **NG — transcription, content analysis, or AI processing** of audio/video.
- **NG — recording of live calls** in the first cut. Live call *media* is
  peer-to-peer and not captured; only call *metadata* (who/when/how long/which
  relay) is logged. Recording the media itself is a separate decision with its
  own consent and legal weight — flagged in open questions, not assumed.
- **Anti-goal — a log that the admin can silently rewrite.** If the audit trail
  is trivially editable by the person who controls the portal, it is worthless as
  evidence. Append-only and admin-inclusive are hard requirements, not nice-to-haves.
- **Anti-goal — leaking media or presence to anyone outside a conversation.** A
  conversation's files, recordings, call signaling, and online-status must not be
  reachable by other conversations or by an unauthenticated holder of the
  publishable key.

## 4. Constraints and current architecture

- **Hosting:** static site on GitHub Pages (`site/`, deployed to `gh-pages` via
  `scripts/deploy.ps1`). No application server. This does not change.
- **Backend:** Supabase project `ohhkzjsdabdimlrgnagw`. No Supabase Auth users.
  Access is the publishable key + `m_*` SECURITY DEFINER functions over the
  private `tripp` schema, each checking a password or session token itself.
- **Session model:** `m_open` exchanges a password for an opaque session token
  (sha256-hashed in `tripp.sessions`); scope 0 = admin, >0 = a conversation id.
  Tokens are memory-only in the browser.
- **New subsystems this project introduces** (all within the same Supabase
  project): **Storage** (private bucket for files/recordings), **Edge Functions**
  (Deno — to validate a session token and mint signed URLs, scoped realtime
  tokens, and TURN credentials), and **Realtime** (presence, broadcast, call
  signaling, admin alerts). This is a deliberate, significant expansion of surface
  area and is the main source of new risk.

## 5. The hard problem: securing Realtime and Storage without auth users

The current model has no JWT identity — just the anon publishable key and
session tokens checked *inside* SQL functions. Supabase Realtime and Storage,
by contrast, normally authorize via RLS against an authenticated JWT. Used naively
with only the publishable key, **any holder of that key could subscribe to any
channel or read any file** — unacceptable for a secure portal.

**Chosen approach: mint a short-lived, scoped token on login.**

- On `m_open` success, in addition to the existing session token, an **Edge
  Function** issues a **scoped Supabase JWT** whose claims encode the caller's
  scope (admin, or a specific `conversation_id`) and a short expiry (minutes,
  renewable while the session is active).
- **Realtime Authorization** (RLS on `realtime.messages`) then gates channels so
  a conversation's party may only join that conversation's channel; the admin may
  join the admin alert channel and any conversation's signaling channel.
- **Storage** uses a **private bucket**. The browser never reads or writes it
  directly with the publishable key. Instead it calls an Edge Function that
  validates the session token and returns a **short-lived signed upload URL** (for
  posting a file/recording) or **signed download URL** (for fetching one), scoped
  to that conversation. Object paths are namespaced by conversation id.

This keeps the project's founding principle intact — *the secret check lives in
code we control, not in client-trusted RLS alone* — while letting Storage and
Realtime do their jobs. It is the riskiest and most intricate part of the build
and is sequenced early (Stage 2) so everything after it rests on a proven base.

## 6. Audit logging design

Two new append-only tables in the `tripp` schema, written **only** by
SECURITY DEFINER functions / Edge Functions (never directly by the client):

- `tripp.visits` — one row per authenticated session open: timestamp, scope
  (admin / conversation id), IP, ISP/org, geo (country, region, city, lat, lon),
  OS family, browser family, raw user-agent, and the geo-lookup source. Also a row
  for **failed** logins (scope null), so denial patterns are on the record too.
- `tripp.events` — one row per auditable action: timestamp, scope, event type
  (`login`, `login_failed`, `message`, `upload`, `call_start`, `call_answer`,
  `call_end`, `admin_hide`, `admin_archive`, `admin_delete`, `admin_conv_save`,
  `admin_conv_delete`, `admin_key_change`), a reference id where applicable, and a
  small JSON detail blob (e.g. call duration, relay tier used, file type/size).

**Tamper-evidence.** Both tables are append-only by construction: the `m_*`
functions only `INSERT`, never `UPDATE`/`DELETE`, and no function is exposed that
mutates them. For stronger evidentiary weight, each row carries a `prev_hash` /
`row_hash` chain (hash of the row's canonical fields + the previous row's hash),
so any later deletion or edit breaks the chain and is detectable. The admin's own
actions are logged on the same footing as everyone else's. (Hardening note: true
immutability against someone with direct Postgres superuser access is out of
scope — the owner holds the DB password. The chain makes tampering *evident*, not
*impossible*, which is the honest and achievable bar here.)

**IP enrichment (ISP + geo).** The API gateway already exposes the client IP to
`tripp.client_ip()` via `x-forwarded-for`. An Edge Function on login calls a
geo-IP service (candidate: ip-api.com free tier — returns ISP/org, city, region,
country, lat/lon; ~45 req/min; non-commercial use only) and stores the enrichment
on the visit row. Device OS and browser are parsed from the user-agent. All of
this is best-effort: if the lookup fails, the raw IP and user-agent are still
recorded and the field is marked `unknown`, never blocking login.

## 7. Media: attachments, audio messages, video messages

All three share one pipeline and extend the existing `tripp.messages` row:

- A message may carry zero or more **attachments** (`tripp.attachments`: id,
  message_id, storage path, kind = `file | audio | video`, mime, byte size,
  duration for a/v, created_at).
- **Upload:** browser records (via `MediaRecorder` for audio/video) or selects a
  file → requests a signed upload URL from the Edge Function (session-token
  checked) → uploads directly to the private Storage bucket under
  `conversation/<id>/...` → calls `m_post` (extended) to create the message +
  attachment rows and write an `upload` audit event.
- **Download/playback:** the thread render requests a short-lived signed download
  URL per attachment from the Edge Function, which re-checks the session token and
  that the attachment belongs to the caller's conversation.
- **Visibility** honors the existing rules: hidden/archived flags apply to a
  message and its attachments uniformly; the other party never sees hidden ones,
  the admin always can.
- **Limits** (defaults, adjustable): file 25 MB; audio message 5 min; video
  message 2 min. Enforced client-side for UX and server-side (signed-URL size cap
  + row check) for truth.

## 7a. Encryption, bulk export, and key management (added 2026-10-27)

Owner requirements: media/attachments stored **encrypted**; a **bulk export** that
packages DB records + their encrypted files into a portable, **itself-encrypted**
container restorable to another table/device later ("double encryption" — at-rest
*and* export-level, justified because exports travel out of the controlled
environment to GitHub/other storage); a **separate key store** so files and
exports are always recoverable; exports **chunked to ≤50 MB** so a GitHub repo (or
similar) is a viable destination.

- **At-rest encryption (client-side, app-level).** Files are encrypted **in the
  browser** with AES-GCM before upload, so Supabase Storage only ever holds
  ciphertext — even the provider cannot read media. Large media is encrypted in
  chunks to stay within browser memory limits. (Supabase Storage also encrypts at
  rest with provider keys; app-level encryption sits on top so trust does not rest
  on the provider.)
- **Per-item data keys + a root master key.** Each file/conversation gets its own
  random data-encryption key (DEK). DEKs are stored in the **separate key store**,
  themselves encrypted under a **root master key (the KEK)**. The KEK is **never
  stored in any database** — it is derived at unlock from **two factors**
  (§14 Q6, RESOLVED): `KEK = KDF(keyfile_secret + passphrase)`, where the keyfile
  is on the owner's USB drive/image (from the §15 keyfile tool) and the passphrase
  is in the owner's head. Neither factor alone works. This is the only arrangement where
  "keys are backed up so nothing is lost" and "an attacker who reaches the key
  store still gets nothing" are both true. **The key store is the single most
  sensitive asset in the system** and is designed accordingly: encrypted under the
  KEK, backed up on the owner's triple-redundant layer, never exposed to the
  browser or to the publishable key.
- **Export container.** A bulk export is a **SQLCipher single-file SQLite
  database** (self-contained, portable, restorable on any device) holding the
  selected rows plus their ciphertext blobs, then itself encrypted and **split
  into ≤50 MB parts**. Restore = reassemble parts → decrypt with the KEK → attach
  as a table elsewhere. SQLite/SQLCipher chosen over a raw `pg_dump` because it is
  self-contained and restorable without a running Postgres.
- **GitHub as a destination (honest caveat).** ≤50 MB chunks make GitHub *viable*
  (100 MB hard limit, 50 MB warning). But a repo is not built for binary blobs
  (bloat, no easy deletion from history) and the owner's repos are **public** —
  acceptable only because the exports are strongly encrypted ciphertext, though it
  still publishes the ciphertext and its size/metadata. Dedicated object storage
  is the better home; GitHub stays a supported option per the owner's request.
- **Potential issues flagged for the owner (see §14 Q6):** key-management
  recursion (the KEK must live offline or the scheme is theater); losing the KEK
  means permanent unrecoverability; client-side crypto of large video is
  memory-bound and must be chunked; public-repo ciphertext broadcasts metadata.

## 8. Live calls (WebRTC) and the three-tier relay

- **Presence:** a Supabase Realtime presence channel per conversation shows the
  admin and the other party whether the counterpart is currently online — the
  precondition for offering a live call.
- **Signaling:** WebRTC offer/answer/ICE candidates are exchanged over a Realtime
  channel scoped to the conversation (gated by the Stage-2 scoped token). Media
  itself never touches Supabase.
- **ICE server list**, handed to the browser per call, tried in the owner's
  chosen order:
  1. **Direct / STUN** — free; succeeds for most networks. (A STUN server; coturn
     also serves STUN once it exists.)
  2. **Cloud coturn** — relay fallback on an owner-controlled cloud box
     (candidate: Oracle Always-Free ARM, with the honest reclamation caveat noted
     below; or a small paid VPS).
  3. **Self-hosted coturn on the Mac Studio** — last-resort relay on the owner's
     own hardware at `coturn.princerehman.com`.
  All three are listed simultaneously; WebRTC's ICE tries them and uses whichever
  connects, so a dead relay simply yields no candidates and the next is used.
- **TURN credentials** are **short-lived, HMAC-timed** (coturn's `use-auth-secret`
  scheme), minted per call by an Edge Function after a session-token check — never
  a static secret in the public JS.
- **Call metadata → Supabase, always.** Regardless of which relay carries a call,
  the app writes `call_start` / `call_answer` / `call_end` events (with duration
  and the relay tier used) to `tripp.events`. coturn's own logs are secondary; the
  authoritative audit record lives in Supabase in one place.

**Relay hosting caveats (honest):**
- *Mac Studio self-hosted coturn* requires: not being behind CGNAT (owner has
  **confirmed** a real public IP); a DNS record for `coturn.princerehman.com`;
  router port-forwarding; `external-ip` set because of the home-NAT + Docker-VM
  double NAT; a **narrowed** UDP relay range (Docker Desktop on macOS can't
  publish the full 49152–65535) e.g. 49160–49200; and lockdown (required
  credentials, denied private/loopback peers) so it can't be abused as an open
  relay. It is also the first always-on box this project must keep patched, and it
  exposes ports from the public internet to the home LAN — a real new attack
  surface.
- *Oracle Always-Free* is an excellent zero-cost place to build and prove the
  cloud tier, with two caveats for audit-critical use: ARM capacity can be
  unavailable at signup, and idle Always-Free compute has historically been
  reclaimed. Moving coturn to a paid box later is a config-identical swap.

## 9. Admin alerts

While the admin tab is open, the admin subscribes to an **admin alert channel**
(Realtime broadcast, gated by the admin scoped token). The `m_*` functions /
Edge Functions emit an event on that channel when a party logs in, sends a
message, uploads media, or initiates a call. The admin UI surfaces these as
in-page toasts/badges and (with the user's permission) the browser Notifications
API for a desktop toast while the tab is in the background. True push when the tab
is closed is deferred (NG in §3).

## 9a. Anti-leak measures for non-admin sessions (added 2026-10-27)

Owner intent: non-admin users should not be able to screenshot or walk away from
an exposed page; only the admin keeps that freedom.

- **Screenshot prevention is NOT possible on the web — stated plainly.** No
  browser API blocks or reliably detects OS screenshots, Snipping Tool, or a phone
  camera. This cannot be promised. What follows is the achievable substitute,
  accepted by the owner (2026-10-27).
- **Focus-loss blank + lock (enforceable, two-tier).** For non-admin sessions, the
  instant the tab loses focus or is hidden (`blur` / `visibilitychange` / window
  minimize / app switch), the content is **blanked synchronously** — the DOM goes
  invisible immediately so a snapshot of the now-background tab, or a
  screen-recording caught mid-alt-tab, shows nothing — and the session then drops
  to the lock screen, wiping the in-memory token and forcing password re-entry.
  Admin sessions are exempt. Honest limits: does not stop a screenshot taken while
  the tab is *still focused*, and is deliberately aggressive UX (any app-switch
  locks the user out).
- **Forced identity watermark (the real substitute for screenshot blocking).**
  Every non-admin view carries a tiled, semi-transparent overlay stamped with the
  conversation identity + timestamp + IP. Screenshots cannot be prevented, but any
  that are taken are **traceable to the leaker** — for an evidentiary portal, a
  self-incriminating leak is arguably better than a blocked one. Admin views are
  unwatermarked.
- **Copy / right-click / text-selection deterrents** for non-admins — friction,
  not protection; stated as such.

## 10. Supabase keep-alive (Tripp + HOPE)

A scheduled job issues a trivial query against both the **Tripp**
(`ohhkzjsdabdimlrgnagw`, `sb_publishable_` key) and **HOPE**
(`rjzzumzzdlsdfvyntlzu`, legacy anon JWT — see §12) Supabase projects every few
days so neither free-tier project is paused after 7 days idle. Chosen mechanism
(changed by the owner, 2026-10-27: **no GitHub Actions or GitHub-hosted workflows,
ever**): a small **Docker container on the owner's machine** (the Mac Studio) running
cron every 3 days. It calls a no-op read on each project using its public key
(branching on key prefix for the auth header). It needs no secrets: the
publishable keys are already public.

## 11. Build stages (dependency-ordered)

Each stage is shippable and additive; nothing in a later stage rewrites an
earlier one.

- **Stage 0 — foundations & quick wins (no new always-on infra).**
  Supabase keep-alive (Tripp + HOPE); per-visit and per-action **audit logging**
  (tables, hash-chain, IP/geo/UA enrichment, wired into existing `m_*`); **inline
  file attachments** (Storage private bucket + Edge Function signed URLs +
  extended `m_post`/`m_list`) with **client-side AES-GCM encryption** (§7a); the
  **key store** + root-KEK scheme (§7a); the **retention window + legal-hold**
  flag (§14 Q2); the **consent notice + logged acknowledgement** (§14 Q3); and the
  non-admin **focus-loss lock + identity watermark** (§9a). Proves the Storage +
  Edge-Function + encryption pattern on the lowest-risk feature. *(Scope grew with
  the 2026-10-27 answers; Stage 0 may be split into 0a/0b at planning time to keep
  it shippable.)*
- **Stage 0.5 — bulk encrypted export** (§7a): SQLCipher container, ≤50 MB
  chunking, KEK-based restore. Depends on Stage 0's encryption + key store.
- **Stage 1 — recorded audio & video messages.** Reuses the Stage-0 upload
  pipeline with `MediaRecorder`. Pure client + reuse; no new backend concepts.
- **Stage 2 — realtime foundation + admin alerts.** Scoped-token minting; Realtime
  authorization; presence; admin alert channel and UI. The hard security work;
  everything live-call depends on it.
- **Stage 3 — live calls, peer-to-peer / STUN only.** WebRTC signaling over
  Realtime; call metadata logging. Usable calls for most networks, no relay cost.
- **Stage 4 — cloud coturn relay.** Second ICE tier; HMAC-timed TURN creds via
  Edge Function. Raises call success toward ~100%.
- **Stage 5 — self-hosted Mac Studio coturn relay.** Third ICE tier on
  `coturn.princerehman.com`. Needs the owner's DNS + router actions.

## 12. Owner action items (only the owner can do these)

- ☐ **DNS:** add an `A` record `coturn.princerehman.com` → home public IP; add
  dynamic-DNS if that IP is not static. *(Stage 5)*
- ☐ **Router:** port-forward to the Mac Studio's reserved LAN IP — UDP 3478,
  TCP/UDP 5349, and the narrowed relay range (exact range fixed at coturn config
  time). *(Stage 5)*
- ☐ **Cloud relay account:** provision the cloud coturn host (Oracle Always-Free
  or chosen VPS). *(Stage 4)*
- ☐ **Database password** when direct DB work is needed (never stored).
- ☑ **HOPE project URL + key — FOUND (2026-10-27)** in `C:\Code\GitHub\Hope\index.html`.
  Project ref `rjzzumzzdlsdfvyntlzu`, URL `https://rjzzumzzdlsdfvyntlzu.supabase.co`,
  custom domain `hope.princerehman.com`. Key is a **legacy anon JWT** (role `anon`,
  long-lived, public by design — confirmed by the comment in
  `Hope\supabase-setup.sql`). The keep-alive ping needs only this public key. Note:
  HOPE uses the older anon-JWT style (sent as `Authorization: Bearer`), Tripp uses
  the newer `sb_publishable_` key — the keep-alive job branches on the key prefix,
  same as `site/app.js` already does.
- ☑ **Root master key (KEK) — RESOLVED (2026-10-27): keyfile + passphrase**, KEK =
  KDF(keyfile + passphrase). Keyfile comes from the §15 keyfile tool; passphrase is
  owner-held. Actual secret values are generated/entered by the owner at deploy
  time, never stored or shared. *(Stage 0 encryption can design against this now;
  the keyfile tool itself is a parallel project, §15.)*

## 12a. Resolved during builder-check (builder's calls, recorded here)

- **Scoped-JWT feasibility (risk, de-risk first in planning).** Everything in
  Stages 2–5 assumes an Edge Function can mint a short-lived scoped JWT that
  Supabase **Realtime Authorization** will trust. This project is on the new
  publishable-key system, where projects often use asymmetric signing keys and
  Supabase steers toward its own Auth sessions. **This is the riskiest assumption
  in the document.** It is a fact to verify, not an owner preference: the first
  task of Stage 2 planning is a spike that confirms either (i) a self-signed
  scoped JWT is accepted by Realtime and the Edge Function can reach the signing
  material, or (ii) we must use Supabase Auth anonymous/custom sessions instead —
  in which case the login path and token model in §5 adjust. Flagged so it is
  proven before the back half is committed, not during it.
- **Multiple sessions on one password (calls/presence).** A conversation password
  is shared and not bound to one device, so two guest sessions (or two admin tabs)
  can be live at once. Builder's call: presence is modeled **per connection**, not
  per scope; signaling carries a **per-session peer id**; a call offer **rings all
  endpoints** currently present on the other side, **first to answer wins** and the
  others stop ringing. This keeps "two-party" true at the media layer while
  tolerating the shared-password reality. Revisit only if the owner wants a
  single-device constraint.
- **Admin catch-up on missed events.** Because every action is in `tripp.events`,
  the admin **audit-log viewer** (already a §13 deliverable) doubles as the
  backfill: on login it shows events since a stored `last_seen` marker with an
  unread indicator, so a closed tab misses live toasts but never loses the record.
  No separate unread subsystem; it reads `tripp.events`.

## 13. What is left to the builder

- Exact schema DDL for `tripp.visits`, `tripp.events`, `tripp.attachments`, and
  the extensions to `m_post` / `m_list` / `m_open`; the hash-chain field layout.
- Edge Function implementations (signed URLs, scoped-token minting, TURN creds,
  geo-IP enrichment) and their deployment via the Supabase project.
- Realtime channel naming, authorization RLS policies, and the presence protocol.
- coturn Docker configuration (both cloud and Mac Studio) and the ICE-server
  payload shape.
- UI for: attachment compose/preview, audio/video record widgets, call ringing/
  in-call/ended states, admin alert surface, and an admin **audit log viewer**
  (read-only, with hash-chain verification indicator).
- The specific geo-IP provider and its failure handling; retention policy for
  media and logs.
- Testing: the project's convention is schema + function tests run inside
  BEGIN/ROLLBACK on the live DB, and live end-to-end UI checks; extend that to the
  new functions, and add WebRTC/Realtime integration checks.

## 14. Open questions for the owner (answers change what gets built)

0. **RESOLVED (owner, 2026-10-27): option (b) — keep true delete.** Preservation
   does not live in the live table; it lives in the owner's **backup layer**
   (cold storage + incremental backups + rsync, triple-redundant). So `m_msg`
   delete and `m_conv_delete` stay destructive on the live DB, and deleted content
   is recovered from backup when needed. The hash-chain still detects in-place
   tampering of present rows; deletions are recoverable out-of-band. Build
   implication: no soft-delete/tombstone model; the existing delete functions are
   kept as-is, and an `admin_delete` / `admin_conv_delete` event is still written
   to `tripp.events` so the *fact* of deletion is on the record even though the
   content is restored from backup rather than the live table. The design must
   **not** silently assume content lives forever in the DB.

   *(original question, kept for the record)* Today the
   admin can *permanently* destroy content: `m_msg(..., 'delete')` is a hard
   `DELETE`, and `m_conv_delete` hard-deletes a conversation and cascade-deletes
   every message in it. This directly contradicts §1/§3 (append-only, admin-
   inclusive, "harder to attack in a proceeding") — an `admin_delete` *event*
   records that a deletion happened but not *what* was deleted; the body and
   attachments are gone. Options: **(a)** make delete non-destructive — a
   tombstone/soft-delete that hides content from the live view but retains the
   body, attachments, and Storage objects for the record (strongest evidentiary
   stance; `m_conv_delete`'s cascade changes too); or **(b)** keep true delete and
   accept that the audit trail has an intentional, owner-controlled hole. This
   also governs retention (Q2). My recommendation: **(a)**, since it is the whole
   point of the pivot. Answer changes the data model, the cascade behavior, and
   the delete functions.

1. **RESOLVED (owner, 2026-10-27): metadata only.** Live call media is NOT
   recorded until the owner has consulted a lawyer on consent-law exposure
   (two-party-consent jurisdictions). Only `call_start`/`answer`/`end` metadata is
   logged. Full-stream recording stays a deferred, lawyer-gated decision.
2. **RESOLVED (owner, 2026-10-27): window + legal hold, duration set after legal.**
   Build an auto-expiry window for live media/logs **plus** a legal-hold flag that
   freezes anything tied to an active matter so it never auto-expires. The actual
   duration is a config value the owner sets after consulting the lawyer. See the
   new **§7a** for the encryption/export/key-management requirements added with
   this answer.
3. **RESOLVED (owner, 2026-10-27): notice + logged acknowledgement.** The lock
   screen shows the logging/retention notice and requires the user to acknowledge
   it; the acknowledgement is written to `tripp.events`. (Users also sign forms
   out-of-band before being granted access.) Anti-leak measures (focus-loss lock,
   identity watermark) added in the new **§9a** — note the honest limit there:
   screenshot *prevention* is not possible on the web.
4. **Geo-IP provider.** ip-api.com free tier is non-commercial; if Tripp is ever
   commercial, we need a paid/licensed source (MaxMind GeoLite2 self-hosted is a
   free-license alternative). Which way?
5. **RESOLVED (owner, 2026-10-27): decide at Stage 4.** Stages 0–3 need no cloud
   relay; the host is chosen when Stage 4 is reached.
6. **RESOLVED (owner, 2026-10-27): both — a keyfile AND an in-head passphrase.**
   The root key is derived from two factors together: `KEK = KDF(keyfile_secret +
   passphrase)` (KDF = Argon2id or equivalent). The **keyfile** lives on a generic
   USB drive or disk image (produced by the separate keyfile-tool project — see
   §15); the **passphrase** is held only in the owner's head and entered at
   unlock. Neither factor alone unlocks anything. This defeats theft or **cloning**
   of the drive (useless without the passphrase) and shoulder-surfing of the
   passphrase (useless without the keyfile). **Honest ceiling:** it does NOT defeat
   a host already compromised at unlock time — a keylogger plus a file read can
   capture both factors the moment they coexist in memory, because a passive drive
   (unlike a true secure element) must be read by the host to be used. The accurate
   claim is "cannot be defeated by cloning or theft of the drive," not "unhackable."
   The keyfile tool is built as its own project and then slotted in here as the
   §7a KEK source.
```

## 15. Related project (separate): the keyfile tool

The §7a/§14-Q6 KEK depends on a **keyfile** produced by a separate, not-yet-
designed project: a tool that generates a secret keyfile onto a generic USB drive
or disk image (VHDX/VMDK/ISO/VeraCrypt volume), and derives the KEK as
`KDF(keyfile_secret + passphrase)`. It is its own project with its own
brainstorm/design/plan, to be built in parallel (possibly another session) and
then **slotted into Tripp as the KEK source** once ready. Until it exists, Stage 0
can be built and tested with a **passphrase-only KEK** behind the same KDF
interface, so the keyfile factor drops in later without reworking Tripp. Honest
ceiling carried from §14 Q6: a passive keyfile is clone/theft-resistant (with the
passphrase) but not resistant to a host compromised at unlock time; only a true
secure element closes that last gap.

### 15a. Option for the keyfile tool: cross-device passphrase ("remote keypad")

Owner idea (2026-10-27): keyfile (USB) on the PC where messages are read, but the
passphrase entered from a *second device* via the app URL. Buildable as a remote-
keypad: the second device relays the passphrase over TLS through the existing
Realtime channel, bound to the PC session by a pairing code/QR; the PC combines
keyfile + passphrase locally to derive the KEK; nothing stored. **Benefit:**
defeats a keylogger on the reading PC (the passphrase is never typed there).
**Limits:** the passphrase leaves the owner's head onto the phone and transits the
relay (mitigated, not eliminated); the decrypted content and the derived KEK still
live in the reading PC's memory, so this protects the passphrase, not the plaintext,
against a compromised reading machine; and it needs session-pairing to avoid
injecting a passphrase into the wrong session. Deferred to the keyfile-tool
brainstorm; Stage 0's passphrase-behind-a-KDF interface already accommodates where
the passphrase is collected later.
