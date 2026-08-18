# Changelog

This repository is versioned so consumers can pin, compare, and know when the
schema changed. Two things move independently, and the version reflects the
**schema and tooling**, not the data:

- **Schema/tooling changes** get a version. Adding a column is a MINOR bump
  (additive; consumers tolerate unknown trailing columns). Renaming, removing,
  or reordering a column, or changing a value vocabulary incompatibly, is a
  MAJOR bump. Fixes and doc corrections are PATCH.
- **Data changes — new rows, corrected rows, refreshed `last_verified` dates —
  land continuously and do NOT get a version.** Pinning a release to freeze data
  would defeat the point: a stale row is the failure mode this registry exists
  to avoid. Consumers always read `main` for data; releases tell them whether
  the *shape* they parse has changed.

Format follows [Keep a Changelog](https://keepachangelog.com); dates are UTC.

## [2.2.0] — 2026-08-18

### Added
- **`bin/validate.mjs`, running in CI on every pull request.** A maintainer
  cannot re-verify every source in every PR — that is the whole reason consumers
  are told to treat rows as leads. So everything mechanical is settled before a
  human opens the diff: required columns, controlled vocabularies, FIPS shapes,
  URL and date formats, duplicate `source_id`s, sort order, and the rule that
  cannot be left to good intentions — **no contributor or resident identity**,
  matched by shape (emails, phone numbers, street addresses, coordinate pairs,
  parcel numbers). Warnings carry judgment prompts rather than blocking: a
  verification date over 180 days old, a row with neither traps nor insights, a
  dead row with no explanation.
- **Pull-request and issue templates.** The PR template asks what you actually
  ran, since a row is a claim that you fetched it on `last_verified` — "it
  appeared in a search result" is not a check.
- **Three documented contribution paths, ordered by friction**: an agent-driven
  PR from the starter kit's `/contribute-sources`, an issue for anyone who would
  rather not touch CSV, and a hand-edited PR.
- **A privacy note.** Rows never carry identity — enforced, not trusted. But a
  pull request is public and carries a GitHub account, so anyone who would rather
  not have theirs associated with a particular ZIP code should use the issue
  path. A contribution someone feels safe making is worth more than one they
  don't.

## [2.1.0] — 2026-08-18

### Added
- **The toolkit** (`lib/`, `bin/diagnose.mjs`, `test/`) — see
  [TOOLKIT.md](TOOLKIT.md). The CSV records *what* a source is and `patterns/`
  explains *how* each product behaves; this adds the executable form, so the
  parts of the work that are identical in every jurisdiction stop being
  rewritten in every jurisdiction.
  - `lib/http` (timeout, retry, browser UA, errors-inside-a-200),
    `lib/socrata` and `lib/arcgis` (count · maxDate · rows · groupCounts ·
    paginate · schema, plus the ArcGIS date-dialect prober and Hub org search),
    `lib/clean` (padding detection, date coercion across epoch/ISO/`M/D/YYYY`,
    dedupe, the string-date detector), `lib/checks` (the assertions a probe
    should make, including semantic ones), `lib/csv` (this schema, executable).
  - **`bin/diagnose.mjs`** — point it at a URL and get, in about a minute:
    platform, liveness, fields **with their types**, PII-shaped fields,
    freshness measured from the data rather than the portal's metadata,
    retention (rolling vs full — which decides whether year-over-year is even
    possible), padded string fields, how the source can be filtered to a ZIP —
    and a **draft registry row** with a list of what a human must still supply.
  - `test/` — 58 unit tests, zero dependencies, no network. Live behaviour is
    proven by running `diagnose` against a real endpoint, deliberately not in
    CI: a check that depends on a municipal portal fails for reasons unrelated
    to the code, and a flaky check trains people to ignore it.
- `patterns/arcgis.md`, matching the depth of `patterns/socrata.md`.
- `.github/workflows/ci.yml` — Node 20/22/24/latest matrix.

### Changed
- **The safety boundary is refined, not weakened.** README, ARCHITECTURE,
  CONTRIBUTING and `patterns/README` said "data only, never code". The rule was
  never "no code": it is that **a repository anyone can open a pull request
  against must never be a runtime dependency of a pipeline that publishes under
  someone's name.** Nothing here is installed or imported — `lib/` is copied and
  reviewed, `diagnose` is run by hand. "Leads, not authority" is unchanged, and
  now applies explicitly to rows `diagnose` drafts: it cannot know which
  government publishes a dataset, its category, or its class.

### Notes
Two live runs during development found real instances of documented traps: a
Socrata dataset whose catalog claims a 2026 update while its newest record is
2025-03-28 (508 days stale), carrying four zero-padded code fields; and an
ArcGIS layer holding 1 row older than 400 days out of 2051, where a naive
year-over-year query would print a five-figure false increase. Building the
ArcGIS client also surfaced a portability bug now handled: some servers
uppercase `outStatisticFieldName`, so a case-sensitive read returns undefined
and freshness silently fails on a healthy service.

## [2.0.0] — 2026-08-18

### Changed (breaking: 17 → 25 columns)
- **Schema v2.** Added eight columns capturing what an agent learns while
  vetting a source and would otherwise discard: `platform`, `update_cadence`,
  `lag_days`, `data_maturity`, `history_start`, `retention`, `quality`, and
  `insights`. Consumers written against v1 must be updated; the additions are
  appended, so parsers that read by column NAME continue to work.
- **`platform` is the column that transfers.** A URL is local knowledge; a
  product is general knowledge — an Accela portal behaves like an Accela portal
  in any state, so `search accela` surfaces what publishers elsewhere learned
  about software you are about to meet.
- **`traps` vs `insights`** is now an explicit distinction: traps break your
  code or return wrong rows silently (adapter concern); insights change how you
  write about the number (editorial concern).

### Added
- `ARCHITECTURE.md` — how independent publishing instances coordinate through
  reviewed pull requests without ever talking to each other.
- `patterns/` — per-platform reference recipes for querying, cleaning and
  probing, **read and adapted, never fetched and executed**. That boundary is
  the safety model: reading an example and writing your own code is ordinary
  engineering with a human in the loop; executing code fetched from a shared
  server inside a pipeline that publishes under your name is an unaudited
  dependency.
- `patterns/socrata.md` — first pattern document.

### Fixed
- Corrected this repo's own seed data from field verification:
  `data.lacounty.gov` is an ArcGIS Hub, not Socrata. Exactly why rows carry
  `last_verified` and why consumers are told to treat every entry as a lead.

## [1.0.0] — 2026-08-18

Initial release: 17-column schema, contribution rules, and seed rows for CA and
DC carrying the traps learned in field testing — a space-padded name field that
makes equality filters return zero rows with HTTP 200, a permits feed whose lag
turns a nominal week into a fabricated "none issued", officer-initiated records
inflating calls-for-service, and a city portal that is the wrong jurisdiction
for most of its county yet outranks the right one in search.
