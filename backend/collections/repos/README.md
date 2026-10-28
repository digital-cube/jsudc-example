# Repositories

The public repositories of [digital-cube on GitHub](https://github.com/digital-cube),
**fetched from the GitHub API** (`/users/digital-cube/repos`), most recently
updated first. Read-only; nothing is stored in the database.

- **Cards** show the owner's avatar, the language, the topics, stars, forks
  and the last push. The table has every column.
- **Language** is a chip, **Archived** a yes/no chip; the search box matches
  the name and the description.
- **Rate limit.** Without a token GitHub allows 60 calls an hour from one
  address. The server keeps the answer for five minutes and the page polls
  at the same pace, so this collection costs at most 12 calls an hour. With
  `UDC_GITHUB_TOKEN` set in the backend's environment the calls carry it
  (5,000 an hour); without it the `Authorization` header is left out.
- If GitHub refuses (the limit, an outage), the last answer is served and
  marked *stale*.
