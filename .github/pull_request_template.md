## What this changes

<!-- e.g. "Adds 3 sources for Greene County, MO" / "Marks ca-06037-x dead" /
     "Refreshes last_verified on 4 rows after re-checking them" -->

## Evidence — what did you actually run?

A row is a claim that **you fetched this on `last_verified`**. "It appeared in a
search result" is not a check. For each source, briefly:

- [ ] I fetched it and it returned data for the jurisdiction claimed
- [ ] I derived freshness from the **data** (`max(date_field)`), not the portal's
      `updatedAt` metadata
- [ ] I confirmed the jurisdiction is the right state/county/place — and can say
      how (footer, publisher metadata, rows containing verifiable local streets)

```
<!-- paste the queries you ran and abbreviated output, or the `bin/diagnose.mjs` report -->
```

## Traps and insights

<!-- The most valuable columns. What would the next publisher have lost an
     afternoon to? A padded field, a lying timestamp, a rolling retention window,
     records that measure something other than what the name suggests. -->

## Checks

- [ ] `node bin/validate.mjs` passes locally
- [ ] No contributor or resident identity anywhere in the rows (no names, emails,
      addresses, coordinates, parcel numbers) — see CONTRIBUTING.md
- [ ] Rows sorted by `(county_fips, place_fips, category, source_id)`
- [ ] Blank means unknown; I did not guess a value to fill a column

<!-- Reviewers cannot re-verify every source — which is exactly why consumers are
     told to treat every row as a lead requiring their own live test. Your
     evidence above is what makes review possible. -->
