# Schema (v2)

One CSV per state at `data/<STATE>.csv`. RFC4180 quoting, header row required,
LF endings, no BOM. Rows sorted by `(county_fips, place_fips, category, source_id)`.

```
source_id,scope_type,state,county_fips,place_fips,jurisdiction,category,name,url,platform,api_type,geo_filter,source_class,status,update_cadence,lag_days,data_maturity,history_start,retention,quality,last_verified,kit_version,traps,insights,notes
```

**Required:** everything through `status`, plus `last_verified` and
`kit_version`. Everything else may be blank. **Blank means unknown — never a
default.** Fill in what you actually verified; guessing is worse than a gap,
because the next publisher will trust it.

## Identity and jurisdiction

| Column | Values / format |
|---|---|
| `source_id` | stable kebab slug, unique across all files, conventionally `<state>-<fips>-<short-name>` |
| `scope_type` | `state` \| `county` \| `place` \| `region` |
| `state` | 2-letter USPS code |
| `county_fips` | 5-digit, zero-padded (`06037`); blank for state scope |
| `place_fips` | 7-digit, zero-padded; blank for county/state scope |
| `jurisdiction` | human-readable, e.g. `Los Angeles County, CA` |

## What it is, and how to reach it

| Column | Values / format |
|---|---|
| `category` | `crime` \| `calls-for-service` \| `311` \| `permits` \| `zoning` \| `assessor` \| `deeds` \| `courts` \| `inspections` \| `schools` \| `transit` \| `parks` \| `elections` \| `parcels` \| `news` \| `civic` \| `other` |
| `name` | what a publisher would call it |
| `url` | endpoint or landing page |
| `platform` | the **product** behind it: `socrata` \| `arcgis-hub` \| `arcgis-server` \| `ckan` \| `accela` \| `tyler-eagle` \| `tyler-data` \| `granicus` \| `legistar` \| `civicplus` \| `civicclerk` \| `opengov` \| `seeclickfix` \| `qscend` \| `salesforce` \| `laserfiche` \| `custom` \| `unknown` |
| `api_type` | the **access shape**: `socrata` \| `arcgis` \| `ckan` \| `rss` \| `html` \| `pdf` \| `manual` |
| `geo_filter` | field name, or `point-in-polygon` \| `district-crosswalk` \| `city-name` \| `none` |
| `source_class` | `primary` \| `interestedPrimary` \| `secondary` |

**Why `platform` is separate from `api_type`, and why it earns a column:** the
platform predicts the API shape *and the traps* before you fetch anything, and —
uniquely among these columns — that knowledge **transfers across
jurisdictions**. An Accela permit portal behaves like an Accela permit portal in
any state; a Socrata site takes SoQL wherever it is. A publisher who has never
touched their own county's data can look up what other publishers learned about
the same product elsewhere (`registry.mjs search accela`). A URL is local
knowledge; a platform is general knowledge.

## What the data is actually like

These are the columns that decide whether a number can be published honestly.

| Column | Values / format |
|---|---|
| `status` | `live` \| `degraded` \| `manual-only` \| `dead` |
| `update_cadence` | `realtime` \| `hourly` \| `daily` \| `weekly` \| `biweekly` \| `monthly` \| `quarterly` \| `annual` \| `irregular` \| `unknown` |
| `lag_days` | integer: typical days between the event and its publication; blank if unknown |
| `data_maturity` | `preliminary` \| `final` \| `revised` \| `mixed` \| `unknown` |
| `history_start` | `YYYY` or `YYYY-MM-DD` — earliest available record |
| `retention` | `full` \| `N-years` \| `N-months` \| `N-weeks` \| `current-only` |
| `quality` | `excellent` \| `good` \| `fair` \| `poor` \| `unusable` |

Why each matters in practice:

- **`lag_days`** is the difference between a true statement and a fabricated
  one. A permits feed seven days behind returns zero permits for "this week"
  every week; printed, that becomes "no permits were issued," which is invented,
  not missing. Record the lag and downstream tools can name the window the data
  actually covers.
- **`data_maturity`** — `preliminary` data gets reclassified for weeks, so a
  re-query will not match what was printed. That drift is late reporting and
  reclassification, never "the agency changed its numbers." `revised` sources
  rewrite history silently and must be snapshotted at publication.
- **`history_start`** bounds what trend claims are possible. A dataset that
  restarts at a records-system migration makes year-over-year comparisons across
  that boundary invalid.
- **`retention`** — some sources keep only weeks of history. If history
  evaporates, a publication must archive every run or lose it permanently.
- **`update_cadence`** tells you whether checking daily is informative or waste.

## Verification and knowledge

| Column | Values / format |
|---|---|
| `last_verified` | `YYYY-MM-DD` — the date someone actually fetched it |
| `kit_version` | tool version, or `manual`. **Never a person.** |
| `traps` | semicolon-separated mechanical gotchas |
| `insights` | interpretive observations and assumptions |
| `notes` | what it is good for |

**`traps` vs `insights` — the distinction matters:**

- **traps** break your *code*, or silently return the wrong rows. "The name
  field is space-padded, so equality filters return zero rows with HTTP 200."
  Audience: whoever writes the fetching adapter.
- **insights** change how you should *write about* the number. "About 46% of
  these records are officer-initiated, so the total measures police deployment
  and rises when patrols increase." Audience: whoever writes the story.

Both are the reason this registry is worth more than a bookmark list. A URL is a
search away; these cost an afternoon each.

## Class definitions

- **primary** — the record itself: an agency dataset, a filing, official minutes.
- **interestedPrimary** — authoritative for what *it* said or did, and an
  interested party on anything contested: neighborhood associations, advocacy
  groups, chambers of commerce.
- **secondary** — writes *about* records: news outlets, aggregators, commercial
  estimate sites.

## Status definitions

- **live** — fetched successfully and currently updating.
- **degraded** — reachable but impaired: stale data, partial coverage, a broken
  field. Explain in `traps`.
- **manual-only** — alive and useful but not machine-fetchable (403s to
  non-browser clients, session-gated, PDF-only). Not dead; needs a human or a
  browser.
- **dead** — no longer published. **Keep the row**; knowing something died, and
  when, saves the next person from rediscovering it.

## Schema versioning

Consumers should tolerate unknown trailing columns and treat missing optional
columns as blank, so that additive schema changes do not break older clients.
Column *order* is fixed; new columns are appended.
