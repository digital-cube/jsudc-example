# Recorded upstream responses

`UDC_HTTP_FIXTURES=<this directory>` makes every `http_api` collection read
`<collection>.json` here instead of calling upstream; `npm run e2e` starts the
backend with it, so Cypress never touches the internet.

- `quakes.json`: USGS `summary/4.5_month.geojson`, recorded 2026-10-28,
  trimmed to 100 of its 732 features (every orange and yellow alert, a share
  of the green ones, every M6+, the rest evenly spaced), newest first.
- `repos.json`: GitHub `users/digital-cube/repos?per_page=100&sort=updated`,
  recorded 2026-10-28 (45 repositories), each item cut to the keys the
  collection reads plus a few more. The account had no topics on any
  repository that day; topics were added to five items so the cards' topic
  chips have something to show.
