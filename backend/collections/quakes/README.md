# Earthquakes

Every earthquake of magnitude **4.5 and up** of the last 30 days, worldwide,
as the US Geological Survey publishes it
([summary feed](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php)).
The rows are **fetched from the internet** when the collection is opened; no
key is needed and nothing is stored in the database.

- **The map** sizes each event by magnitude and colours it by class: the accent
  colour below 5, blue 5–5.9, amber 6–6.9, red 7 and up (the same rules tint the
  table rows). *World*, *Europe* and *Pacific* fly to a region; a click on a
  marker shows place, magnitude, depth, time and the PAGER alert.
- **Chips and search move the markers.** *Alert* keeps the events PAGER
  rated; *Mag* is a range (try 6 – 8); the search box matches the place.
- **Live, but cached.** The server keeps the feed for 60 seconds and serves
  every filter, sort and page from that copy; the page asks again every
  minute (the counter shows how old the copy is). If USGS cannot be reached,
  the last copy is served and marked *stale*.

The feed is GeoJSON: the position is `geometry.coordinates` as
`[longitude, latitude, depth]`, which `source.yaml` maps onto the `lng`,
`lat` and `depth` columns.
