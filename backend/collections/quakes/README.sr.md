# Zemljotresi

Svi zemljotresi jačine **4,5 i više** u poslednjih 30 dana, širom sveta, onako
kako ih objavljuje Geološki zavod SAD
([summary feed](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php)).
Redovi se **preuzimaju sa interneta** kad otvorite kolekciju; ključ nije
potreban i ništa se ne čuva u bazi.

- **Mapa** crta svaki događaj po jačini i boji ga po klasi: bojom akcenta ispod 5,
  plavo 5–5,9, narandžasto 6–6,9, crveno 7 i više (ista pravila boje i
  redove tabele). *World*, *Europe* i *Pacific* prelaze na region; klik na
  marker prikazuje mesto, jačinu, dubinu, vreme i PAGER uzbunu.
- **Čipovi i pretraga pomeraju markere.** *Alert* zadržava događaje koje je
  PAGER ocenio; *Mag* je opseg (probajte 6 – 8); pretraga traži po mestu.
- **Uživo, ali keširano.** Server čuva feed 60 sekundi i sve filtere,
  sortiranja i stranice služi iz te kopije; stranica ponovo pita svakog minuta
  (brojač pokazuje koliko je kopija stara). Ako USGS nije dostupan, služi se
  poslednja kopija, označena kao *zastarela*.

Feed je GeoJSON: položaj je `geometry.coordinates` u obliku
`[dužina, širina, dubina]`, što `source.yaml` preslikava u kolone `lng`,
`lat` i `depth`.
