# Poruke

Poruke primera poštanskog sandučeta (jsudc 0.4.0): tri demo korisnika — Ana,
Marko i Jelena — sa po tristotinak poruka u sopstvenim folderima. Prijave
nema: birač korisnika gore desno šalje korisnika u zaglavlju `x-demo-user`,
a serverov `context` ga čita.

- **Redovi po korisniku.** `rowScope` dispečera drži svaki zahtev na ovoj
  kolekciji na `owner = <korisnik koji pita>`. Opseg je serverov: klijent
  ne može da ga pošalje, vidi ni ukine. `owner` je sakriven iz `describe` i
  iz redova; tuđa poruka je `not_found` — za čitanje, izmenu i brisanje.
- **Bez korisnika nema sandučeta.** Zahtev bez poznatog korisnika se odbija
  sa `forbidden`, `details.reason: "unauthenticated"`.
- **Relaciona tabela** (`postgres_table`): tipizirane kolone i UUID ključevi.
  `folder_name` dolazi iz spoja sa `mail_folders` i samo se čita.
- **Bez brojanja** (`total_count: false`): stranica bez `count(*)`.
- **`onMutate`** upisuje red u `mail_audit` u istoj transakciji; odbijena
  izmena ne upisuje ništa.
- **Sopstvena ćelija** `unread_dot` crta tačku za nepročitanu poruku.
