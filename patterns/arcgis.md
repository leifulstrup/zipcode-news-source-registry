# ArcGIS (FeatureServer / MapServer / Hub)

The other dominant US municipal platform, and the one most likely to be behind a
county GIS site. Read this, write your own adapter — `lib/arcgis.mjs` is the
executable form of this document, meant to be copied, not imported.

## Identifying it

- A URL containing `/rest/services/<path>/(FeatureServer|MapServer)/<layer>`.
- `hub-*.opendata.arcgis.com` or `<place>.opendata.arcgis.com` — an **ArcGIS
  Hub** portal, which is a catalog wrapping services, not a queryable dataset.
- Append `?f=json` to any layer URL to get its fields, types and capabilities.
  Append `/query?f=json&where=1=1&returnCountOnly=true` to confirm it answers.

**A `data.<county>.gov` domain does not imply Socrata.** At least one county
portal on exactly that pattern is an ArcGIS Hub. Check before assuming the query
language.

## Query shape

Everything goes through `/query` on a layer:

```
/query?f=json&where=1%3D1&returnCountOnly=true
/query?f=json&where=<predicate>&outFields=*&resultRecordCount=1000&resultOffset=0&returnGeometry=false
/query?f=json&where=1%3D1&outStatistics=[{"statisticType":"max","onStatisticField":"<DATE>","outStatisticFieldName":"newest"}]
/query?f=json&where=1%3D1&groupByFieldsForStatistics=<FIELD>&outStatistics=[{"statisticType":"count",...}]
```

**Count before you fetch.** Cheap, and it stops a silent truncation from looking
like a quiet week.

Always set `returnGeometry=false` unless you genuinely need shapes: geometry
inflates responses enormously, and you must not be publishing coordinates anyway.

### Quoting

`encodeURIComponent` leaves single quotes raw, and some servers reject them in a
where-clause. Encode quotes as `%27`:

```js
const enc = w => encodeURIComponent(w).replace(/'/g, '%27');
```

A numeric field filtered *with* quotes (`ZIPCODE='90706'`) can 400 while the
unquoted form works. If your first query errors, try both.

## Errors arrive inside a 200

ArcGIS reports failures in the body, with an HTTP 200:

```json
{"error":{"code":400,"message":"Invalid URL","details":["Invalid URL"]}}
```

**Status codes are not the truth here.** Any JSON fetch must raise on an `error`
key or you will treat a failure as an empty result — which becomes "nothing
happened this week" in print, a lie rather than a gap.

## The date-literal dialect problem

Different services accept different date literals, and **documentation cannot
tell you which**. All three of these are real:

```
<DATE_FIELD> > DATE '2025-07-15'
<DATE_FIELD> > TIMESTAMP '2025-07-15 00:00:00'
<DATE_FIELD> > 1752537600000          -- epoch milliseconds
```

Probe once by execution, record the winner in a dated comment, and keep the
probe so you find out if it changes. `probeDateDialect()` in `lib/arcgis.mjs`
tries all three and reports which the server accepted.

## Dates come back as epoch milliseconds

A date field's value is a number like `1787003220000`, not a string. A `max()`
that looks like a huge integer is a date. Convert on the way in
(`new Date(ms).toISOString().slice(0,10)`).

## Statistic field names may come back UPPERCASED

You ask for `outStatisticFieldName: "newest"` and the server returns
`{"NEWEST": 1787003220000}`. A case-sensitive read finds `undefined`, reports "no
date", and your freshness check silently fails **on a perfectly healthy
service**. Observed live. Read statistic results case-insensitively.

## Filtering to a geography

In rough order of preference:

1. A real ZIP field — verify the exact name from `?f=json`; `ZIP` / `ZIPCODE` /
   `zip_code` all exist in the wild.
2. A district / PSA / beat / reporting-area field — build a one-time crosswalk of
   which districts intersect your ZIP, then filter by that ID list. Record how
   and when you built it; boundaries get redrawn.
3. A city or place-name field — usable, but a ZIP can cross municipalities, and
   rows with a null city are silently dropped by an equality filter.
4. Coordinates — point-in-polygon against the ZIP's Census ZCTA boundary. Use
   them to *decide*, never to publish.

Police and school geographies almost never align with postal ZIPs. If your
filter is not the ZIP itself, that mismatch must be disclosed to readers.

## Freshness

Ask the data, never the catalog:

```
outStatistics=[{"statisticType":"max","onStatisticField":"<DATE_FIELD>","outStatisticFieldName":"newest"}]
```

…and first confirm the field's `type` is `esriFieldTypeDate`. A date stored as
`esriFieldTypeString` sorts lexicographically: on a real layer advertising a
catalog `modified` date of *yesterday*, a text `M/D/YYYY` field returned
`9/7/2019` as its maximum while the data actually stopped in 2023. When the field
is text, derive freshness from a numeric year field instead.

## Retention: check before you compare

Many incident layers keep a **rolling window** — often the last 30 days or 12
months — and simply do not hold last year. A naive year-over-year query then
returns only the handful of late-filed stragglers still inside the window. One
real case returned **16 against 1,493**, which prints as a five-figure percentage
increase.

Measure it: count rows older than ~400 days. If that number is tiny, the source
is rolling and **year-over-year is unavailable** — say so rather than computing
something meaningless. A layer literally named "Last 30 Days" is not a subtle
case, but plenty are.

## Known failure modes

- **Errors inside a 200** (above) — the most common way an ArcGIS adapter goes
  quietly wrong.
- **Random 403s** on long where-clauses. One retry with a short pause clears most
  of them. A 403 is usually "ask again", not "dead".
- **`resultRecordCount` caps** at a server-defined maximum (`maxRecordCount` in
  the layer metadata). Exceed it and you get a prefix with no error. Paginate
  with `resultOffset` and treat hitting your cap as `truncated`, never as a total.
- **Zero-padded codes.** Census tract, district and beat fields are frequently
  fixed-width zero-padded (`009803`). Equality on the unpadded value returns 0
  rows with HTTP 200 — the padding trap, same as Socrata's.
- **Hub v3's `filter[orgid]` is rejected** as an invalid parameter key. To find
  an organisation's content, read `orgId` from the portal page, then:
  `https://www.arcgis.com/sharing/rest/search?f=json&q=orgid:<id> AND <terms>`
- **MapServer vs FeatureServer** differ in capabilities; a MapServer layer may
  not support every statistic. Check `supportedQueryFormats` and
  `supportsStatistics` in the layer metadata.

## Cleaning its output

- Convert epoch-ms date fields to ISO immediately; never let a raw millisecond
  value reach prose.
- Trim every string field before comparing or grouping (padding).
- Coerce numerics explicitly — some counts arrive as strings.
- `attributes` is the payload; `geometry` should not be requested at all.
- De-duplicate on the layer's OBJECTID when paginating: rows inserted mid-scan
  cause overlapping pages.
- Treat empty string as null before it joins or groups as if it meant something.

## Probes worth keeping permanently

- **Row-count floor** from a real first run — a drop means the filter broke, not
  that the neighbourhood went quiet.
- **Freshness**, thresholded by the source's real cadence.
- **The date dialect still works** — re-assert the one you hard-coded.
- **The padding trap still exists.** If you worked around a padded field, assert
  the equality filter still returns 0. When upstream fixes it, your workaround
  becomes the bug, and this is the only thing that will tell you.
- **Semantic assumptions.** If you classify rows with a regex over a free-text
  field, assert it still matches something: a rename upstream collapses the split
  into one misleading total with every gate still green.
