# Schema (v1)

One CSV per state at `data/<STATE>.csv`. RFC4180 quoting, header row required,
LF endings, no BOM. Rows sorted by `(county_fips, place_fips, category, source_id)`.

```
source_id,scope_type,state,county_fips,place_fips,jurisdiction,category,name,url,api_type,geo_filter,source_class,status,last_verified,kit_version,traps,notes
```

| Column | Required | Values / format |
|---|---|---|
| `source_id` | yes | stable kebab slug, unique across all files, conventionally `<state>-<fips>-<short-name>` |
| `scope_type` | yes | `state` \| `county` \| `place` \| `region` |
| `state` | yes | 2-letter USPS code |
| `county_fips` | for county/place | 5-digit, zero-padded (e.g. `06037`) |
| `place_fips` | for place | 7-digit, zero-padded; blank otherwise |
| `jurisdiction` | yes | human-readable, e.g. `Los Angeles County, CA` |
| `category` | yes | `crime` \| `calls-for-service` \| `311` \| `permits` \| `zoning` \| `assessor` \| `deeds` \| `courts` \| `inspections` \| `schools` \| `transit` \| `parks` \| `elections` \| `parcels` \| `news` \| `civic` \| `other` |
| `name` | yes | what a publisher would call it |
| `url` | yes | endpoint or landing page |
| `api_type` | yes | `socrata` \| `arcgis` \| `ckan` \| `rss` \| `html` \| `pdf` \| `manual` |
| `geo_filter` | yes | field name, or `point-in-polygon` \| `district-crosswalk` \| `city-name` \| `none` |
| `source_class` | yes | `primary` \| `interestedPrimary` \| `secondary` |
| `status` | yes | `live` \| `degraded` \| `manual-only` \| `dead` |
| `last_verified` | yes | `YYYY-MM-DD`, the date someone actually fetched it |
| `kit_version` | yes | tool version, or `manual`. **Never a person.** |
| `traps` | no | semicolon-separated gotchas — the most valuable column |
| `notes` | no | what it is good for |

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
