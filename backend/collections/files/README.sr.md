# Fajlovi

Redovi ove kolekcije su **fajlovi na disku**, a ne redovi baze: stavke jednog
foldera iz `backend/collections/files/sample/`, pročitane kad ga otvorite.
Ništa se ne čuva i ništa se ne može izmeniti.

- **Folderi prvi.** Kliknite folder (ili `..`) da ga otvorite. Otvoreni folder
  je uslov `path eq <folder>` u filteru adrese (`?f=`), pa link ka podfolderu
  otvara baš taj podfolder, a putanja iznad tabele je taj uslov.
- **Pretraga i čipovi rade unutar foldera.** *Ext = md* prikazuje markdown
  fajlove otvorenog foldera; polje za pretragu traži po imenu.
- **Veličine i datumi** dolaze iz fajl sistema: `size` u bajtovima, KB ili MB,
  `mtime` kao poslednja izmena.
- **Pregled.** Klik na tekstualni fajl ili sliku ga otvara (do 256 KB).

Kolekciju možete usmeriti na drugi folder sa `UDC_FILES_ROOT=/neka/putanja` u
okruženju backenda. Putanje van korena se odbijaju, simbolički linkovi se ne
prate.
