# Meni — bočna traka, kao kolekcija

Bočna traka levo od ove strane nije zakucana u kodu. To je ova kolekcija,
nacrtana kao deo okvira aplikacije: frontend pročita sve redove kolekcije
`menu`, složi stablo u pregledaču i svaki čvor nacrta kao link. Kartica
**Stablo** prikazuje iste čvorove kao podatke; kartica **Tabela** kolone od
kojih se stablo pravi; kartica **Izvor** fajl iz kog sve to dolazi,
`menu/data/menu.yaml`.

Izmenite taj fajl, osvežite stranu i bočna traka je drugačija. Ništa se ne
kompajlira i ništa se ne seed-uje: backend ponovo čita YAML pri prvom
zahtevu nakon što se promeni vreme izmene fajla.

## Od ugnežđenog YAML-a do ravnih redova

Fajl je ugnežđena lista — čvor može imati `children`. Renderer stabla
očekuje ravne redove od kojih svaki zna svoje mesto, pa ih izvor
`yaml_menu` izravnava, prvo u dubinu, redom kojim je fajl napisan:

| Kolona | Šta sadrži |
|---|---|
| `code` | kako je napisan; jedinstven među braćom |
| `translation_key` | `<SEKCIJA>_<POJAM>`, prikazan kao `t(sekcija, pojam)` (`MENU_HOME` → *Početna*) |
| `icon` | `lucide:<ime>`, lucide ikonica (krug kada je ime nepoznato) |
| `url` | ruta koju otvara klik; čvor bez nje samo grupiše druge |
| `parent_id` | id roditelja; prazno na korenima |
| `order` | mesto među braćom, od 0 |
| `depth` | 0 na korenima |
| `ancestor_ids` | id-jevi od korena do roditelja |
| `children_count` | koliko dece ima, uključujući razrešenu |
| `is_dynamic` | true na redovima koje je dodala referenca (dole) |

Redovi su fiksni, pa kolekcija nema `schema.json` (meni koji ga ipak ima
mora da se slaže sa `MENU_SCHEMA`, inače se server ne pokreće).

## Id dolazi iz putanje

Id čvora je sha1 putanje kodova od korena — `COLLECTIONS/DATABASE`,
`VIEWS/TICKETS_KANBAN`. Ništa se ne čuva, pa id mora da se izvede, a
putanja je ono što ostaje isto dok čovek uređuje fajl: zamenite mesta dva
lista i oba zadržavaju id (menja se samo `order`), pa bočna traka pamti šta
ste otvorili. Promenite kod ili premestite čvor pod drugog roditelja i to
je nov čvor sa novim id-jem.

## Grana koju niko nije napisao

Tri čvora pod **Kolekcije** ne nabrajaju svoju decu. Oni je imenuju:

```yaml
- code: DATABASE
  translation_key: MENU_DATABASE
  children: "udc:collections?group=database"
```

Pri svakom čitanju izvor pita registar kolekcija samog servera za
kolekcije te grupe (`database`, `files` ili `internet`; bez `?group=` za
sve) i na mesto stringa ubacuje po jedan list za svaku: `code`
`COLLECTION_<IME>`, `translation_key` `COLLECTIONS_<IME>`, `url`
`/udc/<ime>`, ikonicu iz `collection_icons` u `source.yaml`. Ti redovi
imaju `is_dynamic: true` — štiklirana kolona na kartici Tabela, obojena
pravilom `row_color`. Dodajte direktorijum kolekcije, restartujte server i
ona je u meniju bez ijedne izmene ovde.

Referenca se razrešava unutar servera, ne preko HTTP-a: registar je tu.
Stariji oblik `api:<putanja>`, kojim je izvor zvao sopstveni HTTP endpoint,
odbija se pri pokretanju uz poruku koja to kaže.

## Kada je fajl pogrešan

Fajl koji ne postoji ili se ne parsira zaustavlja server pri pokretanju,
uz ime fajla. Fajl koji se pokvari dok server radi ne obara bočnu traku:
izvor nastavlja da služi poslednje dobro čitanje, označeno kao `stale`, a
kartica Izvor prikazuje grešku pored teksta.
