# The toolkit

Tested, reusable code for the part of this work that is the same everywhere:
querying a Socrata or ArcGIS endpoint, cleaning what it returns, and finding out
whether a candidate source is any good before you spend an afternoon on it.

The CSV records *what* exists and what it means. `patterns/` explains *how* each
product behaves. This is the executable form of the same knowledge.

```
lib/http.mjs       timeout, retry, browser UA, errors-inside-a-200
lib/socrata.mjs    count · maxDate · rows · groupCounts · paginate · schema
lib/arcgis.mjs     the same, plus the date-dialect prober and Hub org search
lib/clean.mjs      trimAll · toNumber · toDateISO · dedupeBy · detectPadding · looksLikeStringDate
lib/checks.mjs     the assertions a probe should make (including semantic ones)
lib/csv.mjs        the registry schema, in executable form
bin/diagnose.mjs   point it at a URL; get a diagnosis and a draft registry row
test/              58 unit tests, zero dependencies, no network
```

## Copy it — don't import it

**There is no package to install and no URL to import.** Nothing here is
published to npm, and nothing in this repo should ever be fetched and executed
inside a publishing pipeline.

Take what you need: read the module, copy the functions into your own repo,
review them, own them. Your adapter lives in your repository, under your review,
and changes only when you change it.

That is the whole safety model, and the distinction is not pedantic. Reading an
open-source example and writing your own code from it is ordinary engineering
with a human in the loop. Fetching code from a shared server and running it on a
schedule is an unaudited dependency inside a system that publishes under your
name — a repository anyone can open a pull request against becomes a path into
every downstream publication. The first compounds knowledge; the second
compounds risk.

So: `lib/` is a reference implementation. `bin/diagnose.mjs` is a tool you run by
hand while evaluating a source. Neither is a runtime dependency of anything.

## `diagnose` — what a candidate source actually is

```
node bin/diagnose.mjs <url> [--zip 90706] [--json]
```

Point it at a Socrata dataset URL, an ArcGIS FeatureServer/MapServer layer, or a
portal page. It answers, in about a minute, the questions that otherwise cost an
afternoon:

| It checks | Because |
|---|---|
| **Platform**, and how it decided | The product predicts the query shape and the traps |
| **Liveness** — status, timing, size | A 200 with an empty body is a bot filter, not "no data"; a 403 after retry is `manual-only`, not `dead` |
| **Fields and their TYPES** | A date stored as *text* sorts lexicographically: `9/7/2019` reads as the newest row in a dataset that stops in 2023 |
| **PII-shaped fields** | Owner, address, lat/lon, parcel — never fetch them. Omission beats scrubbing |
| **Freshness, from the DATA** | Portal metadata reflects file touches. One live run found a catalog claiming *yesterday* on a dataset frozen 508 days earlier |
| **Retention** | A rolling window does not hold last year, so a year-over-year query returns only late-filed stragglers — one real case printed 16 against 1,493 as a five-figure increase |
| **Padded string fields** | `WHERE name='Harbor'` returns 0 rows with HTTP 200, indistinguishable from a quiet week |
| **Geography** | Is there a ZIP field, or will you need a district crosswalk or point-in-polygon? |

It finishes by printing a **draft registry row** with everything it could
establish filled in, and lists the columns a human still has to supply. It never
invents a value: blank means unknown.

`--json` emits the whole diagnosis for scripting. Exit code is 0 whenever a
diagnosis was produced — *including* a damning one, because the diagnosis is the
output. Only a usage error exits 2.

### It produces a lead, not a finding

A draft row is a starting point for a human, not a submission. `diagnose` cannot
know which government publishes a dataset, what category it belongs to, whether
it is `primary` or `secondary`, or whether it is the right jurisdiction for your
ZIP — the failure that wastes the most time. **Verify every field before opening
a pull request**, and re-read the "leads, not authority" rule in the README: it
applies to rows this tool drafted exactly as much as to rows a person typed.

## Running the tests

```
npm test          # or: node --test
```

58 tests, no dependencies, no network. They cover the pure logic where the real
bugs live — date coercion across epoch/ISO/`M/D/YYYY`, padding detection,
dedupe, every check's pass and fail path, and the exact query strings each
platform module builds.

Live behaviour is proven by running `diagnose` against a real endpoint, not by
CI. A test that depends on a municipal portal fails for reasons that have
nothing to do with the code, and a flaky check trains people to ignore it.

## Contributing here

Same rules as the CSV, plus one: **a function that is not tested does not go
in.** These are read and copied by people building publications; a subtle bug
here propagates into other people's numbers. If you add a platform module, add
its unit tests and a matching `patterns/<platform>.md`.
