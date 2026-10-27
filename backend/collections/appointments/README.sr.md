# Termini

Kalendar jedne ordinacije: osam lekara, pet soba, oko 600 termina od šest
nedelja pre do šest nedelja posle dana kada je baza napunjena. Izvor je baza
(Postgres jsonb); `seed.json` ne postoji — `npm run seed` pokreće
`backend/scripts/generate-appointments.ts` sa tim danom, pa se kalendar uvek
otvara na punoj nedelji. `SEED_TODAY=2026-10-27 npm run seed` fiksira dan
(tako radi Cypress).

- **Smene.** Svaki lekar radi četiri od pet radnih dana, u prvoj (08–14),
  drugoj (14–20) ili srednjoj (10–18) smeni, u slotovima od 30 minuta. Jedan
  lekar nikad nema dva termina u isto vreme. Subota i nedelja su prazne.
- **Boja po lekaru** (`color_field: doctor` + `color_map`). Čip *Doctor*
  ostavlja jednu boju na mreži.
- **Prozor.** Kalendar od servera traži samo dane koji su na ekranu: `between`
  filter na `start` od prvog do poslednjeg vidljivog trenutka, dodat pretrazi
  i čipovima. Prethodno / Sledeće / Danas i preseti (dan, radna nedelja,
  nedelja, mesec) pomeraju prozor i ponovo učitavaju.
- **Izmene.** Prevuci termin da ga pomeriš (i na drugi dan), povuci donju
  ivicu da promeniš trajanje; oba poravnavaju na 15 minuta i odmah se čuvaju
  sa verzijom reda. Klik na termin otvara detalje: soba, status i beleške se
  menjaju tu, a termin može i da se obriše. Klik na prazan slot dodaje termin
  (lekar je onaj izabran u čipu, inače prvi).

## Vremenske zone

Termini su sačuvani sa beogradskim pomakom (`2026-10-27T08:00:00+01:00`), ali
ništa na ekranu nije vezano za Beograd: svako vreme se crta u zoni izabranoj u
**zaglavlju aplikacije** (pored izbora jezika i teme), a ta zona je podrazumevano
zona pregledača.

Probaj: otvori radnu nedelju, nađi termin u 08:00 i prebaci zonu u zaglavlju na
**America/New_York** — isti termin je sada u **02:00** (u 03:00 u nedeljama
proleća i jeseni kada je jedna strana već pomerila sat, a druga nije).
**Asia/Tokyo** ga prikazuje u 16:00, **UTC** u 07:00 zimi. Granice dana se
pomeraju sa zonom, pa kalendar od servera traži drugi prozor (vidi `between`
vrednosti sledećeg `list` poziva), a tab tabele prikazuje pomerena vremena u
koloni `start`. Zona je podešavanje ovog pregledača (`localStorage`), nije deo
URL-a, i preživljava osvežavanje. Termin pomeren dok je izabran Njujork upisuje
se sa njujorškim pomakom; server čuva trenutak, pa ga Beograd vidi u pravom satu.
