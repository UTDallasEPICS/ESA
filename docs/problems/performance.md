# Performance Findings

This document tracks performance issues found during a full-codebase review. The review covered the
Nuxt frontend, the Nitro API layer, the Prisma services, and the CP-SAT team-formation pipeline; it
**excluded the Discord and GitHub integrations**, which are far from complete and were out of scope.

These findings are **not yet fixed** — they are recorded here as known issues for future work. A
separate, unrelated workstream is currently fixing six other findings from the same review (two
auth/validation criticals, an OTP log leak, a required-parameter bug, a Tailwind class bug, and a
non-reactive default); none of the items below are part of that effort.

## Summary

| ID  | Severity | File                                                        | Issue                                                                      |
| --- | -------- | ----------------------------------------------------------- | -------------------------------------------------------------------------- |
| P1  | High     | `server/api/team-formation/bids.post.ts`                    | Sequential query storm, no transaction, on bid import                      |
| P2  | High     | `studentService.ts`, `projectService.ts`, `useDirectory.ts` | Over-fetching full graphs, then fetching the same data again               |
| P3  | Medium   | `app/components/DataTable.vue`                              | Sort comparator recomputes display values twice per pair                   |
| P4  | Medium   | `app/pages/team-formation.vue`                              | Duplicate/redundant fetches from missing keys and double-triggered watches |
| P5  | Medium   | `server/services/CPSAT/ortools.ts`                          | 30s solver call has no Node-side kill timeout, wrong interpreter name      |
| P6  | Low      | `server/api/team-formation/generate.post.ts`                | Prior-membership query over-fetches then filters in JS                     |

---

## P1 (High) — Bid import is a sequential query storm with no transaction

File: `server/api/team-formation/bids.post.ts`

- Calls `projectService.getAllProjects()` and `partnerService.getAllPartners()` **only** to build two
  name→id lookup maps — but those service methods pull every project with its `Partner`, `Teams`,
  `Memberships`, and each membership's nested `Student` + `Team` + `Project` + `Semester`. An
  enormous object graph, fetched to read two string fields. Replace with
  `prisma.project.findMany({ select: { id: true, name: true } })` and the partner equivalent.
- Per student row: 1 student upsert + 1 enrollment upsert + 1 `choice.deleteMany` + 1
  `choice.createMany` = 4 serialized round-trips, plus one `team.findUnique` per distinct project via
  `ensureTeamForProject`. A 400-row roster is 2,000+ serialized queries.
- No transaction wraps any of it. A failure mid-import leaves partners, projects, students, and
  enrollments half-created, with no rollback and no resume path — the import is not idempotent in
  aggregate even though individual writes are upserts.

**Fix:** lean `select`s for the lookups, batch the per-student work, and wrap the whole import in a
transaction.

---

## P2 (High) — Over-fetching, then fetching the same data twice

Files: `server/services/studentService.ts`, `server/services/projectService.ts`,
`app/composables/useDirectory.ts`

`STUDENT_INCLUDE` in `studentService.ts` pulls every Enrollment, every Choice, and every Membership —
and each Membership carries nested `Student` + `Team` + `Project` + `Semester` via
`MEMBERSHIP_INCLUDE`. The `semesterId` argument filters **which students come back**, not **what is
attached to them**, so selecting a single semester still ships every student's entire multi-semester
history. `projectService`'s includes have the same shape.

On top of that, `useDirectory.ts`'s `useAllStudents()` / `useAllProjects()` fetch the same unfiltered
lists a _second_ time to power client-side search, alongside each tab's own already-filtered fetch.

**Fix:** filter nested relations by `semesterId` inside the `include`, and give the directory/search
fetches a lightweight `select` (id, name, netID) instead of the full graph.

---

## P3 (Medium) — DataTable recomputes display values inside the sort comparator

File: `app/components/DataTable.vue`

`sortedRows` calls `displayValueFor` — which walks the staging store and then runs `col.format` —
**twice per comparison**, so O(n log n) staging lookups on every keystroke. `filteredRows` is
separately O(rows x activeFilters) on every render.

**Fix:** decorate–sort–undecorate. Precompute each row's sort key once, sort on the precomputed
keys, discard.

---

## P4 (Medium) — team-formation.vue issues duplicate and redundant fetches

File: `app/pages/team-formation.vue`

Three `useFetch` calls with **no `key`** — two of them to `/api/projects` (one filtered by semester,
one unfiltered). Without a key they cannot dedupe. Each also specifies both a reactive `query` _and_
`watch: [semesterId]`, which double-triggers the refetch since the reactive query already tracks that
dependency.

**Fix:** give each fetch an explicit `key`, and drop the redundant `watch` where `query` already
covers it.

---

## P5 (Medium) — The 30s solver runs inline with no Node-side timeout

File: `server/services/CPSAT/ortools.ts`

`generateTeamsORTools` spawns Python and awaits the `close` event with **no kill timer**. If the
Python process hangs the HTTP request hangs indefinitely. It also spawns `python`, not `python3` — on
macOS and many Linux distros bare `python` does not exist, and the failure surfaces only as a spawn
error. Even on the happy path the solver is given `max_time_in_seconds = 30.0`, holding a request slot
for up to 30 seconds.

```ts
const pythonProcess = spawn('python', [pythonScriptPath], {
  cwd: dirname(pythonScriptPath),
})
```

**Fix:** add a kill timeout that rejects the promise and terminates the child; resolve the
interpreter (`python3` with a `python` fallback, or a configurable path); and consider moving
generation to a background job rather than an inline request.

---

## P6 (Low) — Prior-membership lookup over-fetches then filters in JS

File: `server/api/team-formation/generate.post.ts`

The `priorMemberships` query fetches every membership across **all** semesters for the students in
the run, with nested `Team.Project` and `Team.Semester`, and only then filters to "strictly earlier
than the current semester" in JavaScript via the `semesterRank` comparison.

**Fix:** push the semester filter into the query.
