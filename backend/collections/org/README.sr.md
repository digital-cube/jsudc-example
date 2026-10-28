# Organizacija

Izmišljena softverska firma: firma, 6 sektora, 2–4 tima u svakom, 4–8 ljudi
u svakom timu — 134 reda. Izvor je baza (Postgres jsonb), napunjena iz
`seed.json`, koji deterministički piše `backend/scripts/generate-trees.ts`
sa popunjenim svim poljima strukture: `parent_id`, `order`, `depth`,
`ancestor_ids` (od korena) i `children_count`.

- **Nivo po nivo** (`tree_options.lazy: true`). Stablo od servera traži
  korene (`parent_id is_null`), a decu čvora tek kad se on otvori
  (`parent_id eq <id>`, sortirano po `sibling_sort`). Strelica za otvaranje
  stoji gde je `children_count` veći od nule, a dok se grana učitava vrti se
  indikator. Otvara se sa firmom raširenom jedan nivo
  (`expand.default_depth: 1`); šta otvorite pamti se u ovom pregledaču
  (`udc:tree:org`).
- **Filteri i pretraga idu na server.** Sa čipom, filterom ili pretragom
  stablo prikazuje redove koji odgovaraju; red čiji roditelj nije pogođen
  crta se kao koren sa prigušenom oznakom, a nazivi označavaju traženi
  tekst. *Vrsta = osoba* plus pretraga nalazi ljude po imenu ili zvanju.
- **Preimenovanje** (`interactive.rename`): dvoklik na naziv, ili
  *Preimenuj* u meniju `⋮`; Enter čuva (`mutate update` sa verzijom reda).
- **Premeštanje** (`interactive.reparent`): prevucite čvor na drugi (postaje
  njegovo poslednje dete) ili u razmak između dva brata. Čvor se ne može
  spustiti u sebe ni u svoje podstablo — pregledač odbija takvo mesto, a
  odbija ga i server. Premeštanje je jedan poziv `tree.reparent`: server
  upisuje `parent_id` i `order`, ponovo računa `depth` i `ancestor_ids` za
  celo premešteno podstablo i prebrojava `children_count` oba roditelja, u
  jednoj transakciji. Spuštanje između dva reda bez slobodnog celog broja
  prenumeriše braću (`reindex`) i pokušava ponovo.
- Tab **tabela** prikazuje iste redove ravno, obojene po vrsti.
