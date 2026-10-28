# Running this branch (dadrean/team-integration)

If you already have the project running, here's what to do after pulling this branch. What changed on the page is in
`TEAM_FORMATION_CHANGES.md`; the full description of the page is section 4 of `docs/design/ui.md`.

## Setup steps

1. **Get the branch.** It lives on `github.com/ezueb/esa`, not the shared UTDallasEPICS repo.
   ```bash
   git remote add ezueb https://github.com/ezueb/esa.git   # once
   git fetch ezueb
   git checkout -b dadrean/team-integration ezueb/dadrean/team-integration
   ```

2. **Make sure Python's solver library is installed**
   ```bash
   pip install ortools
   ```

3. **Update your database.** This branch adds tables and fields for bid files and team versions
   (`add_bid_file`, `add_team_version`, `add_team_version_final`). It doesn't touch your existing data.
   ```bash
   npx prisma migrate deploy
   npx prisma generate
   ```
   Run **both**, in that order, every time you pull new migrations. `prisma/generated` is gitignored (CLAUDE.md
   says it's checked in, but it isn't), so the client has to be generated on your machine. If you skip `generate`,
   the page fails with errors about missing fields such as `isFinal`.

4. **Run it like normal**
   ```bash
   pnpm dev
   ```
   Open `http://localhost:3000`. The dev server listens on `localhost` only, so `127.0.0.1:3000` won't connect.
   Login codes print in the `pnpm dev` terminal.

If your Node 22 is installed through Homebrew, step 4 will pin the right version automatically. If not, make sure
`node -v` says `v22.x` before running it.

## Things to know

- **Re-export old team files.** Team exports made before Oct 27, 2026 could include students from other semesters
  on the same project (the Fall 2026 Wednesday file had 98 rows instead of 76). Export again from
  Manage Teams to get a correct file.
- **Exports now say if they're a draft.** Until the day's teams are a *final* version, Export asks first and names
  the file `… (draft).csv`. Every row has a `Locked` column.
- **Don't run `sqlite3 prisma/dev.db`.** The real database is `./dev.db` in the repo root (`DATABASE_URL=file:./dev.db`);
  opening `prisma/dev.db` just creates an empty file there.
- **Spring 2026 is real data.** Test on Fall 2026 instead.
- **Don't commit `data/`.** It holds student information.
