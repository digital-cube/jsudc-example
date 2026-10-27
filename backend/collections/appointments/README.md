# Appointments

A clinic's calendar: eight doctors, five rooms, about 600 appointments from
six weeks before to six weeks after the day the database was seeded. The
source is the database (Postgres jsonb); there is no `seed.json` — `npm run
seed` runs `backend/scripts/generate-appointments.ts` with that day, so the
calendar always opens on a busy week. `SEED_TODAY=2026-10-27 npm run seed`
pins the day (the Cypress run does).

- **Shifts.** Each doctor works four weekdays in five, on an early (08–14),
  late (14–20) or middle (10–18) shift, in 30-minute slots. One doctor never
  has two appointments at once. Saturdays and Sundays are empty.
- **Colour per doctor** (`color_field: doctor` + `color_map`). The *Doctor*
  chip leaves one colour on the grid.
- **Window.** The calendar asks the server only for the days on screen: a
  `between` filter on `start` from the first to the last visible instant,
  added to the search and chips. Prev / Next / Today and the presets (day,
  work week, week, month) move the window and refetch.
- **Writes.** Drag an appointment to move it (to another day too), drag its
  bottom edge to change its length; both snap to 15 minutes and are saved at
  once with the row's version. Click one for the details: room, status and
  notes are editable there, and it can be deleted. Click an empty slot to add
  one (the doctor is the one picked in the chip, else the first).

## Time zones

The appointments are stored with Belgrade's offset (`2026-10-27T08:00:00+01:00`),
but nothing on screen is tied to Belgrade: every time is drawn in the zone
picked in the **application header** (next to the language and theme
switches), and that zone defaults to the browser's.

Try it: open the work week, find an 08:00 appointment, and switch the header
zone to **America/New_York** — the same appointment now sits at **02:00**
(03:00 in the weeks of spring and autumn when one side has changed the clock
and the other has not). **Asia/Tokyo** shows it at 16:00, **UTC** at 07:00 in
winter. The day boundaries move with the zone as well, so the calendar asks
the server for a different window (watch the `between` values of the next
`list` call), and the table tab shows the shifted times in its `start`
column. The zone is a preference of this browser (`localStorage`), not part
of the URL, and survives a reload. Moving an appointment while New York is
picked writes New York's offset; the server stores the instant, so Belgrade
sees it at the right hour.
