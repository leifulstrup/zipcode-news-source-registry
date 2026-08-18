# Contributing to the source registry

Every row you add saves the next publisher in your county the hours you just
spent. Two rules matter more than the rest: **verify before you write**, and
**never include personal information**.

## What belongs here

Public data sources and outlets that inform local coverage: open-data portals,
police and 311 feeds, assessor and recorder records, courts, permits and zoning,
inspections, schools, transit, parks, elections, local news outlets, civic
organizations.

## What does NOT belong here — ever

- **Any personal information**: no contributor names, emails, addresses,
  coordinates, or instance URLs. `kit_version` records what verified a row, not
  who. PRs containing personal data will be closed rather than edited.
- **Jurisdiction-specific adapters.** The `data/` rows are data, full stop. Code
  belongs in `lib/` only when it is *generic to a platform* (Socrata, ArcGIS,
  Accela) and unit tested — see [TOOLKIT.md](TOOLKIT.md). Your county's adapter
  lives in your own repo. Nothing here is ever installed or imported by a running
  publication; anything a publisher uses, they copy and review first.
- **Anything you have not actually fetched.** A row is a claim that you checked
  this source on `last_verified`. "It appears in a search result" is not a check.
- **Paywalled scrape recipes, credentials, or API keys.**

## How to add or update a row

1. Fork, edit `data/<STATE>.csv` (create it from the header of another state file
   if your state has none yet).
2. **Live-test the source first.** Fetch it. Confirm it covers the jurisdiction
   you are claiming. Confirm it still updates — query the newest record's date
   from the data itself, never trust a portal's `updatedAt` metadata, which
   often reflects file touches rather than new data.
3. Fill every column. Blank `place_fips` for county- or state-wide sources.
4. Put what you learned the hard way in `traps`, semicolon-separated. This is
   the highest-value column in the file. Good examples:
   - a name field is space-padded, so equality filters return 0 rows with HTTP 200
   - the feed runs N days behind, so a nominal weekly window is always empty
   - this portal is the wrong jurisdiction for most of the county but outranks
     the right one in search
   - 403s to non-browser clients — alive, but manual-only
5. Set `last_verified` to the date you checked, and `kit_version` to the tool
   version you used (or `manual`).
6. Keep rows sorted by `(county_fips, place_fips, category, source_id)`, quote
   any field containing a comma or quote (RFC4180), use LF line endings.
7. Open a PR describing what you verified and how.

## Updating an existing row

Re-verifying a stale row and refreshing its `last_verified` is a one-line
contribution and one of the most useful things you can do here — a registry that
pretended freshness would be worse than no registry.

If a source has changed shape, update `status` (`degraded`, `manual-only`,
`dead`) and add a trap explaining what happened. **Do not delete dead rows**:
knowing a source died, and when, saves someone else from rediscovering it. Mark
it and leave it.

## Review standards

A maintainer will check that the row's jurisdiction is plausible, the URL
resolves, the schema is valid, and no personal information is present. Reviewers
cannot re-verify every source, which is exactly why consumers are instructed to
treat every row as a lead requiring their own live test and their own approval.
