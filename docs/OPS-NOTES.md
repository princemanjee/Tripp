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
