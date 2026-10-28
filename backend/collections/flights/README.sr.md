# Letovi

Svaki avion koji [OpenSky Network](https://opensky-network.org) vidi iznad
**Srbije i suseda** (41,5–46,5 °N, 18,5–23,5 °E), uživo sa njegovog REST
API-ja (`/api/states/all`). Ključ nije potreban: kolekcija zove OpenSky
**anonimno**, osim ako joj ne date API klijenta (vidi dole). Ništa se ne
čuva u bazi.

- **Mapa** crta avion za svaki let, okrenut u pravcu kretanja i obojen po
  visini: plavo na krstarećoj visini (10 000 m i više), zeleno u penjanju ili
  spuštanju (6 000–10 000 m), narandžasto u prilazu ili odletu, sivo na zemlji.
  Pređite mišem preko aviona i iza njega se pojavi **trag** koji je preleteo;
  klik otvara pozivni znak, adresu, zemlju, visinu, brzinu i kurs. *Balkans*,
  *Belgrade* i *Adriatic* lete do regiona.
- **Tabela** prikazuje iste visine kao **sparkline** za svaki avion, a kurs kao
  strelicu; **kartice** ističu visinu krupno, sa njenim sparkline-om ispod
  detalja.
- **Čipovi i pretraga pomeraju markere.** Isključen *On ground* ostavlja
  avione u vazduhu, *Baro alt* je opseg (probajte 9 000 – 13 000), *Country* je
  zemlja registracije; pretraga traži po pozivnom znaku, adresi i zemlji.

## Istorija koju izvor nema

OpenSky odgovara na jedno pitanje: *gde je svaki avion sada*. Ne čuva
istoriju i nema endpoint za nju. Tragovi i sparkline-ovi dolaze sa
**servera**: blok `history` u `source.yaml` čuva, za svaki avion (po njegovoj
ICAO 24-bitnoj adresi — letelici, ne letu), poslednjih 60 vrednosti `baro_alt`,
`lat` i `lng` i servira ih kao `baro_alt_history`, `lat_history` i
`lng_history`. Server sam dodaje ta polja u šemu; `schema.json` ih ne
navodi. Avion koji napusti okvir na 10 poziva zaredom se zaboravlja.

Zato **tragovi kreću prazni i rastu dok server radi**: jedna tačka po pozivu
OpenSky-ja, a to je na svaka 4 minuta bez naloga. Restart ih briše. Dve
instance servera čuvaju dve različite istorije.

## Red koji je niz

State vector nema ključeve: to je niz od 17 elemenata, i `source.yaml`
mapira svako polje po indeksu — `icao24: "[0]"`, `callsign: "[1]"`, … Zamka
je pozicija: **`[5]` je geografska dužina, a `[6]` širina**, lng pre lat kao
u GeoJSON-u; zamenjene, svi avioni završe u Indijskom okeanu. Vremena
(`[3]`, `[4]`) su Unix **sekunde** (`epoch_seconds`), pozivni znak stiže
dopunjen razmacima do 8 znakova (izvor ga skraćuje), visine su u metrima, a
brzine u metrima u sekundi.

## Budžet, i kako ga povećati

Anonimni pristup je **400 kredita dnevno** po IP adresi, a okvir od najviše
25 kvadratnih stepeni košta **1 kredit** po pozivu — ovaj je 5° × 5°.
Stranica pita server na svakih 30 sekundi, ali server čuva OpenSky-jev odgovor
**4 minuta** (`cache_ttl_ms: 240000`): 360 poziva dnevno, bez obzira na broj
otvorenih tabova. Tooltip oznake *ažurirano pre …* kaže koji se pristup
koristi i koliko dugo se odgovor čuva. U logu backend-a je po jedan red za
svaki poziv OpenSky-ja.

Sa OpenSky nalogom budžet je 4 000 kredita dnevno. Napravite API klijenta na
stranici naloga na [opensky-network.org](https://opensky-network.org) i dajte
backend-u njegove dve vrednosti:

```sh
UDC_OPENSKY_CLIENT_ID=…
UDC_OPENSKY_CLIENT_SECRET=…
```

Izvor tada traži bearer token od OpenSky-jevog token endpointa (OAuth2
client credentials), obnavlja ga pre isteka i čuva odgovore 15 sekundi
(`cache_ttl_ms_authenticated`). Bez bilo koje od te dve promenljive ništa se
ne odbija: kolekcija ostaje anonimna. Ako token endpoint ne odgovori, taj
poziv ide anonimno i log to kaže jednom. Ako OpenSky uopšte nije dostupan,
servira se poslednji odgovor označen kao *zastareo*.
