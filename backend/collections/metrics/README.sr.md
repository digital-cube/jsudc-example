# Metrike

Tri servera — dva web čvora (`web-1`, `web-2`) i baza (`db-1`) — sa merenjem
na svakih 15 minuta tokom 30 dana pre nego što je baza napunjena: oko 8.600
redova. Izvor je baza (Postgres jsonb); `seed.json` ne postoji — `npm run
seed` pokreće `backend/scripts/generate-metrics.ts`, pa se serija završava u
četvrt sata u kojem je seed pokrenut (`SEED_TODAY=2026-10-27` kraj fiksira na
podne tog dana po beogradskom vremenu, kao što radi Cypress). Nedelju dana
kasnije kratki prozori su prazni: ponovo napunite sa `npm run seed -- --reset`.

- **Šta sadrži.** CPU i memoriju u procentima, prosečno opterećenje (load),
  zahteve u sekundi i greške po četvrt sata. Saobraćaj prati beogradski dan
  (mirno u 04:00, najveća gužva oko 16:00), vikendom je nešto više od pola
  posla, a memorija web čvorova raste do restarta u 03:00. Tri incidenta su
  na fiksnoj udaljenosti od kraja: skok CPU-a na `web-1` tri sata ranije,
  talas grešaka na `web-2` dan ranije i spora baza pet dana ranije.
- **Grafikon.** CPU i memorija su linije na levoj osi (0–100 %), load je
  linija na desnoj osi uokvirena prema sopstvenim vrednostima. Pređite mišem
  za vrednosti, formatirane kao u tabeli; klik na stavku legende sakriva ili
  prikazuje tu seriju. Bez čipa za host linije su prosek tri hosta u svakom
  četvrt satu; čip **host** crta jedan host (ili prosek izabranih).
- **Prozor.** Preseti iznad grafikona (1h, 6h, 24h, 7d) i par od / do biraju
  koji se redovi traže: prozor je `between` filter na `ts`, dodat čipovima i
  stablu filtera i poslat serveru, pa putuju samo redovi koji se vide. Izbor
  je u URL-u (`?win=24h`, ili `?from=…&to=…` za proizvoljan opseg) i preživi
  osvežavanje. Kada prozor ima više četvrt sati nego što širina može da
  nacrta, grafikon ih usrednjava u šire intervale.

## Vremenske zone

Prozor se računa u zoni izabranoj u **zaglavlju aplikacije**, i x osa je
označena u njoj:

- **1h, 6h, 24h** su poslednji sati *do sada*. To su isti trenuci u svakoj
  zoni, ali ih zahtev piše sa pomakom zone, a oznake na osi se pomeraju:
  prebacite zaglavlje sa **Europe/Belgrade** na **Asia/Tokyo** i `between`
  sledećeg `list` poziva glasi `…T20:00:00.000+09:00` umesto
  `…T12:00:00.000+01:00`, a skok na `web-1` se na osi seli sa 09:00 na 17:00.
- **7d** je poslednjih sedam *kalendarskih dana*, uključujući danas, od ponoći
  pre šest dana do kraja današnjeg dana **u toj zoni**. Ovde zona menja
  trenutke: nedelja u Tokiju počinje sedam sati pre beogradske (Beograd je
  21. oktobra još na letnjem vremenu), i zahtev to pokazuje
  (`2026-10-21T00:00:00.000+09:00` naspram `2026-10-21T00:00:00.000+02:00`).
- **Proizvoljan** opseg se unosi kao lokalno vreme; čita se u zoni iz
  zaglavlja, pa isti `?from=2026-10-26T08:00` znači 08:00 u kojoj god zoni je
  izabrana.

Zona je podešavanje ovog pregledača (`localStorage`), nije deo URL-a; tab sa
tabelom prikazuje isti prozor, sa `ts` u istoj zoni.
