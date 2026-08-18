# zipcode-news-source-registry

A public, community-maintained table of **vetted local data sources** — open-data
portals, police and 311 feeds, assessor and permit records, courts, schools,
local outlets — keyed by jurisdiction, so that anyone building a hyperlocal
publication can start from what previous publishers already established instead
of rediscovering it.

Built for the [zipcode-news-starter-kit](https://github.com/leifulstrup/zipcode-news-starter-kit),
but the CSVs are plain data and useful to anyone. MIT licensed.

## The problem it solves

Working out what a county actually publishes is the most expensive step in
standing up a local publication: which portal is real, which dataset covers your
ZIP, which field is padded, how far behind the feed runs. It costs an agent
30–60 minutes of research per instance — and in a place like Los Angeles County
it is genuinely hard, with dozens of overlapping jurisdictions and a city portal
that is the *wrong* jurisdiction for most of the county's residents.

Almost all of that work is duplicated. LA County has ~250 ZIP codes; ten
publishers there would each independently rediscover the same Sheriff data, the
same assessor roll, and step on the same traps. This registry carries it
forward.

## Structure

One CSV per state, at `data/<STATE>.csv`. Rows are keyed on **jurisdiction**
(state / county FIPS / place FIPS), not ZIP code — because sources are
jurisdiction-scoped: a county Sheriff serves dozens of cities, and storing that
per-ZIP would repeat the same fact hundreds of times. Consumers resolve their
ZIP to FIPS codes once, then filter.

| Column | Meaning |
|---|---|
| `source_id` | Stable slug, e.g. `ca-06037-lasd-incidents` |
| `scope_type` | `state` / `county` / `place` / `region` |
| `state`, `county_fips`, `place_fips` | Jurisdiction keys (place blank for county-wide) |
| `jurisdiction` | Human-readable name |
| `category` | crime, calls-for-service, 311, permits, zoning, assessor, deeds, courts, inspections, schools, transit, parks, elections, parcels, news, civic, other |
| `name`, `url` | What it is and where |
| `platform` | The **product** behind it: socrata, arcgis-hub, accela, tyler-eagle, granicus, civicplus, seeclickfix, … |
| `api_type` | The **access shape**: socrata / arcgis / ckan / rss / html / pdf / manual |
| `geo_filter` | How to narrow it to a ZIP: a field name, or `point-in-polygon` / `district-crosswalk` / `city-name` / `none` |
| `source_class` | primary / interestedPrimary / secondary |
| `status` | live / degraded / manual-only / dead |
| `update_cadence` | realtime … annual / irregular |
| `lag_days` | Typical days between event and publication |
| `data_maturity` | preliminary / final / revised / mixed |
| `history_start` | Earliest available record |
| `retention` | How much history stays live (`full`, `4-weeks`, `current-only`, …) |
| `quality` | excellent / good / fair / poor / unusable |
| `last_verified` | ISO date the row was actually checked |
| `kit_version` | What verified it — **never a person** |
| `traps` | Mechanical gotchas that break code or silently return wrong rows |
| `insights` | Interpretive observations: what the data measures vs appears to measure |
| `notes` | What it is good for |

Full definitions in [SCHEMA.md](SCHEMA.md). Required: through `status`, plus
`last_verified` and `kit_version`. Everything else may be blank — **blank means
unknown, never a default**, because the next publisher will trust what is there.

**`platform` is the column that transfers.** A URL is local knowledge; a product
is general knowledge. An Accela permit portal behaves like an Accela permit
portal in any state, so `registry.mjs search accela` surfaces what publishers in
other counties learned about the same software you are about to meet.

**The lag and maturity columns are what keep numbers honest.** A feed seven days
behind returns zero for "this week" every week — printed, that is a fabricated
"none were issued" rather than a gap. Preliminary data gets reclassified for
weeks, so a re-query will not match what was printed. Recording these once saves
every later publisher from publishing a true-looking lie.

**`traps` and `insights` are the columns worth the most.** Traps break your code
(a space-padded name field makes equality filters return zero rows with HTTP
200). Insights change how you write (about 46% of one city's "calls for service"
are officer-initiated, so the total measures deployment, not demand). URLs are
findable by anyone; these cost an afternoon each.

## Using it

Consumers fetch the raw CSV for their state:

```
https://raw.githubusercontent.com/leifulstrup/zipcode-news-source-registry/main/data/CA.csv
```

With the starter kit:

```
node bin/registry.mjs lookup          # what is vetted for my jurisdiction
node bin/registry.mjs search lacity   # reverse lookup: who else uses this host
node bin/registry.mjs export          # emit my approved sources to contribute back
```

## Leads, not authority — the rule that keeps this safe

**An entry here is a lead, not a finding.** Importing one does not adopt it:

1. Live-test it yourself. Fetch it; confirm it really covers your ZIP; confirm
   it still updates. A registry row is a claim about the past.
2. A human approves it before it enters a publication's source list.
3. `last_verified` older than **180 days** should be treated as stale and
   re-verified. Sources rot: portals migrate, agencies reorganize, datasets
   freeze.

This is also the answer to the obvious concern about a public registry: a
poisoned row is worth no more than a poisoned search result, because both must
survive a live test and a human's approval before anything is published. Two
further boundaries:

- **Data only, never code.** A row records that a dataset exists and how to
  filter it. Consumers write their own adapters. Shipping code through a shared
  channel would be a supply-chain risk with no compensating benefit.
- **No contributor identity, ever.** No names, no emails, no coordinates, no
  instance URLs. `kit_version` records what verified a row, not who. Rows are
  public-record facts about public data sources and nothing else. Pull requests
  containing personal information will be rejected.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). In short: add or update rows in your
state's file, keep them sorted, include a real `last_verified` date for a check
you actually performed, and put what you learned the hard way into `traps` — it
is the part nobody else can look up.

Refreshing a stale row's date after re-verifying it is a one-line contribution
and one of the most useful.

## Why git rather than a database or a chain

Git already provides an append-only ledger with cryptographic integrity, full
provenance for any value (`git log -S` shows who changed what and when), and —
the part a trustless system specifically cannot offer — **human review before a
change lands**. The scarce resource here is not consensus among strangers; it is
judgment about whether a source is real and what its traps are. Pull requests
are the right primitive, and hosting costs nothing.

Size is a non-issue: at full national saturation (every county plus ~19,500
places) this is roughly 130,000 rows, about 35 MB split across 50 state files —
and a consumer only ever fetches its own state.
