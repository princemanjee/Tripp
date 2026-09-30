# Specification Input: Browser-Based Financial Terminal (Godel-class)

A real-world demonstration input, derived from a complete crawl of godelterminal.com on 2026-08-14, with the product owner's permission: all 78 sitemap URLs, including the landing page, pricing, the full asset-class and data-coverage matrix, all 48 command documentation pages, troubleshooting, six persona pages, three feature pages, two press releases, four careers postings, the terms of service, privacy policy, and cookie policy, plus one response from the site's AI support chatbot. Everything stated below is published fact from those sources. Marketing claims that no published source quantifies are listed in Notes for quarantine, and the remaining non-observable areas are listed there too; the emission is expected to surface those as gaps rather than invent them.

## What we want

A browser-based financial terminal for equity research teams, traders, wealth teams, and corporate IR, using the command syntax buy-side analysts already know from legacy terminals, so no retraining is needed. The positioning target: a $30,000-per-seat legacy terminal cannot go on every desk, so most of a team shares one seat or waits their turn. This product puts a seat on every desk starting at $996 per year, and sits beside the legacy stack rather than replacing it ("Bloomberg for the PM, Godel for analysts" is the stated common adoption pattern).

The analyst types a short command with a ticker and gets an instant panel. Panels tile into a keyboard-driven, multi-window, multi-screen workspace with persisted layouts that sync across devices.

## Command grammar

- Universal syntax: `[Security Identifier] [Country] [Asset Class] [Command] [Args]`, for example `AAPL US EQ G 1m`. Global commands run bare (QM, FX, HELP).
- Legacy-terminal compatibility aliases: GIP and GP resolve to G; OPT, CALL, and PUT resolve to OMON; SEARCH and TK resolve to SECF; CN and NH resolve to N; TR resolves to TAS.
- Global keys: backtick focuses the command line (rebindable); F1 opens HELP; double-tap Esc closes the active window; Tab and Shift+Tab cycle windows; shortcut chords move, snap, and resize windows; Ctrl/Cmd+Z restores the last closed window.

## Features: command set

Company and security analysis:
- DES: one-screen overview with business description, real-time chart, market cap, valuation ratios (trailing and forward P/E, P/S, P/B, EV/EBITDA), dividend and yield block, beta, short interest, float, insider and institutional percentages, plus single-key jumps to G, N, CHAT, FA, EM, ANR.
- FA: standardized income statement, balance sheet, and cash flow, quarterly and annual, exportable to Excel or JSON ("into your model or your LLM"), each line item tied to its underlying filing.
- ERN: consensus EPS estimates by period (low, high, average, analyst count, implied forward P/E) plus an estimate-versus-actual history with beat and miss percentages; default range five years.
- EM: earnings matrix across 11 metrics (Sales, EBITDA, Net Income, EPS, assets, liabilities, equity, three cash-flow lines), values, growth, and implied multiples tables (P/E, P/B, P/S, P/CF, EV variants, dividend yield) for trailing, next four quarters, and each fiscal year; equities and depositary receipts outside Canada only.
- SI: short interest from FINRA, published twice monthly, with days-to-cover ratio and average daily volume.
- GR: ratio and spread analysis of any same-asset-class pair, with rolling correlation (default window 120 observations, range 2 to 730) and OLS regression (beta, adjusted beta, alpha, R squared, standard errors, t-test).
- ANR: analyst ratings with firm, analyst, rating, target, date; green and red highlighting for upgrades and downgrades; exportable.
- DVD: dividend history, trailing and forward yield, growth rates, full declaration-to-payable date table.
- HDS: institutional holders from 13F filings, treemap view, Enter opens the original filing.
- EVT (coming soon): consolidated per-company event timeline.

Market data and surveillance:
- QM: streaming watchlists, up to 400 tickers per list, batch import with a matching log and duplicate skipping, universal watchlists that sync across every window and device, configurable columns including live bid and ask with sizes, per-row feed latency in milliseconds, delayed-quote "D" markers, flash on update, international symbols with venue suffixes (AZN LN, 700 HK, 6758 JT).
- FOCUS: distraction-free single-security view with native OS popout; covers treasuries via Tradeweb (US30Y, US10Y, US5Y, US2Y, US3M, DE10Y, JP10Y, UK10Y), FX pairs, crypto, indices, and named futures (E-mini S&P, E-mini Nasdaq, treasury futures, gold, silver).
- TAS: the live tape, every print with price, size, market center, and condition code, all decoded in-app (30 plus condition codes; market centers include the exchanges, FINRA TRF, and ADF; crypto tapes decode Coinbase, Binance, Kraken, Bitstamp).
- ALLQ: every venue listing of a security in an expandable share-class, composite, venue tree with live best bid and ask.
- HCP and HP: historical change and price tables, infinite scroll or paging at 100 rows, Excel and JSON export; daily resolution for all accounts, hourly and minute resolutions gated behind an entitlement.
- WEI and WEIF: world equity indices and index futures (WEIF currently Americas only, paid accounts only).
- GLCO: global commodity futures across energy, metals, meat, grain, softs.
- FX: full cross matrix of 14 currencies with converter (amounts up to one quadrillion), rate resolution by direct pair, inverse, or USD-leg cross.
- MOST: most-active rankings (volume, gainers, losers, dollar volume) with sector, market-cap, and count filters.
- HALT: today's U.S. trading halts from the Nasdaq trader feed with decoded reason codes (LUDP, T1, T3, T12, H10, D).
- N: real-time and historical news. Per-window filters (query, symbols or watchlist, date cutoff) plus account-global advanced filters: tri-state include and exclude selection over sources, categories, and languages, up to 20 include and 20 exclude keyword strings, a class-action spam filter, and a curated "Recommended" default set. Pause and resume, breaking-news banner, sanitized in-terminal reader with PDF export, text-to-speech for paid users. Free users are limited to two N windows per screen.
- TOP: Reuters' curated top 15 headlines, ranked by Reuters, updating live.
- TREND: most-searched tickers across all users, timeframes one hour to one month, 30-second auto-refresh.
- SECF: universal search across equities, corporate bonds (TRACE), sovereign bonds, options, futures, FX, crypto, indices, and people (analysts and executives); people contact details are paid-gated; instrument rows stream live prices.
- IMAP and HMAP (beta): intraday sector wheel and market-cap-weighted heatmap for S&P 500, DJIA, or any personal watchlist.

Portfolio and risk:
- EQS (beta): global equity screener with range filters (market cap, P/E, P/S, P/B, P/CF forward and trailing, forward EPS and revenue) and list filters (venue, HQ country, sector, sub-sector), currency selection, Excel and JSON export.
- OMON: full option chains, live via websocket, with bid, ask, last, volume, IV, and Greeks including Delta, Gamma, Vega, Theta, Rho, Lambda, Epsilon; calls, puts, or both; per-mode column memory; contract click-through to chart or pricing.
- OVME: Black-Scholes calculator with live-attached spot, defaults of 20 percent volatility, 5 percent rate, 30 days; full call and put Greeks.
- CALC: standard, scientific, and time-value-of-money finance modes.
- BROK: read-only brokerage connections via SnapTrade covering 14 named brokerages (including Fidelity, Schwab, Interactive Brokers via Flex Query, Robinhood, Webull); the product can never place trades.
- AUM: aggregate connected-brokerage assets, both a global total across all users (refreshed roughly every 24 hours) and personal totals; a brokerage discount applies above 5,000 dollars linked plus one eligible trade per month.

Charting:
- G: TradingView-powered charting with candle styles, the full indicator library, drawing tools, per-chart persisted settings, price alerts that feed AL desktop notifications, custom date ranges, log and percent scales, and snapshot export. Up to 30 chart windows per screen. Color-linking groups windows so same-color windows follow one ticker (sync G, DES, N, OMON).
- HMS: multi-security normalized comparison (change percent or dollar value).

Utilities and community:
- HELP: syntax tutorial, keystroke table, and the full enabled-command list.
- CHAT: public channels, auto-created per-ticker symbol channels, invite-only groups, and DMs (paid only); five room permission tiers; 38 custom emotes; inline live quote pills and embedded charts in messages; message search (paid); the #general feed powers the WJI sentiment index.
- WJI: a live sentiment gauge computed from bullish and bearish emote usage in #general, with ten named sentiment levels.
- ACM: profile, subscription, and billing management through Stripe, including a FINRA professional upgrade toggle.
- AL: one-shot price, volume, and change alerts with desktop notifications.
- NOTE: rich-text notes, autosaved every 10 seconds, account-persisted.
- ENT: self-service add-on entitlements for exchange feeds and premium features, each showing retail and professional prices per billing interval, with prorated immediate billing.
- PDF: settings hub covering four theme colors, four monospace fonts, six table animations, window snap grid (2 to 50 pixels), per-source ticker-click default commands, pinned commands, breaking-news banner rules, terminal key rebinding; preferences sync across devices.
- CHANGE: versioned changelog with executable command pills.

## Data coverage and latency, as published

- Real-time: U.S. equities (NASDAQ, NYSE, NYSE American, Cboe BZX, OTC, overnight session), U.S. indices, OPRA and Cboe options, TRACE corporate bonds, treasuries, CME, CBOT, NYMEX, COMEX, ICE, and Eurex futures, FX, crypto.
- Delayed: international equities 15 minutes across roughly 20 exchanges; international indices 25 minutes; ICE U.S. softs 25 minutes.
- SEC filings real-time from EDGAR, every form type since company inception; earnings call transcripts next day, navigable by speaker; standardized financials real-time on filing; daily private-markets pricing is claimed on a persona page.
- Every quote carries a delay-class marker ("D" when delayed) and watchlists show per-row feed latency in milliseconds. Live data streams over websockets.
- A portion of the data is hand-entered and hand-verified by an in-house data operations team (per the Data Entry and Research Associate posting, an Excel and Word workflow).

## Access tiers, pricing, and billing

- Tiers: anonymous (no bid/ask, register prompts), free ("piker": no DMs, no chat search, no TTS, no AUM, no WEIF, two N windows per screen, people contact data blurred), paid, and Team/Enterprise ORG (organization billing, optional private chat channel, compliance suite with audit logs and audit trails, dedicated representative, shared workspaces).
- Pricing: 118 dollars per month or 996 dollars per year per seat; FINRA-licensed users pay a 30 dollar per month professional-subscriber surcharge; 14-day free trial on every plan; the trial "opens most of the product".
- Entitlement add-ons are self-service per exchange or feature, priced retail versus professional, billed prorated immediately.
- Payments through Stripe: Visa, Mastercard, Amex, Discover, CashApp, bank; USD only; auto-renew; cancellation from ACM takes effect at the end of the paid term.
- Referral program through Rewardful: referee gets 30 percent off the first month, referrer earns 20 percent of every payment for the life of the subscription, paid monthly via PayPal.

## Named third-party components

TradingView (charting engine), SnapTrade (brokerage connectivity), Stripe (payments and billing), Rewardful plus PayPal (referrals), Reuters (ranked top news), SEC EDGAR (filings), Nasdaq trader feed (halts), FINRA (short interest), Tradeweb (treasury quotes), social login via Facebook and X, Cloudflare (bot management on the marketing site, which is Squarespace-hosted), Google Analytics, Adobe Analytics, Meta pixel, Google Ads.

## Technology stack and scale, from the careers postings and the support chatbot

- Frontend: TypeScript, React, WebSockets, Web Workers; charting via HTML Canvas and 2D drawing (D3, SVG skills required); WASM compiled and run in production; a "game programmer's approach" to performance.
- Backend: polyglot JVM (Kotlin and Java) plus Python and Rust; Spring Boot; Kafka event streaming; large-scale processing frameworks (Apache Beam or Spark); Flink listed as desirable.
- Data: PostgreSQL and Clickhouse; "multi-billion-row databases".
- Infrastructure: AWS; Kubernetes and Docker; Terraform and Pulumi as infrastructure as code; Grafana and Prometheus for monitoring, alerting, and logging.
- Scale claims from careers pages: sub-second UIs, thousands of concurrent users, ships daily.
- The support chatbot, citing published material, confirmed AWS, Docker, Kubernetes, Terraform, Grafana, and Prometheus, and explicitly could not confirm dual-cloud or failover architecture or the server operating system.
- Engineering team is in-person in New York City; compensation bands published (140K to 300K plus equity).

## Company and funding

- Entity: DL Software Inc, Delaware (dba Godel Terminal), founded 2024; co-founder Martin Shkreli per the company's own press releases and careers page.
- Funding: 2 million dollar pre-seed led by dao5, Naval, and Evolve Ventures, with angels including co-founders from Anduril, Rippling, Flexport, Intercom, Lambda, Replit, and Ankr; 5 million dollar seed led by Infinitum with Flex Capital and continued dao5 participation.
- Status: public beta; press claims "millions of dollars of rapidly growing revenue" and users with combined assets above 1 billion dollars.
- Named customer story: the DARP ETF (managed by Grizzle) runs its research stack on the product; its Portfolio Manager Thomas George is quoted; claimed savings roughly 28,000 dollars per analyst per year.
- Sister DL products named in press: Neets (text-to-speech API), Dr. Gupta (AI physician), Shoggoth (image generation).

## Users

- Equity Analyst: types commands, builds watchlists, reads filings and news, exports financials to Excel or an LLM workflow.
- Portfolio Manager: portfolio-wide news feed, pair-trade and relative-value analysis, peer-set comparison.
- Trader or individual: focus tabs, the tape, option chains with Greeks; framed as reclaiming "up to 50 percent of a trader's P&L" spent on data.
- Wealth team, RIA, family office: per-client saved layouts, client-holding news, replaces a stack of eleven named point tools.
- IR and corporate team: peer benchmarking, historical news rewind around past stock reactions, 13F and short-interest monitoring of their own name.
- Team or Compliance Administrator: ORG seats, billing, compliance suite, audit logs.
- Community participant: chat rooms, sentiment index, trending tickers.

## Legal and compliance posture, from the published terms, privacy policy, and cookie policy

- Not a broker or registered investment advisor; strictly informational; any specification must preserve this posture (data, never advice).
- Terms: Delaware law with AAA binding arbitration and a class-action waiver; liability capped at six months of fees; license is personal or internal-business use only; systematic data retrieval, scraping, redistribution, derivative datasets, and competing use are prohibited; credential sharing is prohibited (one login, one user); age 18 plus; the service disclaims HIPAA and FISMA compliance and forbids GLBA-violating use; termination at company discretion.
- Privacy: Stripe is the named payment processor and holds all payment data; connecting a brokerage authorizes use of that account data for operating the service, "improving and training the Company's data models and algorithms", and anonymized aggregate products; retention runs up to 12 months past account termination with category-specific schedules; rights procedures for 20 U.S. states plus GDPR, PIPEDA, and POPIA sections; targeted advertising is disclosed; Do-Not-Track signals are not honored.
- Cookies: essential (Cloudflare), analytics (Google, Adobe), advertising (Meta, Google Ads, DoubleClick, X), consent-managed by category.
- The FINRA surcharge exists to cover professional-subscriber exchange data fees, implying per-exchange professional and non-professional classification obligations.

## Notes

- Marketing claims with no published quantification, to be quarantined rather than encoded: news "delivered in milliseconds"; "largest news database available"; the 28,000 dollar annual savings figure; "up to 50 percent of a trader's P&L" on data; one billion dollars of combined user assets; "hundreds of thousands of users" across DL products; the careers-page engineering claims (multi-billion rows, sub-second, thousands concurrent) are stated by the company but unverifiable externally.
- Beta or coming soon, currently out of committed scope: EVT, IMAP, HMAP, EQS v2 and v3, PORT portfolio analytics, MEMB index membership, GF and EQRV time series, ETF and mutual fund data, more private company data, full bond profiles, podcasts, the public API (REST and WebSocket exist case-by-case for enterprise).
- Still non-observable from any public source: the specific exchange and news vendor contracts and their license and redistribution terms; entitlement enforcement internals; authentication and session internals beyond the named social logins; failover and high-availability topology; the server operating system; the subprocessor list (published only "on request").
