# Tripp ops notes

## Test sign-ins during the Stage 0 build

All of these are in `tripp.visits`, dated 2026-10-28, from 71.228.62.184. They
were made by the build's own tests, not by a person.

| Task | Visit ids | How to tell |
| --- | --- | --- |
| Task 6 | 1, 25 | os and browser `other`, user agent `node` |
| Task 6b | 74, 75, 76, 77, 78, 79 | os and browser `other`, user agent `node` (76 and 79 are `denied`) |
| Task 7 | 80 to 98 | user agent contains `HeadlessChrome/130` (89 and 93 are `denied`) |
| Task 12 | 102, 103, 104, 105 | user agent contains `HeadlessChrome/130` |

No other visit has os or browser `other` or `HeadlessChrome` in its user agent.

Not test sign-ins: 49 and 73 (the owner, Chrome). Visits 99, 100, 101 and 106
are admin sign-ins from regular Chrome 156 on Windows and are not listed above.

## Test sign-ins during the Stage 2-3 build

Made by the build's own headless tests on 2026-10-28, not by a person. Each row
is a sign-in through `open` plus the events it caused.

| Task | Visit ids | Event ids | How to tell |
| --- | --- | --- | --- |
| Task 4 | 301 | 823, 824 | user agent contains `HeadlessChrome`, temporary conversation |
| Task 5 | 328, 329 | 897, 898, 899, 900 | user agent contains `HeadlessChrome`, temporary conversation T (897 and 328 from a first run that stopped early; 898 login, 899 message, 900 logout from the passing run) |
| Task 7 | 439, 440, 441 | 1238 to 1259 | user agent contains `HeadlessChrome`, temporary conversations T (337, 338, 339). Run 1 (visit 439): 1238 login; video call 1239 start, 1240 answer, 1241 and 1242 end; audio call declined 1243 start, 1244 end; 1245 start and 1246 answer of a third call that has no `call_end`, because the run stopped there and the browser was closed. Run 2 (visit 440): 1247 login, 1248 start, 1249 answer, 1250 end, 1251 end with reason `lock`, 1252 logout. Run 3 (visit 441, both sides calling at once): 1253 login, 1254 and 1255 start, 1256 end of the dropped call, 1257 answer, 1258 and 1259 end. Admin events here have scope 0 and no visit, from an inserted session row |
| Task 7 fix round 1 | 442, 443, 444 | 1260 to 1276 | user agent contains `HeadlessChrome`, temporary conversation T (340), one guest signing in three times. 1260, 1266, 1270 login; call that failed on purpose 1261 start, 1262 end `failed`; ringing guest locked 1263 start, 1264 logout, 1265 end `declined`; guest locked while the camera prompt was pending 1267 start, 1268 logout, 1269 end `declined`; idle-pause call 1271 start, 1272 answer, 1273 and 1274 end; 1275 admin logout and 1276 guest logout from the idle lock. Admin events have scope 0 and no visit |
| Task 7 fix round 2 | 445, 446, 447 | 1277 to 1287 | user agent contains `HeadlessChrome`, temporary conversations T (341, 342). First run (visit 445, T 341) stopped on a test-script error: 1277 login and 1278 `call_start`, which has no `call_end` because the browser was closed. Second run (T 342): 1279 login; guest locked while the camera prompt was pending 1280 start, 1281 logout, 1282 end `declined`; 1283 login; page visible but unfocused 1284 start, 1285 answer, 1286 and 1287 end. Admin events have scope 0 and no visit |

## Test admin events with no visit

From Task 8 on, admin-path tests used a session row inserted directly, with no
sign-in visit, so their admin events have a null `visit_id`. On 2026-10-28 these
are events 249, 254, 256, 257, 262 and 264 (`key_setup`, `admin_conv_save`,
`admin_conv_delete`).

## Gaps in ids

The ids in `tripp.visits` and `tripp.events` have gaps (for example visits 2 to
24). The SQL tests run inside transactions that are rolled back, and Postgres
does not give back identity values a rolled-back transaction used. Nothing was
deleted: every row stores the hash of the row before it, and
`tripp.verify_chain` checks the whole chain from its first row, so a removed row
would show up as a break.

## Keep-alive key

`ops/keepalive/keepalive.sh` contains the HOPE project's anon JWT. It is public
by design: it is the same key the HOPE site ships in its own pages, and it only
reaches what the anon role may reach.
