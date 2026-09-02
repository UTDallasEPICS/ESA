# Complexity Findings

This document tracks code-duplication and complexity issues found during a full-codebase review. The
review covered the Nuxt frontend, the Nitro API layer, the Prisma services, and the CP-SAT
team-formation pipeline; it **excluded the Discord and GitHub integrations**, which are far from
complete and were out of scope.

These findings are **not yet fixed** — they are recorded here as known issues for future work. A
separate, unrelated workstream is currently fixing six other findings from the same review (two
auth/validation criticals, an OTP log leak, a required-parameter bug, a Tailwind class bug, and a
non-reactive default); none of the items below are part of that effort.

## Summary

| ID  | File(s)                                                         | Issue                                                                  |
| --- | --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| C1  | `server/services/projectService.ts`                             | Same include literal repeated four times                               |
| C2  | ~30 handlers under `server/api/**`                              | Same missing-id boilerplate repeated everywhere                        |
| C3  | `app/utils/bidCsv.ts`, `server/api/team-formation/bids.post.ts` | Two parallel CSV column-alias tables that can drift                    |
| C4  | `server/services/*.ts`                                          | Service CRUD boilerplate ~90% identical (recommend leaving as-is)      |
| C5  | `app/composables/useSemesterCards.ts`                           | Team-change staging machinery exists to work around a missing endpoint |
| C6  | `server/`                                                       | Mixed Prettier / pre-Prettier formatting across the directory          |

---

## C1 — The project include shape is written out four times verbatim

File: `server/services/projectService.ts`

All four functions (`getAllProjects`, `getProjectById`, `createProject`, `updateProject`) repeat the
identical literal:

```ts
{Partner: {select: {id: true, name: true}}, Teams: {include: {Memberships: {include: MEMBERSHIP_INCLUDE}, Semester: true}}}
```

Extract a `PROJECT_INCLUDE` const. The pattern is already established in this codebase by
`PARTNER_INCLUDE` (`partnerService.ts`), `STUDENT_INCLUDE` (`studentService.ts`), and
`MEMBERSHIP_INCLUDE` (`membershipService.ts`) — `projectService` is simply the one that didn't adopt
it.

---

## C2 — Every `[id]` handler repeats the same missing-param check

Files: ~30 handlers under `server/api/**`

The same four lines appear in every single one:

```ts
const id = getRouterParam(event, 'id')
if (!id) {
  throw createError({ statusCode: 400, statusMessage: 'Missing id parameter' })
}
```

A `requireId(event)` helper in `server/utils/` collapses all of it. Separately, the `try/catch` →
`createError` mapping block is duplicated verbatim across the users routes (`users/[id].put.ts`,
`users/[id].delete.ts`).

---

## C3 — Two parallel CSV column-alias tables that will drift

Files: `app/utils/bidCsv.ts`, `server/api/team-formation/bids.post.ts`

Both define the same column-alias lists independently — `NAME_KEYS`, `NETID_KEYS`,
`CLASSIFICATION_KEYS`, `ENROLLMENT_KEYS`, `MAJOR_KEYS`, `GENDER_KEYS` on the client, versus inline
arrays passed to `readFirstValue([...])` plus `choiceKeys` on the server. `readFirst` (client) and
`readFirstValue` (server) are the same function written twice.

This is a live correctness risk, not just duplication: the client validates one set of aliases while
the server reads a different set, so a CSV can pass validation and then be misread on import. Move
both to one shared module.

---

## C4 — Service boilerplate is ~90% identical across nine services

Files: `server/services/*.ts`

Every service is `getXById` / `createX` / `updateX` / `deleteX` wrapping a Prisma call, with a
hand-written `XRead` interface mirroring whatever the `include` fetches.

**Recommendation: leave this as-is.** It is a deliberate, documented convention (see `CLAUDE.md`),
and the explicit `XRead` types are what let the frontend import server types directly. Worth noting
only that `contactService`'s primary-flag shuffling and `choiceService`'s rank shifting are the _only_
real business logic in any of them — everything else is pass-through.

---

## C5 — The membership "team change" machinery exists to work around a missing endpoint

File: `app/composables/useSemesterCards.ts`

`membershipSlot` and `setTeam` are the most intricate code in the application: because changing a
student's team must be staged as a **delete plus a create**, `membershipSlot` has to re-collapse that
pair back into something the UI can render as a single Team field. That requires the client-only
`replacesId` tag to link the two halves, plus separate anchoring logic for mentors (who may hold
several simultaneous memberships in one semester).

All of it exists for one reason: **there is no `PUT /api/memberships/:id`**. Adding that single
endpoint would let a team change be one update, and would delete most of this machinery.

---

## C6 — Mixed formatting across `server/`

`server/` is split between the Prettier config (no semicolons, single quotes, 100 columns) and an
older style (semicolons, double quotes, 4-space continuation indents) — sometimes within a single
directory.

`CLAUDE.md` says to match the file you are editing, which is the right rule while the split exists.
But `server/services/` and `server/api/` would benefit from a one-time `npx prettier --write` landed
as its own standalone commit, so it never mixes with a behavioral change and can be skipped in
review.
