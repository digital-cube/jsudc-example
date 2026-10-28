# Metrics

Three servers — two web nodes (`web-1`, `web-2`) and a database (`db-1`) —
sampled every 15 minutes for the 30 days before the database was seeded:
about 8,600 rows. The source is the database (Postgres jsonb); there is no
`seed.json` — `npm run seed` runs `backend/scripts/generate-metrics.ts`, so
the series ends at the quarter hour the seed ran in (`SEED_TODAY=2026-10-27`
pins the end to noon of that day in Belgrade, as the Cypress run does). A
week later the short windows are empty: reseed with `npm run seed -- --reset`.

- **What is in it.** CPU and memory in percent, the load average, requests per
  second and errors per quarter hour. Traffic follows the Belgrade day (quiet
  at 04:00, busiest around 16:00), weekends are a little over half as busy,
  and the web nodes' memory creeps up until their 03:00 restart. Three
  incidents sit at fixed distances before the end: a CPU spike on `web-1`
  three hours before, an error burst on `web-2` the day before, a slow
  database five days before.
- **The chart.** CPU and memory are lines on the left axis (0–100 %), the load
  average a line on the right axis framed on its own values. Hover for the
  values, formatted as the table formats them; click a legend entry to hide
  or show that series. Without a host chip the lines are the mean of the
  three hosts at each quarter hour; the **host** chip draws one host (or the
  mean of those picked).
- **Window.** The presets above the chart (1h, 6h, 24h, 7d) and the custom
  from / to pair choose which rows are asked for: the window is a `between`
  filter on `ts`, added to the chips and the filter tree and sent to the
  server, so only the rows on screen travel. The choice is in the URL
  (`?win=24h`, or `?from=…&to=…` for a custom range) and survives a reload.
  When a window holds more quarter hours than the width can draw, the chart
  averages them into wider buckets.

## Time zones

The window is computed in the zone picked in the **application header**, and
the x axis is labelled in it:

- **1h, 6h, 24h** are the last hours *ending now*. They are the same instants
  in every zone, but the request writes them with the zone's offset, and the
  axis labels move: switch the header from **Europe/Belgrade** to
  **Asia/Tokyo** and the `between` of the next `list` call reads
  `…T20:00:00.000+09:00` where it read `…T12:00:00.000+01:00`, and the
  spike on `web-1` moves from 09:00 to 17:00 on the axis.
- **7d** is the last seven *calendar days*, today included, from midnight six
  days ago to the end of today **in that zone**. Here the zone changes the
  instants: Tokyo's week starts seven hours before Belgrade's (Belgrade is
  still on summer time on 21 October), and the request shows it
  (`2026-10-21T00:00:00.000+09:00` against `2026-10-21T00:00:00.000+02:00`).
- A **custom** range is entered as wall times; they are read in the header's
  zone, so the same `?from=2026-10-26T08:00` means 08:00 in whichever zone is
  picked.

The zone is a preference of this browser (`localStorage`), not part of the URL;
the table tab shows the same window, with `ts` in the same zone.
