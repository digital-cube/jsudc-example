# Trag izmena pošte

Ono što `onMutate` kolekcije `mail_messages` upisuje: jedan red po izmeni
poruke, u istoj transakciji, pa se potvrđuje i poništava zajedno sa njom.
Samo za čitanje, ograničeno na korisnika koji pita.
