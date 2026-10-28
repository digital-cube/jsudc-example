# Repozitorijumi

Javni repozitorijumi [digital-cube na GitHub-u](https://github.com/digital-cube),
**preuzeti preko GitHub API-ja** (`/users/digital-cube/repos`), poslednje
ažurirani prvi. Samo za čitanje; ništa se ne čuva u bazi.

- **Kartice** prikazuju avatar vlasnika, jezik, teme, zvezdice, forkove i
  poslednji push. Tabela ima sve kolone.
- **Language** je čip, **Archived** da/ne čip; pretraga traži po imenu i
  opisu.
- **Ograničenje poziva.** Bez tokena GitHub dozvoljava 60 poziva na sat sa
  jedne adrese. Server čuva odgovor pet minuta, a stranica osvežava istim
  tempom, pa ova kolekcija troši najviše 12 poziva na sat. Sa
  `UDC_GITHUB_TOKEN` u okruženju backenda pozivi ga nose (5.000 na sat); bez
  njega se zaglavlje `Authorization` izostavlja.
- Ako GitHub odbije (ograničenje, ispad), služi se poslednji odgovor, označen
  kao *zastareo*.
