# Folderi pošte

Folderi primera poštanskog sandučeta, po demo korisniku: Inbox, Sent,
Drafts, Archive, Trash i jedan sopstveni. `postgres_table` nad tabelom
`mail_folders`, ograničen na korisnika koji pita (vlasnik je sakriven).
`unread_count` i `message_count` su izračunata polja (podupiti nad
`mail_messages`) koja se samo čitaju.
