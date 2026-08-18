# Platform patterns

One document per **platform** (the product behind a source: Socrata, ArcGIS,
Accela, Tyler, …). Each records how to query that product, what its output
usually needs before it can be trusted, and how it fails.

These exist because platform knowledge **transfers across jurisdictions** in a
way that URLs do not. A Socrata endpoint takes SoQL whether it is in Los Angeles
or Missouri; an ArcGIS FeatureServer needs its date-literal dialect discovered by
execution in either place. Writing that down once per product beats rediscovering
it once per county.

## Read and adapt — never fetch and execute

**These are reference recipes, not a library.** An agent reads the pattern for
its source's platform and writes an adapter in its own repo, which its publisher
reviews. Nothing here is installed or imported as a dependency.

That boundary is the whole safety model. Reading an example and writing your own
code from it is ordinary engineering with a human in the loop. Executing code
fetched from a shared server, inside a pipeline that publishes under your name,
is an unaudited dependency. The first compounds knowledge; the second compounds
risk.

Each pattern has an executable counterpart in [`lib/`](../TOOLKIT.md) —
`patterns/socrata.md` alongside `lib/socrata.mjs`, `patterns/arcgis.md`
alongside `lib/arcgis.mjs`. Same rule applies: copy what you need into your own
repo. The document explains *why*; the module shows *how*; neither is a runtime
dependency of your publication.

## What a pattern document should contain

1. **Identifying the platform** — how to tell you are looking at this product.
2. **The query shape** — a minimal working example, with the count-first idiom.
3. **Filtering to a geography** — the field names this product typically exposes,
   and what to do when there is none.
4. **Freshness** — how to ask the data (never the metadata) how current it is.
5. **Known failure modes** — the 200s that mean failure, the silent truncations,
   the padded fields.
6. **Cleaning** — what the raw output reliably needs: type coercion, padding,
   null sentinels, duplicate handling, timezone assumptions.
7. **Probes** — assertions worth making permanently, including semantic ones.

## Contributing a pattern

Same rules as the CSV: verify what you write, no personal information, and be
explicit about what you have *not* tested. A pattern that overstates its
coverage is worse than none, because the next agent will trust it.

If you add a platform module to `lib/` alongside a new pattern, add its unit
tests too — see TOOLKIT.md. Untested code here propagates into other people's
numbers.
