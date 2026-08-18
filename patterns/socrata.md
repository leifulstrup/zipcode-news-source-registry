# Socrata (Tyler Data & Insights)

The most common US municipal open-data platform. Read this, write your own
adapter — nothing here is meant to be imported or executed.

## Identifying it

Hosts like `data.<place>.gov`, `data.<place>.org`; dataset pages showing a
four-four identifier (`abcd-1234`); an `/resource/<id>.json` endpoint. The
catalog API is `/api/views/<id>.json`.

## Query shape

Query with SoQL parameters against `https://<host>/resource/<id>.json`:

```
?$select=count(*) as n&$where=<predicate>
?$select=max(<date_field>) as newest
?$where=<predicate>&$limit=50000&$offset=0
?$select=<group_field>,count(*) as n&$group=<group_field>&$order=n DESC
```

**Count before you fetch.** A count query is cheap, tells you whether your
predicate is plausible, and prevents a silent truncation from looking like a
quiet week.

Dates are ISO without a timezone suffix: `field > '2026-08-01T00:00:00.000'`.

Default `$limit` is small (often 1000) — always set it explicitly and paginate
with `$offset`, or you will silently receive a prefix of the data.

## Filtering to a geography

In rough order of preference:

1. A real ZIP column (`zip_code`, `zip`) — verify the column NAME by fetching one
   row; `zip` vs `zipcode` is a common mismatch and the error message usefully
   reveals the schema.
2. A city/municipality column — usable, but see the padding trap below.
3. A district/beat/reporting-area column — build a one-time crosswalk of which
   districts intersect your ZIP, then filter by the ID list.
4. Coordinates — point-in-polygon against the ZIP's Census ZCTA boundary.
5. Address text only — the dangerous case: text-matching under-returns silently.
   Prefer geocoding or a boundary test.

## Freshness

**Never trust the catalog's `updatedAt`.** It reflects file touches, not new
data; datasets have carried a current `updatedAt` while the newest actual record
was years old. Ask the data:

```
?$select=max(<date_field>) as newest
```

Compare that to today to derive the real lag, and record it.

## Known failure modes

- **Padded string columns.** Name fields are frequently space-padded to a fixed
  width and codes zero-padded (`'05'` for 5). `WHERE name='Harbor'` then returns
  **0 rows with HTTP 200** — indistinguishable from a quiet week. Prefer
  `like '%Harbor%'` or a numeric ID, and cross-check any filter against an
  unfiltered `$group` once.
- **A 200 with an empty body**, on some hosts, unless a full browser User-Agent
  is sent.
- **Federated catalog results.** A state portal's catalog API can return another
  city's datasets; check the publisher of each dataset, not just the portal.
- **Frozen predecessors.** After a records-system migration the old dataset often
  stays online, still listed, no longer updated. Check `max(date)` on both.
- **Rate limiting** without an app token; register one for repeated use.

## Cleaning its output

- Trim every string field before comparing or grouping — see padding.
- Coerce numerics: counts and coordinates arrive as strings.
- Treat empty string as null; Socrata omits null fields entirely from JSON rows,
  so a missing key is not an error.
- Dates are usually local-agency time without an offset; state your timezone
  assumption rather than inferring one.
- De-duplicate on the dataset's own record ID when paginating — overlapping
  pages happen if rows are inserted mid-scan.

## Probes worth keeping permanently

- A **row-count floor** taken from a real first run: a sudden drop means the
  filter or field name broke, not that the neighborhood went quiet.
- A **freshness assertion**: newest record within N days, N chosen from the
  source's real cadence.
- **The trap itself**: if you worked around a padded field, assert the padding
  still exists. When upstream fixes it, your workaround becomes the bug — and
  this is the only thing that will tell you.
- **Semantic assumptions**: if your adapter classifies rows with a regex over a
  free-text column, assert the classification still matches something. An
  upstream rename otherwise collapses a split into one misleading total, silently.
