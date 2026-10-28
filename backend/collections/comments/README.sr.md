# Komentari

Jedna diskusija — *rad od kuće ili iz kancelarije?* — od 80 komentara:
8 komentara na vrhu i odgovori na njih, do šest nivoa dubine. Deset
izmišljenih autora sa srpskim imenima; tekst je sintetički. Izvor je baza
(Postgres jsonb), napunjena iz `seed.json`, koji deterministički piše
`backend/scripts/generate-trees.ts`.

- **Jedna strana, stablo se gradi u pregledaču** (`tree_options.lazy: false`).
  Tab stabla čita celu (filtriranu) kolekciju — `page_size_default: 200`,
  jedna strana drži celu diskusiju — i gradi je iz `parent_id`. Odgovori
  stoje ispod komentara od najstarijeg (`sibling_sort: created_at asc`).
- **Otvara se potpuno raširen** (`expand.default_depth: 99`). Šta otvorite ili
  zatvorite pamti se u ovom pregledaču (`localStorage`, `udc:tree:comments`).
- **Pretraga označava** (`on_search.mode: highlight_and_expand`). Ukucajte
  *Beograd*: cela diskusija ostaje učitana, pogođeni tekst je označen, svaki
  komentar na putu do pogotka se otvara, a ostale grane se zatvaraju
  (`collapse_others`). Brisanje pretrage vraća ono što je bilo otvoreno.
- **Čipovi filtriraju na serveru.** *Autor* ili *Ocena* sužavaju redove;
  odgovor čiji je roditelj izbačen filterom crta se kao koren sa
  prigušenom oznakom, tako da filter nikad ne sakrije celu granu.
- **Odgovor** (`interactive.reply`). Meni `⋮` komentara ima *Odgovori*:
  pišite u polje ispod i pritisnite Enter. Odgovor se upisuje sa
  `parent_id`, `depth` (roditelj + 1), sledećim retkim `order` i
  `created_at` sada, kao „Vi”.
- **Tastatura.** Gore / dole pomeraju, desno otvara, levo zatvara, Enter
  prikazuje komentar sa svim poljima.
- Tab **tabela** prikazuje iste redove ravno, obojene po oceni.
