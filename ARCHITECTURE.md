# How agents coordinate through this registry

This repository is the shared memory for a fleet of independent publishing
instances that never talk to each other directly. Each instance is a private
repo run by one publisher, assisted by an AI agent. They coordinate only here,
asynchronously, through reviewed pull requests.

```
   instance A (ZIP 90706)        instance B (ZIP 90744)        instance C (ZIP 20015)
   private repo + agent          private repo + agent          private repo + agent
          │                             │                             │
          │  1. lookup (read)           │                             │
          ├─────────────────────────────┼─────────────────────────────┤
          │                             │                             │
          ▼                             ▼                             ▼
   ┌──────────────────────────────────────────────────────────────────────┐
   │   zipcode-news-source-registry  (this repo, public)                  │
   │                                                                      │
   │   data/<STATE>.csv   what exists, where, how to filter, what it      │
   │                      measures, how stale, what breaks                │
   │   patterns/          per-PLATFORM reference recipes (read, adapt)    │
   └──────────────────────────────────────────────────────────────────────┘
          ▲                             ▲                             ▲
          │  2. export → pull request → human review → merge            │
          └─────────────────────────────┴─────────────────────────────┘
```

## What flows which way

**Down (registry → instance), cheaply and constantly.** An instance starting
`/find-sources` reads its state file first and gets, for its county: which
sources exist, which portal is the *wrong* jurisdiction despite ranking first in
search, how each dataset is filtered to a ZIP, how far behind it runs, whether
its figures are preliminary, and every trap someone already stepped on. This is
the expensive knowledge and it costs a single cached HTTP GET.

**Up (instance → registry), rarely and deliberately.** After a publisher
approves a newly-vetted source, `registry.mjs export` emits candidate rows. A
human reads them and opens a pull request. Nothing is automatic: no instance can
write here, and no agent may open a PR without its publisher's say-so.

## The three rules that make this safe

1. **Leads, not authority.** A row is exactly as trustworthy as a promising
   search result. Every consumer re-tests it live and every publisher approves it
   before it enters a publication. A poisoned row therefore buys an attacker
   nothing that a poisoned search result would not — and unlike a search result,
   it had to survive PR review first.
2. **No identity, ever.** No contributor names, emails, coordinates, or instance
   URLs. `kit_version` records *what* verified a row, never *who*. These are
   public-record facts about public data sources.
3. **Nothing here is auto-executed.** See below.

## Sharing code: patterns, not packages

The valuable thing about `platform` is that it generalizes. An Accela permit
portal behaves like an Accela permit portal in any state; Socrata takes SoQL
everywhere. So the ingestion knowledge — query shapes, pagination, date-literal
dialects, the count-then-fetch idiom, how to clean the fields these products
emit — is worth writing down **once per platform** rather than once per
jurisdiction.

`patterns/<platform>.md` holds that: a reference recipe with worked query
examples, the known failure modes of that product, and the cleaning steps its
output usually needs.

**The boundary that keeps this from becoming a supply chain:** patterns are
**read and adapted by an agent, then reviewed by a publisher** — they are never
fetched and executed. The registry ships no runnable package, no install step,
no import URL. A publisher's adapter lives in their own repo, written by their
own agent, reviewed by them.

That distinction is deliberate. Reading an open-source example and writing your
own code from it is ordinary engineering with a human in the loop. Fetching code
from a shared server and running it is a dependency you did not audit, in a
pipeline that publishes under your name. The first compounds knowledge safely;
the second compounds risk.

## Why an instance benefits from contributing

Nothing enforces contribution, so it has to be worth doing:

- **Corrections come back.** A source you registered gets its traps and staleness
  updated by whoever hits it next — you inherit their findings on your own
  sources.
- **Re-verification is shared.** `last_verified` decays for everyone. When another
  publisher in your county refreshes a row, your instance sees a fresh date
  instead of a stale one.
- **Your own next instance starts ahead.** Publishers who add a second ZIP, or
  who move, begin from their own prior work.
- **The platform patterns compound.** Every trap recorded against `accela` helps
  the next publisher meeting Accela anywhere in the country.

## What this is deliberately not

- **Not a data pipeline.** No data flows through here — only descriptions of
  where data lives and what it means. Instances fetch sources directly.
- **Not a registry of publications.** It does not know who publishes what, or
  where. There is no directory of instances, by design.
- **Not authoritative.** It records what someone verified on a date. Agencies
  reorganize; the registry is always somewhat behind, and says so with
  `last_verified`.

## Extending it

The schema is additive: new columns are appended, consumers tolerate unknown
trailing columns, and missing optional columns read as blank. That lets the
attribute set grow — richer quality signals, licence terms, rate limits,
authentication requirements — without breaking older clients.

The natural next additions, in rough priority order: rate limits and
authentication requirements per source; licence and attribution terms;
per-platform pattern docs for the products that show up most (Accela, Tyler,
Granicus, SeeClickFix); and county-level coverage notes about which
jurisdictions a contracted service actually serves.
