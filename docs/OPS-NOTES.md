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
| Task 8 | 448 to 496 (49 visits, one per guest sign-in) | 1288 to 1469 (182 events) | user agent contains `HeadlessChrome`, temporary conversations T (343 to 356). Fourteen runs of `tests/e2e/calls.mjs`, some of them only scenario 7 (glare) while the script was being finished; three of the runs (T 350, 351 and 355) were cut short by auth rate limiting (HTTP 429 on anonymous sign-in), which left mostly login rows. The passing full run is T 356: visits 489 to 496, events 1435 to 1469 (logins 1435, 1440, 1443, 1446, 1452, 1457, 1458, 1463; scenario 1 1436 start, 1437 answer, 1438 and 1439 end; scenario 2 1441 start, 1442 end; scenario 3 1444 start, 1445 end; scenario 4 1447 start, 1448 answer, 1449 and 1450 end, 1451 logout; scenario 5 1453 start, 1454 answer, 1455 and 1456 end; scenario 6 1459 start, 1460 answer, 1461 and 1462 end; scenario 7 1464 and 1465 start, 1466 end of the losing call, 1467 answer, 1468 and 1469 end). Every other id in these ranges is from an earlier run of the same script. Two glare runs (T 352, visits 478 to 485, calls 1416 and 1417; and an earlier T 343 run, calls 1317 and 1318) got stuck with both sides on Calling, and their calls were ended by the test's own cleanup, so those pairs have only the ends the cleanup caused. Admin events have scope 0 and no visit |
| Task 8 fix round 1 | 578 to 593 | 1725 to 1815 (events 1725 to 1759 only for the full run) | user agent contains `HeadlessChrome`, temporary conversations T (405 for the full run, then one each for eight glare-only runs). Full run T 405: visits 578 to 585, events 1725 to 1759 (same layout as the passing run above; scenario 7 is 1754 and 1755 start, 1756 end of the losing call, 1757 answer, 1758 and 1759 end). Eight glare-only runs: visits 586 to 593, events 1760 to 1815, seven each (login, two starts, loser end, answer, two ends). Ids between 1725 and 1815 that are not listed belong to nobody else: every id in 1760 to 1815 is from these runs. Visit ids 497 to 577 and event ids 1470 to 1724 were made by other activity and are not part of this task |

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
