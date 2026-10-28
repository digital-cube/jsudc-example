# Flights

Every aircraft the [OpenSky Network](https://opensky-network.org) sees over
**Serbia and its neighbours** (41.5–46.5 °N, 18.5–23.5 °E), live from its
REST API (`/api/states/all`). No key is needed: the collection calls OpenSky
**anonymously** unless you give it an API client (see below). Nothing is
stored in the database.

- **The map** draws an aeroplane per aircraft, turned along its track and
  coloured by altitude: blue at cruise (10 000 m and up), green climbing or
  descending (6 000–10 000 m), amber on approach or departure, grey on the
  ground. Point at one and the **trail** it has flown appears behind it; a
  click opens callsign, address, country, altitude, speed and heading.
  *Balkans*, *Belgrade* and *Adriatic* fly to a region.
- **The table** shows the same altitudes as a **sparkline** per aircraft and
  the track as an arrow; **the cards** put the altitude large, with its
  sparkline under the details.
- **Chips and search move the markers.** *On ground* off keeps the aircraft in
  the air, *Baro alt* is a range (try 9 000 – 13 000), *Country* is where the
  aircraft is registered; the search box matches callsign, address and country.

## The history the upstream does not have

OpenSky answers one question: *where is every aircraft now*. It keeps no
history and has no endpoint for one. The trails and the sparklines come from
the **server**: `source.yaml`'s `history` block keeps, per aircraft (keyed by
its ICAO 24-bit address, the airframe, not the flight), the last 60 values of
`baro_alt`, `lat` and `lng` and serves them as `baro_alt_history`,
`lat_history` and `lng_history`. The server adds those fields to the schema
itself; `schema.json` does not list them. An aircraft that leaves the box for
10 calls in a row is forgotten.

So **the trails start empty and grow while the server runs**: one point per
call to OpenSky, which is every 4 minutes without an account. A restart
forgets them. Two server instances keep two different histories.

## A row that is an array

A state vector has no keys: it is a 17-element array, and `source.yaml` maps
every field by its index — `icao24: "[0]"`, `callsign: "[1]"`, … The trap is
the position: **`[5]` is longitude and `[6]` latitude**, lng before lat as in
GeoJSON; swapped, every aircraft lands in the Indian Ocean. The times
(`[3]`, `[4]`) are Unix **seconds** (`epoch_seconds`), the callsign comes
padded to 8 characters (the source trims it), altitudes are metres and speeds
metres per second.

## The budget, and how to raise it

Anonymous access is **400 credits a day** per IP address, and a box of at
most 25 square degrees costs **1 credit** a call — this one is 5° × 5°. The
page asks the server every 30 seconds, but the server keeps OpenSky's answer
for **4 minutes** (`cache_ttl_ms: 240000`): 360 calls a day, however many tabs
are open. The tooltip of the *updated … ago* pill says which credential is in
use and how long the cache is kept. The backend log has a line per call to
OpenSky.

With an OpenSky account the budget is 4 000 credits a day. Create an API
client on your account page on [opensky-network.org](https://opensky-network.org)
and give the backend its two values:

```sh
UDC_OPENSKY_CLIENT_ID=…
UDC_OPENSKY_CLIENT_SECRET=…
```

The source then asks OpenSky's token endpoint for a bearer token (OAuth2
client credentials), refreshes it before it expires, and keeps answers for
15 seconds (`cache_ttl_ms_authenticated`). Without either variable nothing
is refused: the collection stays anonymous. If the token endpoint fails, that
call goes out anonymously and the log says so once. If OpenSky cannot be
reached at all, the last answer is served marked *stale*.
