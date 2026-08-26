# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

ESA is a Nuxt 4 app for running the EPICS program: tracking partners, projects, students, and semesters, then
assigning students to project teams via a constraint solver, and provisioning Discord channels/roles and GitHub
repos for the resulting teams. It started from a Nuxt + Better Auth + Prisma + SQLite template (see `README.md`),
so template boilerplate and program-specific code coexist.

## Commands

```bash
pnpm install
pnpm dev            # nuxt dev (app on :3000)
pnpm build          # nuxt build -> .output
pnpm prisma:reset   # migrate reset -f && migrate dev && generate && db seed
npx prettier --write .
```

There is no test runner and no lint script. `server/services/CPSAT/test.ts` is a standalone harness run with
`npx tsx server/services/CPSAT/test.ts` (its README's `cd algorithms/CPSAT` path is stale).

Any schema change means re-running `pnpm prisma:reset`, which wipes `dev.db` and re-seeds it. The Prisma client is
generated into `prisma/generated/` (checked in, not `node_modules`) and configured via `prisma.config.ts`, not a
`generator` block URL — the datasource URL comes from `DATABASE_URL` at runtime.

The CP-SAT solver needs Python 3.8+ with `ortools` installed on the host (`pip install ortools`). Team generation
fails at runtime without it; nothing else in the app depends on Python.

## Architecture

**Request path:** `server/api/**` (Nitro file-routed handlers) → `server/services/*Service.ts` → `prisma` from
`server/utils/prisma.ts`. Handlers stay thin: parse params/body, map errors to `createError`, delegate. Business
logic and all Prisma access belong in services.

**Service convention.** Each entity service exports `XRead` / `XCreate` / `XUpdate` interfaces plus a default object
of CRUD functions (`studentService.getStudentById`, etc.). `XRead` types spell out the shape by hand — including
nested relations that the service's `include` always fetches — rather than deriving from Prisma types. Nested
creates are accepted as `Omit<ChildCreate, 'parentId'>[]` and passed through as `{create: ...}`. Follow this shape
when adding an entity; `studentService.ts` is the clearest reference.

**Imports.** `#server/*` resolves to `server/*` and `@@/*` to the repo root (so Prisma enums come from
`@@/prisma/generated/client`). These are Nuxt-generated aliases — use them instead of relative paths in server code.

**Data model** (`prisma/schema.prisma`): `Partner` → `Project` → `Team`, where a `Team` is one project in one
`Semester` on one meeting day (Wednesday/Thursday). Students connect through three per-semester join models:
`Enrollment` (major/year/class/meeting day, which vary by semester), `Choice` (ranked project preferences), and
`Membership` (the actual team assignment, with an `isMentor` flag). Semester is a first-class entity that most
queries filter on. The Better Auth tables (`user`, `session`, `account`, `verification`) are separate from
`Student` — a logged-in user is not linked to a student record.

**Team formation** (`server/api/team-formation/generate.post.ts`) is the most involved endpoint. It loads
non-mentor students for a semester+day, translates Prisma rows into the CP-SAT wire types (which key on project
*names*, not ids, and use their own enum spellings), shells out to `server/services/CPSAT/team_generator.py` via
`ortools.ts`, then maps names back to ids. It then post-processes: students with no valid choices get placed into
undersized teams, undersized teams borrow from oversized ones, and the request 400s if minimum team size still
can't be met. It writes `Membership` rows as a side effect — calling it twice for a semester will duplicate
memberships.

**Integrations.** `server/services/discordBotService.ts` and `githubService.ts` hold module-level singletons and
mutable status (`running`/`stopped`/`error`) that the `/api/discord/*` and `/api/github/*` endpoints start, stop,
and query. Both degrade gracefully at runtime when `DISCORD_BOT_TOKEN` / `GITHUB_TOKEN` are absent — but that's a
runtime check inside the singleton, not a missing-dependency guard: `server/integrations/github/GithubManagement.ts`
statically `import`s `@octokit/rest` at module top-level, and Nitro's dev server bundles all of `server/api/**` into
one module graph, so a missing package anywhere in that graph 500s *every* API route, not just the ones that use it.
If API routes start failing with `Cannot find package '...'`, check for an uninstalled top-level import before
assuming the bug is elsewhere. `server/plugins/discordBot.ts` also auto-starts a bot at Nitro startup, duplicating
what `discordBotService` does — be aware both paths exist before changing bot lifecycle. The bot's own command/event
tree lives under `server/integrations/discordBot/src/`, loaded dynamically at runtime.

**Frontend** (`app/`) implements the Database page from `docs/UIDesign-v1.1.md` on top of `auth.vue` and
`index.vue` (the latter is still template boilerplate, not yet replaced). `app/middleware/auth.global.ts` gates
every route: no session redirects to `/auth`, a session on `/auth` redirects to `/`. Auth is Better Auth with
email-OTP only — no passwords — so login requires an email that already exists in the `user` table (seeded:
`email@example.com`), and the OTP arrives by Nodemailer or can be read from the `verification` table in Prisma
Studio.

- `app/app.vue` — shell: logo, `Navbar.vue` (Database/Team Formation/Automation/User Management links + Logout),
  dark-mode toggle. `User` (Better Auth) has no admin/role field yet, so the "User Management (admin only)" link is
  shown unconditionally — add real gating once a role concept exists.
- `app/pages/database.vue` — owns the semester filter and the active tab via `provideSemesterFilter()`
  (`app/composables/useSemesterFilter.ts`), and gates both switches: a `UTabs` panel unmounts on hide, which would
  silently destroy staged changes, so switching tabs or changing the semester asks first through
  `confirmDiscard`/`request` rather than moving then restoring. `app/pages/team-formation.vue`, `automation.vue`,
  `users.vue` are unimplemented placeholders the navbar links to.
- `app/components/{Partners,Students,Projects}Tab.vue` — one per major record. Each fetches its list via
  `useFetch` with a reactive `semesterId` query param and defines `DataTable` columns, but no longer owns modal
  state or the save envelope itself: minor-record modals come from `useRecordModals()` and the Confirm/save flow
  (delete confirmation, `saving`, create→update→delete ordering, reset, refresh, error toast) comes from
  `useStagedSave()`, with only the `create`/`update`/`remove` closures supplied per tab. `Contact`, `Choice`,
  `Enrollment`, `Membership`, and `Team` have no list endpoints (see service convention above) — their UI is always
  driven off data nested in the parent major record's response, never a standalone fetch.
- `app/components/DataTable.vue` — generic `UTable` composition used only for major-record tables (Partner/Project/
  Student), matching `docs/UIDesign-v1.1.md` §2.3: client-side tri-state sort (one column at a time), per-column
  search/multiselect filters, row-selection checkboxes, and an Add/Delete/Confirm/Cancel toolbar over a per-table
  staged-changes store (`app/composables/useStagedChanges.ts`). Editable columns render as click-to-edit inline
  inputs; every creation, edit, and deletion accumulates in that store until Confirm, which emits one `save`
  payload for the parent to turn into API calls. Column defs are passed in as a lightweight `DataTableColumn<T>[]`
  prop (`accessorKey`, `sortable`, `filter`, `editable`) — the tab component supplies data, DataTable owns all
  rendering. There is no `RecordPanel.vue` — that slideover shell is deleted; row expansion (`expandable` prop,
  `#expanded` slot) replaced the Item/Creation Panel.
- `app/components/RecordSearchInput.vue` — generic async-search `USelectMenu` (`ignoreFilter` +
  `v-model:search-term`) for §2.5 Record Search Inputs; each tab passes its own `search`/`display-label` functions.
- `app/components/SemesterFilter.vue` + `app/composables/useSemesters.ts` — semester dropdown/clear/add. The
  filter is fully controlled (`modelValue` prop + `update:modelValue` emit, not `defineModel`) so a declined change
  never leaves it showing a semester the page never adopted; `database.vue` wires it through
  `useSemesterFilter()`, and `team-formation.vue` still uses plain `v-model`.
- `app/composables/useConfirm.ts` + `app/components/ConfirmationModal.vue` — `useOverlay().create()` wraps a single
  `ConfirmationModal` instance; call `await useConfirm()({title, affected})` from anywhere to get a boolean. Each
  tab computes its own `affected` cascade counts (e.g. a Partner's `Contacts.length`/`Projects.length`) before
  calling it — the modal itself has no domain knowledge of what cascades.
- `app/composables/` and `app/utils/` — shared building blocks factored out of the three tabs:
  `useSemesterFilter.ts` (gated semester/tab switching, above), `useStagedSave.ts` (the shared Confirm envelope),
  `useRecordModals.ts` (awaited openers for the six minor-record modals), `useRowStaging.ts` (ambient
  `{staging, saving}` access for row-expansion components), `useSemesterCards.ts` (the Students tab's per-semester
  card derivation), `useDirectory.ts` (`useAllPartners`/`useAllProjects`/`useAllStudents`, keyed fetches any
  component can share), and `useSemesters.ts`'s `useSemesterLookup()` (id-keyed label/sort/option helpers). Under
  `app/utils/`: `options.ts` (enum option lists + `ENROLLMENT_FIELDS`), `labels.ts` (display formatting),
  `columns.ts` (`textColumn`/`enumColumn` builders), `search.ts` (client-side typeahead filters), `errors.ts`
  (`errorMessage`), and `recordDrafts.ts` (the minor-record modal draft types).

## Docs

`docs/UIDesign-v1.1.md` is the spec for the UI as built (shell, table/staging/modal patterns, per-page behavior) —
read it before building frontend pages; `docs/UIDesign-v1.0.md` is the superseded forward-looking spec it replaced.
`docs/better_auth.md` and `docs/file_upload_and_serve.md` are template docs carried over from the upstream starter.

## Conventions

Prettier config is authoritative: no semicolons, single quotes, 100 columns, ES5 trailing commas. Much of
`server/` predates this and is inconsistent (semicolons, 4-space continuations) — match the file you are editing
rather than reformatting it wholesale. `vueIndentScriptAndStyle` is on, so `<script setup>` content in `app/*.vue`
files is indented one level under the tag, as in `auth.vue`/`app.vue`.

## Frontend / UI conventions

- **Nuxt UI v4 + Tailwind only.** Compose pages from `@nuxt/ui` components (`UTable`, `USlideover`, `UModal`,
  `UAccordion`, `USelectMenu`, `URadioGroup`, `UForm`/`UFormField`, etc.) and Tailwind utility classes. Do not add
  another component/UI library, and do not hand-roll a component (a data table, a combobox, a stepper) that can be
  built by composing existing Nuxt UI primitives — extend the shared components in `app/components/` instead.
- **`useOverlay()` for imperatively-triggered dialogs.** Anything opened from multiple places (confirmations,
  record-search pickers, minor-record creation modals) should go through `const overlay = useOverlay(); const
  instance = overlay.create(MyModal); const result = await instance.open(props).result`, with the child component
  emitting `close` with the result payload — see `useConfirm.ts`. Reserve inline `v-model:open` on `UModal`/
  `USlideover` for dialogs that only ever live in one place in the tree.
- **Major vs. minor records** (`docs/UIDesign-v1.1.md` §2.3): Partner/Project/Student get full `DataTable`
  treatment (pagination, sort, filter, row-select, staged add/edit/delete). Everything else (Team, Contact, Choice,
  Enrollment, Membership) is a plain list or `UAccordion` of expandable cards inside the parent row's expansion,
  created via a `UModal` Creation Modal, not a panel — there is no Item/Creation Panel any more.
- **Types come from the server, not re-declared.** Import `XRead`/`XCreate`/`XUpdate` as `import type {...} from
  '#server/services/xService'` in `app/` components rather than duplicating field lists — these are type-only
  imports so they erase at build time; see any `*Tab.vue` for the pattern.
- Auto-imports apply throughout `app/`: components in `app/components/` and composables in `app/composables/` don't
  need explicit imports (Nuxt UI components like `UTable`/`UModal` and its `useOverlay` composable are also
  auto-registered by the `@nuxt/ui` module).
