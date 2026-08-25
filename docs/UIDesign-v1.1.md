# ESA UI Design — v1.1

This document describes the UI **as built**. It supersedes `UIDesign-v1.0.md`, which was a forward-looking spec;
where the implementation diverged from that plan, the divergence is recorded here as the current design.

The **staged-changes editing model** (§2.3.1) replaces v1.0's Item Panel and Creation Panel outright. It is
implemented; §3.4 records the limits that remain.

Stack: Nuxt 4 + Nuxt UI v4 + Tailwind. All components live in `app/`; no other UI library is used.

---

## 1. App Overview

### 1.1 Shell (`app/app.vue`)

`UApp` wrapping a full-height column: a sticky, blurred header over a `<main>` that renders `<NuxtPage />`.

| Element      | Component                            | Behavior                                                     |
| ------------ | ------------------------------------ | ------------------------------------------------------------ |
| Logo         | `NuxtLink` + `UIcon` (cube, primary) | "ESA" wordmark; navigates to `/`                              |
| Navigation   | `Navbar.vue`                         | See §2.1                                                      |
| Theme toggle | `UButton` (ghost, neutral)           | Toggles `useColorMode()` between light/dark; icon is sun/moon |

Container width is widened globally to `--ui-container: 95%` (`app/assets/css/main.css`), so pages using
`UContainer` span nearly the full viewport.

| Shell state | Trigger                   | Appearance                              |
| ----------- | ------------------------- | --------------------------------------- |
| Light       | `colorMode !== 'dark'`    | White surfaces, sun icon on the toggle   |
| Dark        | `colorMode === 'dark'`    | `gray-900` surfaces, moon icon on toggle |

### 1.2 Routes

| Route             | File                        | Status                                                                                                       |
| ----------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `/`               | `pages/index.vue`           | **Template boilerplate** — user list, profile-picture upload modal, logout. Not part of the ESA design.        |
| `/auth`           | `pages/auth.vue`            | Implemented (§1.3)                                                                                            |
| `/database`       | `pages/database.vue`        | Implemented (§3)                                                                                              |
| `/team-formation` | `pages/team-formation.vue`  | Implemented (§4)                                                                                              |
| `/automation`     | `pages/automation.vue`      | Placeholder — a single neutral `UAlert` reading "This page is not yet implemented."                            |
| `/users`          | `pages/users.vue`           | Placeholder — same alert pattern (§5)                                                                          |

### 1.3 Authentication

`app/middleware/auth.global.ts` runs on every navigation:

| Session | Target route | Result                     |
| ------- | ------------ | -------------------------- |
| Present | `/auth`      | Redirect to `/`            |
| Present | anything else| Allowed                    |
| Absent  | `/auth`      | Allowed                    |
| Absent  | anything else| Redirect to `/auth`        |

**Login page** (`pages/auth.vue`) — a centered `UCard` titled "Login" containing a two-step `UForm` with a Zod
schema that widens once the OTP has been sent. Email-OTP only; there is no password field.

| State                        | Fields shown              | Submit button | On success                                   | On error                          |
| ---------------------------- | ------------------------- | ------------- | -------------------------------------------- | --------------------------------- |
| `isEmailSent === false`      | Email `UInput`            | "Send OTP"    | Success toast; advances to the OTP state      | Error toast with the auth message |
| `isEmailSent === true`       | 6-digit `UPinInput` (otp) | "Login"       | External navigation to `/`                    | Error toast with the auth message |

Logging in requires an email that already exists in the `user` table. The OTP arrives by Nodemailer, or can be read
from the `verification` table in Prisma Studio.

---

## 2. Shared Components

### 2.1 Navbar (`components/Navbar.vue`)

A `UNavigationMenu` plus a trailing Logout button.

| Item            | Icon                  | Target            |
| --------------- | --------------------- | ----------------- |
| Database        | circle-stack          | `/database`       |
| Team Formation  | user-group            | `/team-formation` |
| Automation      | bolt                  | `/automation`     |
| User Management | shield-check          | `/users`          |
| Logout          | arrow-right-on-rect.  | Calls `authClient.signOut()`, then navigates to `/auth` with a full reload |

There is no role concept on `User` yet, so User Management is shown to everyone — see §5.

### 2.2 Semester Filter (`components/SemesterFilter.vue`)

`v-model` is a `semesterId | undefined`. Backed by `useSemesters()` (`composables/useSemesters.ts`), which fetches
`/api/semesters` under the shared key `semesters` so every mounted instance shares one cache and one refresh.

| Sub-element          | Component                | Visible when          | Action / result                                                                 |
| -------------------- | ------------------------ | --------------------- | ------------------------------------------------------------------------------- |
| Semester Selection   | `USelectMenu` (w-48)     | Always                | Sets the model; placeholder "All Semesters" when unset. Labels read `Fall 2025`. |
| Semester Clear       | `UButton` ✗ (ghost)      | A semester is selected| Resets the model to `undefined`                                                  |
| Delete Semester      | `UButton` − (error/soft) | A semester is selected| Opens the Confirmation Modal; on confirm `DELETE /api/semesters/:id`, refreshes the list, clears the selection. Failures surface as an error toast. |
| Add Semester         | `UButton` + (soft)       | Always                | Opens the Create Semester Modal; on confirm `POST /api/semesters` then refresh   |

| State                        | Condition                                                     | Effect                                                                 |
| ---------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Deletable                    | `teamCount + enrollmentCount + choiceCount === 0`              | Delete enabled; tooltip "Delete this semester"                          |
| Locked                       | The semester has any teams, enrollments, or choices            | Delete **disabled**; tooltip explains those records must be removed first |
| Dangling selection recovered | The selected semester disappears from the shared semester list | A watcher clears the model so the filter cannot point at a deleted row  |

**Create Semester Modal** (`components/CreateSemesterModal.vue`) — a `UModal` opened imperatively via
`useOverlay()`; emits `close` with a `SemesterCreate` or `null`.

| Field  | Input                                          | Validation (Zod)                                                     |
| ------ | ---------------------------------------------- |----------------------------------------------------------------------|
| Season | `URadioGroup` horizontal — Spring/Summer/Fall  | Enum; defaults to `FALL`                                             |
| Year   | `UInputNumber`                                 | Integer; defaults to the current year; no commas should be displayed |

Footer: Cancel (✗) closes with `null`; Confirm (✓) submits the form.

### 2.3 Data Table (`components/DataTable.vue`)

A generic `UTable` composition used only for the three **major records** — Partner, Project, Student. Everything
else (Team, Contact, Choice, Enrollment, Membership) renders as a plain list or `UAccordion` 
card inside the parent record's expanded row.

> **Panels are gone.** v1.0's Item Panel and Creation Panel (and the `RecordPanel.vue` slideover that implemented
> the latter) are removed. A record is created by adding a row, inspected by expanding a row, and edited in place;
> the table is the only editing surface. Modals remain only for collecting the fields of a **minor** record before
> it is staged (§3), and for confirmations (§2.4).

The parent tab supplies data plus a lightweight column definition; the table owns all rendering:

```ts
interface DataTableColumn<T> {
  id: string
  header: string
  accessorKey: keyof T & string
  format?: (value, row) => string          // display-only columns
  sortable?: boolean
  filter?: { type: 'search' | 'multiselect'; options?: {label, value}[] }
  editable?: { type: 'text' | 'select' | 'switch' | 'record-search'; options?: {label, value}[]; search?: (query: string) => Promise<T[]> }
}
```

Props: `data`, `columns`, `rowKey`, `loading`, `expandable`, `newRow` (a factory returning a blank draft record).
Emits: `save(changes)`, `cancel`. The table body sits in a `max-h-[70vh]` scroll container with a sticky header.

#### 2.3.1 Staged changes

**There are no creation or edit panels.** Creating, editing, and deleting all happen in the table itself, and every
pending change is **staged locally** in one per-table store. The table issues **no API call until Confirm is
pressed**; Cancel throws the entire store away and the table reverts to its fetched data.

| Change kind | How it is staged                                                                 | Row appearance                                              |
| ----------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Addition    | Add appends a blank draft row; the user fills it in inline and in its expansion   | Light green row highlight                                    |
| Edit        | Any cell or expansion field on an existing row is changed                        | Blue row highlight; each changed field gets a yellow outline |
| Deletion    | Rows are selected, then Delete is pressed                                        | Red row highlight — the row **stays in view**                |

The four highlight colours are the standard Nuxt UI semantic tints, used consistently everywhere a staged change
is shown — including inside expansions: green = being added, blue = being edited, red = marked for deletion,
yellow = this specific field changed.

Rules:

- Setting an edited field back to its original value clears that field's outline; when a row has no changed fields
  left it stops being blue, and when the store empties, Confirm/Cancel disappear on their own.
- Highlight precedence is deletion > edit > addition. Marking a staged **new** row for deletion simply drops it
  from the store rather than colouring it red.
- A deletion-marked row is read-only: its inline inputs and expansion editors are disabled until it is unmarked.
  Selecting it and pressing Delete again toggles the mark off; Cancel unmarks everything.
- Staged new rows are pinned to the top of the first page and are exempt from sorting and column filters, so a
  half-filled row can never be filtered out of view.
- Expansion editors (teams, contacts, choices, semester info — §3) write into the **same** store, so a change made
  inside a row's expansion turns that row blue and is persisted by the same Confirm.

Confirm emits one payload describing everything staged:

```ts
interface DataTableChanges<T> {
  created: Draft<T>[] // new rows, including any minor records drafted in their expansion
  updated: Record<RowId, Partial<T> & { nested?: NestedChanges }>
  deleted: RowId[]
}
```

The parent translates that single payload into its API calls (see each tab in §3) and refreshes afterwards.

#### 2.3.2 Toolbar (above the table)

| Button  | Icon | Enabled when                             | Result                                                                                                                  |
| ------- | ---- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Add     | +    | Always                                   | Appends one blank draft row (from `newRow`), pre-expanded and focused on its first cell. Each click adds another. No request. |
| Delete  | −    | ≥1 row selected                          | Marks every selected row for deletion and clears the selection. No request.                                              |
| Confirm | ✓    | **Only rendered while the store is non-empty** (a row is being added, edited, or marked for deletion) | Emits `save` with the payload above; on success the store is cleared and highlights vanish. Disabled while any staged row is invalid. |
| Cancel  | ✗    | **Only rendered while the store is non-empty**       | Discards every staged addition, edit, and deletion at once; the table returns to its fetched state                       |

Because Confirm and Cancel are the only write paths, navigating away or switching the semester filter with staged
changes is a destructive act — the parent prompts through the Confirmation Modal before discarding them.

#### 2.3.3 Column headers

Each header is a small stack: label, then (when configured) a sort control, a filter control, and a filter-clear
button.

| Control      | Component                    | States / behavior                                                                                 |
| ------------ | ---------------------------- | -------------------------------------------------------------------------------------------------- |
| Sort         | `UButton` (ghost, xs)        | Cycles **unset** (↕) → **ascending** (↑) → **descending** (↓) → unset. Sorting one column replaces any other column's sort. |
| Filter — search      | `UInput` (xs, w-28)  | Case-insensitive substring match on the column value                                                |
| Filter — multiselect | `USelectMenu` (multiple) | Row passes if its value is in the selected set; an empty set means no filtering                 |
| Filter Clear | `UButton` ✗ (ghost, xs)      | Rendered only while that column's filter has a value; clears it                                     |

Sorting, filtering, and pagination are all client-side over the already-fetched rows.

#### 2.3.4 Expansion and selection columns

| Column | Rendered when   | Behavior                                                                                     |
| ------ | --------------- | -------------------------------------------------------------------------------------------- |
| Expand | `expandable`    | Chevron button per row: ▸ collapsed / ▾ expanded. Toggling renders the parent's `#expanded` slot beneath the row. Multiple rows may be open at once. |
| Select | Always          | Checkbox per row plus a header checkbox                                                        |

Header checkbox states: **all selected** (checked), **some selected** (indeterminate), **none selected** (empty).
Clicking it selects every row unless all are already selected, in which case it deselects everything.

#### 2.3.5 Cells and inline editing

| Column kind          | Rendering                                                                    |
| -------------------- | ---------------------------------------------------------------------------- |
| Not `editable`       | `format(value, row)` if given, else the stringified value; empty renders `—`  |
| `editable: 'text'`   | Ghost `UInput`                                                               |
| `editable: 'select'` | `USelectMenu` over the column's options                                      |
| `editable: 'switch'` | `USwitch` bound to the boolean value                                         |
| `editable: 'record-search'` | `RecordSearchInput` (§2.5) over `search`, for a column that edits a linked major record (e.g. a Project row's Partner) |

| Cell state       | Condition                                                | Appearance                                       |
| ---------------- | -------------------------------------------------------- | ------------------------------------------------ |
| Clean            | Value matches the fetched record                          | Plain cell                                        |
| Edited           | Value differs from the fetched record                     | Yellow outline on the input                       |
| On a new row     | The row is a staged addition                              | No per-field outline — the whole row is green      |
| Invalid          | A required field on a staged row is blank or malformed    | Red outline; Confirm is disabled while any remain |
| Locked           | The row is marked for deletion                            | Input disabled                                     |

On a non-`editable` column the cell is display-only even on a staged new row; values for such columns come from
the expansion (e.g. a project's Partner) or are derived server-side.

#### 2.3.6 Pagination (below the table)

| Control            | Component                              | Behavior                                                        |
| ------------------ | -------------------------------------- |-----------------------------------------------------------------|
| Rows per page      | `USelectMenu` with 10 / 25 / 50 (w-24) | Changing the size resets to the first page                      |
| Page navigation    | `UPagination`                          | First (<<), Previous (<), Next (>), Last (>>) plus page numbers |

| Table state | Condition                                        | Appearance                                                             |
| ----------- | ------------------------------------------------ | ---------------------------------------------------------------------- |
| Loading     | `loading` prop true                              | `UTable`'s built-in loading bar                                        |
| Empty       | `data` is empty and nothing is staged            | `UTable`'s default empty message                                       |
| Clean       | Store empty                                      | Only Add and Delete in the toolbar                                     |
| Dirty       | ≥1 staged addition, edit, or deletion            | Confirm/Cancel appear; affected rows carry their green/blue/red highlight |
| Invalid     | Dirty, and a staged row fails validation         | Confirm disabled; offending fields outlined red                        |
| Saving      | Confirm pressed, requests in flight              | Toolbar buttons disabled, Confirm shows a spinner                      |

### 2.4 Confirmation Modal (`components/ConfirmationModal.vue` + `composables/useConfirm.ts`)

`useConfirm()` lazily creates one shared overlay instance and returns a function:
`await useConfirm()({ title, description?, affected?, confirmLabel? }) → boolean`.

| Element        | Source                          | Notes                                                                    |
| -------------- | ------------------------------- | ------------------------------------------------------------------------ |
| Title          | `title`                         | Usually "Delete N projects?"                                              |
| Description    | `description`                   | The cascade sentence, e.g. "This will also delete all associated teams…"   |
| Affected list  | `affected: {label, count}[]`    | Bulleted `3 Contacts`, `1 Project` — pluralized automatically; hidden when empty |
| Cancel / Confirm | Footer buttons                | Resolve `false` / `true`; Confirm is red and its label is overridable      |

The modal has no domain knowledge — each caller computes its own cascade counts before opening it.

### 2.5 Record Search Input (`components/RecordSearchInput.vue`)

A generic async-search `USelectMenu` (`ignoreFilter` + `v-model:search-term`) for picking a linked major record.
Props: `search(query) → Promise<T[]>`, `displayLabel(item)`, `placeholder`. The model is the selected record.

| State           | Condition                                     | Appearance                                                    |
| --------------- | --------------------------------------------- | ------------------------------------------------------------- |
| Idle            | Menu opened, nothing typed yet                | Empty list — the search only runs on a search-term change      |
| Loading         | A search promise is in flight                 | `USelectMenu` spinner                                          |
| Results         | Search resolved                               | Up to the caller's cap (callers slice to 10)                   |
| Selected        | Model set                                     | Shows `displayLabel(model)`                                    |

Out-of-order responses are discarded via a monotonic token, so a slow early query cannot overwrite a newer result.

### 2.6 Utilities

| Module                 | Purpose                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------- |
| `utils/icons.ts`       | `ACTION_ICONS` — the single source for the +/−/✓/✗ action icons used across every toolbar and modal    |
| `utils/csvExport.ts`   | `rowsToCsv` / `downloadCsv` — quotes cells containing `"`, `,`, or newlines and triggers a blob download |
| `utils/bidCsv.ts`      | `parseCsv` (quote-aware) and `validateBidRows` for the Team Formation bid upload (§4.3)                 |

### 2.7 Icon Reference

| Action        | Icon          | Heroicon                |
| ------------- | ------------- | ----------------------- |
| Add           | Plus (+)      | `i-heroicons-plus`      |
| Delete        | Minus (−)     | `i-heroicons-minus`     |
| Confirm       | Checkmark (✓) | `i-heroicons-check`     |
| Cancel/Clear  | X (✗)         | `i-heroicons-x-mark`    |
| Sort unset/asc/desc | ↕ / ↑ / ↓ | `arrows-up-down`, `arrow-up`, `arrow-down` |
| Expand/collapse row | ▸ / ▾     | `chevron-right`, `chevron-down` |
| Undo a staged change | Uturn arrow | `i-heroicons-arrow-uturn-left` |
| Make primary        | Star      | `i-heroicons-star`      |
| Export / Upload     | ↓ tray / ↑ tray | `arrow-down-tray`, `arrow-up-tray` |
| Generate            | Sparkles  | `i-heroicons-sparkles`  |

---

## 3. Database (`pages/database.vue`)

A `UContainer` with a header row — "Database" plus one `SemesterFilter` — over a `UTabs` with three tabs. The
semester id lives on the page and is passed to all three tabs, so switching tabs preserves the filter.

| Tab      | Component          | Semester filter narrows the list to…                                  |
| -------- | ------------------ | ---------------------------------------------------------------------- |
| Projects | `ProjectsTab.vue`  | Projects with at least one team in that semester                        |
| Students | `StudentsTab.vue`  | Students enrolled that semester **or** mentoring a team that semester   |
| Partners | `PartnersTab.vue`  | Partners owning a project with a team that semester                     |

Each tab fetches its own list with a reactive `semesterId` query param and re-fetches whenever the filter changes.
No semester selected means no filtering.

### 3.1 Projects Tab

#### 3.1.1 Table

| Column       | Field                          | Sort | Filter                                        | Edit                           | Present when            |
| ------------ | ------------------------------- | ---- | ---------------------------------------------- | ------------------------------- | ------------------------ |
| Name         | `name`                          | ✓    | search                                        | text                           | Always                   |
| Type         | `type`                          | -    | multiselect: Software / Hardware / Both       | select (same options)          | Always                   |
| Status       | `status`                        | -    | multiselect: New / Returning / Complete / Withdrawn / Hold | select (same options) | Always            |
| GitHub Link  | `repoURL`                       | -    | search                                        | text                           | Always                   |
| Partner      | `partner.name`                  | ✓    | search                                        | record-search (§2.3.5)         | Always                   |
| Meeting Day  | derived — that semester's team  | ✓    | —                                              | select — Wednesday / Thursday  | A semester is selected   |

Description moved off the table and into the expanded row (§3.1.3), alongside the team detail.

Meeting Day reflects the project's team for the selected semester. When the project has no team that semester the
cell reads `—` and is not editable — a team must first be added from the expanded row (§3.1.3/§3.1.4). When a team
exists, editing this cell stages an update to that team's `meetingDay`.

| Action  | Result                                                                                                                                     |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Add     | Appends a green draft row, pre-expanded. Name/Type/Status/GitHub Link/Partner are typed inline; Description and any initial Teams are set in the expansion. Nothing is sent. |
| Edit    | Editing any cell or expansion field turns the row blue and outlines the changed field yellow. Nothing is sent.                                |
| Delete  | Marks the selected rows red. Nothing is sent.                                                                                                |
| Confirm | If any deletions are staged, first opens the Confirmation Modal listing the total affected **Teams**. Then, in order: `POST /api/projects` per created row (partner id and nested teams in the payload) → `PUT /api/projects/:id` per edited row (with nested team/membership changes) → `DELETE /api/projects/:id` per deleted row → refresh |
| Cancel  | Discards every staged project, edit, and deletion, including expansion changes                                                                |

#### 3.1.2 New Project Row

A staged row is filled in through the same controls used for editing an existing project.

| Field       | Where          | Input                                   | Notes                                                       |
| ----------- | -------------- | ---------------------------------------- | -------------------------------------------------------------- |
| Name        | Inline cell    | `UInput`                                | Required — Confirm blocked while blank                        |
| Type        | Inline cell    | `USelectMenu`                           | Defaults to Software                                           |
| Status      | Inline cell    | `USelectMenu`                           | Defaults to New                                                |
| GitHub Link | Inline cell    | `UInput`                                |                                                                 |
| Partner     | Inline cell    | `RecordSearchInput` over all partners   | Required; fetched under key `partners-all`                     |
| Description | Expansion      | `UTextarea`, edited directly in place    |                                                                 |
| Teams       | Expansion      | Team Creation Modal (§3.1.4)             | Optional; each staged team is listed green                     |

#### 3.1.3 Expanded Row — Description and Teams

The expanded row is a Description field (`UTextarea`, edited directly in place — there is no separate edit mode)
over a **Teams** heading with an "Add Team" button, over the project's team cards.

| Semester filter | Teams shown                                                | Card behavior                                                              |
| ---------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Unset            | Every team, sorted most-recent-semester first                | Multi-open `UAccordion`, collapsible; label reads `Fall 2025 — Wednesday`      |
| Set               | Only that semester's team, if one exists                     | A single, **non-collapsible** card — no accordion chrome                       |

Every action here stages a change on the parent project row — no request is made until the table's Confirm.

| Element               | Action                                                                                                    | Staged appearance                       |
| ----------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Add Team               | Opens the Team Creation Modal and appends the result                                                     | New team card tinted green                |
| Delete Team            | Marks that team for deletion; the card stays in place and its members are locked                          | Team card tinted red                      |
| Mentors list           | One bordered row per membership with `isMentor = true`; "Add Mentor" + button                             | —                                          |
| Students list          | One bordered row per membership with `isMentor = false`; "Add Student" + button                           | —                                          |
| Add Mentor / Student   | Opens the Member Creation Modal and appends the picked student to that list                                | Member row tinted green                   |
| Move (per member)      | Opens the Move Student Modal; on confirm, stages that membership as deleted from this team and stages a new membership on the chosen destination team | Member row tinted red here; a new green row appears on the destination team's card |
| Remove (per member)    | Marks that membership for deletion; the row stays in view                                                  | Member row tinted red                     |
| Undo (on a staged row) | Available on any green/red item — drops the staged addition or unmarks the deletion                        | Returns to normal                          |

Any staged team or membership change — including a Move, which touches two team cards at once — turns the parent
project row blue. Nothing is written until the table's Confirm.

#### 3.1.4 Team Creation Modal

| Field       | Input                                                  |
| ----------- | -------------------------------------------------------- |
| Semester    | `USelectMenu` over all semesters                        |
| Meeting Day | `URadioGroup` horizontal — Wednesday / Thursday           |

Zod-validated. Confirm **stages** `{ semesterId, meetingDay }` on the project (as a nested create) and closes;
it issues no request. Cancel discards the modal's input only.

#### 3.1.5 Member Creation Modal

Titled "Add Mentor" or "Add Student" depending on which button opened it. Body is a single `RecordSearchInput`
that searches the all-students list by netID or full name, excludes students already on that team (staged
additions included), and caps at 10 results. Confirm is disabled until a student is picked; it **stages**
`{ studentId, isMentor }` on that team and issues no request.

#### 3.1.6 Move Student Modal

Opened from a member row's Move button. Body is a single `USelectMenu` listing the project's **other** teams
(excluding the member's current team), labeled `Fall 2025 — Wednesday`, sourced from the same team list as §3.1.3
including any staged-new teams. Confirm is disabled until a destination is picked.

Confirm stages both halves of the move at once and issues no request:

| Staged change                | Where it appears                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------------------- |
| Membership marked for deletion | The member's row on the **source** team's card, tinted red                                |
| New membership staged          | A new row on the **destination** team's card, tinted green, carrying the same `isMentor` value |

Cancelling the Move Student Modal discards the move only; the member's row on the source card is unaffected.

### 3.2 Students Tab

#### 3.2.1 Table

| Column       | Field                    | Sort | Filter                                 | Edit                            | Present when              |
| ------------ | -------------------------- | ---- | ----------------------------------------- | ---------------------------------- | --------------------------- |
| NetID        | `netID`                    | ✓    | search                                    | text                               | Always                       |
| First Name   | `firstName`                | ✓    | search                                    | text                               | Always                       |
| Last Name    | `lastName`                 | ✓    | search                                    | text                               | Always                       |
| Email        | `email`                    | ✓    | search                                    | text                               | Always                       |
| Discord      | `discord`                  | ✓    | search                                    | text                               | Always                       |
| Is Mentor?   | `isMentor`                 | ✓    | multiselect: Mentor / Student              | switch                             | Always                       |
| Meeting Day  | `enrollment.meetingDay`    | ✓    | —                                        | select — Wednesday / Thursday      | A semester is selected       |
| Gender       | `enrollment.gender`        | ✓    | —                                        | select — Male / Female / Other     | A semester is selected       |
| Major        | `enrollment.major`         | ✓    | —                                        | text                               | A semester is selected       |
| Year         | `enrollment.year`          | ✓    | —                                        | select — Freshman…Senior          | A semester is selected       |
| Class        | `enrollment.class`         | ✓    | —                                        | select — EPCS_2200 / EPCS_3200     | A semester is selected       |

All five semester-specific columns read from the student's **Enrollment** record for the selected semester — not
from any Membership. A student who only mentors that semester (no enrollment) shows `—` in all five and they are
not editable there; an enrollment must exist first, created via Add Semester Info in the expansion (§3.2.5).
Editing one of these cells stages the same change as editing the matching field on that semester's card in the
expansion (§3.2.3) — the two surfaces share one staged edit.

| Action  | Result                                                                                                                                                |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add     | Appends a green draft row, pre-expanded; semester info is added in its expansion. Nothing is sent.                                                      |
| Edit    | Row turns blue, changed field outlined yellow. Nothing is sent.                                                                                        |
| Delete  | Marks the selected rows red. Nothing is sent.                                                                                                          |
| Confirm | If deletions are staged, first opens the Confirmation Modal listing affected **Enrollments**, **Choices**, and **Memberships**. Then `POST /api/students` per created row (with nested enrollments/memberships/choices) → `PUT /api/students/:id` per edited row → `DELETE /api/students/:id` per deleted row → refresh |
| Cancel  | Discards every staged student, edit, and deletion                                                                                                      |

#### 3.2.2 New Student Row

| Field      | Where       | Input         | Notes                                       |
| ---------- | ----------- | ------------- | ------------------------------------------- |
| NetID      | Inline cell | `UInput`      | Required — Confirm blocked while blank      |
| First Name | Inline cell | `UInput`      | Required                                    |
| Last Name  | Inline cell | `UInput`      | Required                                    |
| Email      | Inline cell | `UInput`      | Sent as `undefined` when blank              |
| Discord    | Inline cell | `UInput`      | Sent as `undefined` when blank              |
| Is Mentor? | Inline cell | `USwitch`     | Defaults off; drives the Role field in §3.2.5 |
| Semester Info | Expansion | Semester Info Creation Modal (§3.2.5) | Optional; each staged entry is listed green |

#### 3.2.3 Expanded Row — Semester Info

A **Semester Info** heading with an "Add Semester Info" button over a multi-open `UAccordion` of per-semester
cards, filtered to the selected semester when one is set and sorted most-recent first.

Cards are derived from the student's records: every enrollment produces a `Student` card, and every mentor
membership produces a `Mentor` card, so a student who mentors and enrolls in the same semester gets two. Labels
read `Fall 2025 — Student` / `Fall 2025 — Mentor`.

Every action in a card stages a change on the parent student row; nothing is sent until the table's Confirm. No
field in a card is gated behind an Edit button — every editable field is directly editable in place.

| Card body element      | Present on   | Behavior                                                                                          | Staged appearance                    |
| ----------------------- | ------------ | ----------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Add Semester Info (+)   | Header       | Opens the Semester Info Creation Modal; the result is appended as a new card                          | Card tinted green                       |
| Delete Semester Info    | Both roles   | Marks the underlying enrollment or mentor membership for deletion; the card stays                     | Card tinted red, contents locked        |
| Enrollment fields       | Student only | Meeting Day / Gender / Major / Year / Class, each editable in place                                    | Changed field outlined yellow — the same staged edit as the matching column in §3.2.1 |
| Team                    | Both roles   | `RecordSearchInput` over teams with a team that card's semester (searches by project or partner name), editable directly — no separate edit control. Picking a team when previously unassigned stages a new Membership; picking a different team stages an update to the existing one; clearing it stages that Membership's deletion. | Field outlined yellow when changed; an unassigned-to-assigned change is still just an edit on this card, not a separate staged row |
| Team Preferences        | Student only | Ranked list `#1 Project Name`, ordered by rank                                                         | —                                        |
| Add Preference (+)      | Student only | Opens the Team Preference Modal; appends the pick to the list                                          | Preference row tinted green              |
| Move Up / Move Down     | Student only | Reorders the list locally and stages the resulting ranks                                               | Reordered rows outlined yellow           |
| Remove (−)              | Student only | Marks that choice for deletion; the row stays in view                                                  | Preference row tinted red                |

#### 3.2.4 Team Preference Modal

Titled "Add Team Preference". A single `RecordSearchInput` over projects that have a team in that card's semester,
excluding projects the student already chose (staged picks included), searching by project **or** partner name,
capped at 10. The new choice is appended at `max(existing ranks) + 1`. Confirm is disabled until a project is
picked, and **stages** the choice rather than sending it.

#### 3.2.5 Semester Info Creation Modal

| Field       | Input                                     | Shown when                                |
| ----------- | -------------------------------------------- | -------------------------------------------- |
| Semester    | `USelectMenu`                                | Always                                        |
| Meeting Day | `USelectMenu` — Wednesday / Thursday          | Always                                        |
| Role        | `URadioGroup` — Student / Mentor              | Only if the student's mentor flag is set       |
| Major       | `UInput`                                     | Role = Student                                |
| Year        | `USelectMenu` — Freshman…Senior               | Role = Student                                |
| Class       | `USelectMenu` — EPCS_2200 / EPCS_3200         | Role = Student                                |
| Gender      | `USelectMenu` — Male / Female / Other         | Role = Student                                |
| Team        | `RecordSearchInput` over projects with a team that semester | Optional for either role — leave blank to create the card unassigned and set it later from the card (§3.2.3) |

Confirm **stages** the entry as a new card and issues no request. What the table's Confirm later sends depends on
the role:

| Role staged | Request issued on Confirm                                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Student     | `POST /api/enrollments` with student, semester, meeting day, major, year, class, gender; plus `POST /api/memberships` if a team was picked  |
| Mentor      | `POST /api/memberships` with `isMentor: true`, resolved to the picked project's team for that semester; nothing is sent if left unassigned  |

For a **new** student row, these are sent as nested creates inside the row's `POST /api/students`.
### 3.3 Partners Tab

#### 3.3.1 Table

Rows are partners flattened with their **primary contact** (the contact flagged primary, else the first one), so
the contact columns are editable proxies onto a different record.

| Column  | Field (row)     | Sort | Filter | Edit |
| ------- | --------------- | ---- | ------ | ---- |
| Name    | `name`          | ✓    | search | text |
| Contact | `primaryName`   | ✓    | search | text |
| Email   | `primaryEmail`  | ✓    | search | text |
| Phone   | `primaryPhone`  | ✓    | search | text |

| Action  | Result                                                                                                                                                          |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Add     | Appends a green draft row (Name inline, contacts in the expansion). Nothing is sent.                                                                              |
| Edit    | Row turns blue, changed field outlined yellow — including the three contact-proxy columns. Nothing is sent.                                                       |
| Delete  | Marks the selected rows red. Nothing is sent.                                                                                                                    |
| Confirm | If deletions are staged, first opens the Confirmation Modal listing affected **Contacts** and **Projects**. Then each row's changes are split: partner fields → `POST`/`PUT /api/partners/:id`; contact fields → `PUT /api/contacts/:id` for the primary contact, or `POST /api/contacts` when the partner has none (nested into the partner create for a new row); then `DELETE /api/partners/:id` per deleted row → refresh |
| Cancel  | Discards every staged partner, edit, and deletion, including contact changes                                                                                     |

Editing a contact-proxy column and editing that same contact's card in the expansion are the same staged change —
whichever is touched last wins, and both surfaces show the yellow outline.

#### 3.3.2 Expanded Row — Contacts and Projects

**Contacts** — a heading with "Add Contact" over a list of bordered cards. Fields are edited in place; every
action stages a change on the parent partner row and issues no request.

| Card state        | Contents                                                                                                             |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Display           | Name, Email, Phone as ghost inputs (`—` placeholder when blank), a "Primary" `UBadge` when applicable, plus the action buttons |
| Edited            | Same, with each changed field outlined yellow                                                                          |
| Staged addition   | Whole card tinted green                                                                                                |
| Marked for deletion | Whole card tinted red, inputs disabled                                                                               |

| Button       | Visible when                    | Result                                                                    |
| ------------ | ------------------------------- | --------------------------------------------------------------------------- |
| Add Contact  | Header                          | Opens the Contact Creation Modal; the result is appended as a green card     |
| Make Primary | Contact is not primary          | Stages `isPrimary: true` on that contact (and clears it on the previous primary) |
| Delete       | Card is not already marked      | Marks the contact for deletion; the card stays in view                      |
| Undo         | Card is staged green or red     | Drops the staged addition, or unmarks the deletion                          |

**Projects** — a plain read-only list of the partner's project names, narrowed to projects with a team in the
selected semester when a filter is set. Projects are created from the Projects tab, not here.

#### 3.3.3 Contact Creation Modal

| Field | Input    | Notes                                    |
| ----- | -------- | ---------------------------------------- |
| Name  | `UInput` | Required                                 |
| Phone | `UInput` | Sent as `undefined` when blank            |
| Email | `UInput` |                                          |

Confirm **stages** the contact under the parent partner and closes; the `POST /api/contacts` (or the nested create
on a new partner) happens on the table's Confirm.

### 3.4 Implementation notes and known limits (Database)

The staged-changes model is **built**. `app/composables/useStagedChanges.ts` holds one store per table —
row creations, row edits, deletions, and nested minor-record changes — and `DataTable` renders through it;
each tab turns the single Confirm payload into its API calls. `RecordPanel.vue` is deleted. What remains:

| Limit                       | Behavior today                                                                                                  |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Item Panel                  | Not planned. Record detail lives in expandable rows, and clicking a record name does nothing.                     |
| Proxy columns on a new row  | `editable.child` resolves against the fetched record, so a column cannot proxy a **staged-new** child. On a brand-new project row Meeting Day stays read-only; set the day in the Team Creation Modal instead. |
| Accordion tinting           | `UAccordion` exposes no per-item hook for its trigger, so in the semester-unset view a staged-green or -red team tints its body but not its header. |
| Staged primary contact      | The Partners contact-proxy columns target the **fetched** primary, so after a staged Make Primary those columns keep editing the previous primary until Confirm. |
| Team change is delete+create| There is no `PUT /api/memberships/:id`, so re-pointing a student at another team stages a delete plus a create. The Students tab re-collapses that pair into one card; the Projects tab's Move does the same across two cards. |
| Primary not promoted        | `contactService.deleteContact` does not promote a replacement primary, so deleting a partner's primary contact leaves the partner with none (the table then falls back to the first contact for display). |
| Clearing a record search    | `RecordSearchInput` has no `clearable`, so a card that needs an unset action renders its own ✗ button beside it.  |

Choice reordering deliberately stages a new rank on **only** the moved choice: `choiceService.updateChoice`
already shifts siblings, so rewriting every rank would fight it.

---

## 4. Team Formation (`pages/team-formation.vue`)

One narrow page (`max-w-4xl`) of three numbered sections separated by `USeparator`. The v1.0 stepper was
flattened into stacked sections: all three are visible at once, and each guards itself with disabled controls and
hint text rather than blocking progression.

### 4.1 Section 1 — Semester & Meeting Day

| Element        | Component                                          | Behavior                                                        |
| -------------- | -------------------------------------------------- | ---------------------------------------------------------------- |
| Semester       | `SemesterFilter` inside a `UFormField`             | Full filter, including Add/Delete Semester (§2.2)                 |
| Meeting Day    | `URadioGroup` — Wednesday / Thursday                | Defaults to Wednesday; drives sections 1–3                        |
| Export Teams   | `UButton` (↓ tray, soft)                            | Disabled until a semester and day are set; see §4.2               |
| Teams list     | Bordered rows, `Project — Partner` + member count   | Only rendered once a semester is selected                         |

| State              | Condition                                                   | Appearance                                                                     |
| ------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| No semester        | `semesterId` unset                                           | Teams list hidden; upload disabled; generation disabled                         |
| No teams for day   | Fetch settled and no team matches the semester + day          | Warning `UAlert` "No teams found" pointing the user at the Database tab         |
| Teams present      | ≥1 matching team                                             | The list, each row showing its current membership count                         |

### 4.2 Team Export

Downloads `Wed Teams - Fall-2025.csv` (or `Thu …`) built entirely client-side from the already-fetched data. One
row per membership on a team matching the selected day:

| Column                                                   | Source                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------- |
| Team                                                     | `F25 - Partner Name: Project Name`                             |
| Student                                                  | `Last, First`                                                  |
| Choice 1 … Choice 6                                      | The student's ranked choices for that semester, blank-padded to 6 |
| Student Major / Student Classification / Gender / Skills / Comments | The student's enrollment for that semester (skills joined with `; `) |

### 4.3 Section 2 — Bid File

| Element         | Component                    | Behavior                                                                  |
| --------------- | ---------------------------- | ------------------------------------------------------------------------- |
| Bid Response CSV| `UFileUpload` (accept `.csv`)| Disabled until a semester is chosen; hint text "Select a semester above first." |
| Upload          | `UButton` (↑ tray)           | Enabled only when a semester is set and the parsed file is error-free      |

Selecting a file parses and validates it in the browser (`utils/bidCsv.ts`) **before** anything is sent. Validation
checks that each required column group is present under one of its accepted header spellings — Student Name, SSO
ID, Classification, Enrollment, School and Major, Gender — and then that every row has a Student Name. (The
per-row checks for netID uniqueness, classification, enrollment code, major, and gender are written but currently
commented out.)

| Validation state | Condition                                | Feedback                                                                    |
| ---------------- | ---------------------------------------- | --------------------------------------------------------------------------- |
| Missing columns  | A required column group has no match      | Error `UAlert` "Missing required columns" listing them; upload blocked        |
| Row errors       | ≥1 row failed                             | Error `UAlert` with the count, plus a scrollable (`max-h-64`) list of `Row N: message`; upload blocked |
| Valid            | No missing columns and no row errors      | Success `UAlert` "N row(s) validated successfully"; upload enabled           |

Submitting `POST`s the parsed rows to `/api/team-formation/bids` with the semester and meeting day as query
params, then refreshes the semester's projects and students. On success the file input is deliberately cleared, so
changing the meeting day and clicking Upload again cannot silently re-import the same roster under the new day.

| Result state       | Feedback                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------ |
| Uploading          | Upload button shows its loading spinner and is disabled                                                       |
| Failed             | Error `UAlert` "Upload failed" with the server message                                                        |
| Imported           | Success `UAlert` — "N student(s) imported, M choice(s) recorded."                                             |
| Skipped rows       | Warning `UAlert` naming rows dropped for a missing SSO ID                                                     |
| Unmatched projects | Warning `UAlert` listing bid choices whose project could not be matched                                       |
| Meeting day moved  | Warning `UAlert` naming students who already had an enrollment that semester on the other day and were moved  |

### 4.4 Section 3 — Team Generation

| Parameter                      | Input                                          | Default |
| ------------------------------ | ---------------------------------------------- | ------- |
| Min Team Size                  | `UInputNumber` (min 1)                          | 4       |
| Max Team Size                  | `UInputNumber` (min = current min team size)    | 6       |
| Prioritize returning students  | `UCheckbox`                                     | on      |
| Prioritize 3200 first choice   | `UCheckbox`                                     | on      |
| Balance gender                 | `UCheckbox`                                     | on      |

Generate Teams (sparkles) `POST`s `{ semesterId, day, config }` to `/api/team-formation/generate` and then
refreshes the page's project and student data.

| State            | Condition                                                | Appearance                                                                     |
| ---------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Blocked          | No semester, or no team for the semester + day             | Button disabled; hint "Select a semester/day with at least one team above first." |
| Generating       | Request in flight                                          | Button spinner; prior results cleared                                            |
| Failed           | Request threw (includes a missing Python/ortools host, or a minimum team size that cannot be met) | Error `UAlert` "Team generation failed" with the server message |
| Succeeded clean  | No fallback placements                                     | Success `UAlert` "Teams generated successfully"                                  |
| Succeeded w/ notes | ≥1 student had no valid choices                          | Warning `UAlert` "Teams generated — some students needed best-effort placement", listing the count placed by fallback logic |

Results render as one bordered card per team: the project name over the list of assigned students
(`First Last (netID)`).

---

## 5. User Management (`pages/users.vue`)

Not implemented. The route renders a single neutral `UAlert` (wrench icon) titled "User Management" with the
description "This page is not yet implemented."

The Navbar links to it unconditionally: Better Auth's `User` has no admin/role field, so the "admin only" gating
from v1.0 cannot be expressed yet. Building this page needs, in order:

1. A role concept on `User` (server-side), and route/middleware gating that reads it.
2. Conditional rendering of the Navbar entry.
3. The page itself — at minimum a list of users, invite-by-email (which is what makes login possible, since OTP
   sign-in requires a pre-existing `user` row), role assignment, and removal.

Note that `pages/index.vue` still contains the upstream template's user list and profile-picture upload; it is
boilerplate rather than a design element, but it is the closest existing reference for user-facing account UI.
