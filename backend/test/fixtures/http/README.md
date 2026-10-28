# Recorded upstream responses

`UDC_HTTP_FIXTURES=<this directory>` makes every `http_api` collection read
`<collection>.json` here instead of calling upstream — or, when
`<collection>.1.json` exists, `.1`, `.2`, … one per upstream call, the last
one repeating; `npm run e2e` starts the backend with it, so Cypress never
touches the internet.

- `quakes.json`: USGS `summary/4.5_month.geojson`, recorded 2026-10-28,
  trimmed to 100 of its 732 features (every orange and yellow alert, a share
  of the green ones, every M6+, the rest evenly spaced), newest first.
- `repos.json`: GitHub `users/digital-cube/repos?per_page=100&sort=updated`,
  recorded 2026-10-28 (45 repositories), each item cut to the keys the
  collection reads plus a few more. The account had no topics on any
  repository that day; topics were added to five items so the cards' topic
  chips have something to show. Only three repositories had stars (6, 1, 1);
  `stargazers_count` was set on thirteen more (1–14) so the chart tab's pie
  has more than its ten slices and folds the rest into "Other".
- `flights.1.json`, `flights.2.json`: OpenSky `/api/states/all` over the box
  41.5–46.5 °N, 18.5–23.5 °E, recorded anonymously on 2026-10-28 at 07:22 and
  07:27 UTC (66 and 70 aircraft, 52 in both), untrimmed — the morning box held
  fewer than the 150 the ticket allowed for. One state vector per line. The
  second call is what gives the e2e run a trail of two points.
