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
