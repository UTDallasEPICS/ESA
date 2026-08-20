# Team Generation Algorithm

This document describes how ESA turns a semester's students, their ranked project preferences, and the set of
active projects into concrete team assignments. It covers the pipeline's stages, the constraints the solver
enforces, and the edge cases that are handled explicitly.

Superscript numbers throughout the document refer to specific code locations. The full mapping is in
[Code References](#code-references) at the end.

---

## 1. Algorithm

Team generation is triggered by a single endpoint, `POST /api/team-formation/generate`, which accepts a semester
id, an optional meeting day, and an optional solver configuration object.<sup>[1]</sup> The endpoint rejects a
request with no semester id, and rejects a meeting day that is not `WEDNESDAY` or `THURSDAY`.<sup>[2]</sup>

The pipeline has two stages, executed in order:

1. **CP-SAT solver** (Python, via OR-Tools) — the sole optimizer. It formulates the whole assignment problem as
   an integer program and maximizes a satisfaction score, subject to a hard constraint that every team's size
   falls within `[min_team_size, max_team_size]`. If no such assignment exists, the run fails cleanly instead of
   falling back to a looser heuristic.
2. **Post-processing** (TypeScript) — a light repair pass for students with no valid preferences, run
   unconditionally on the solver's output before anything is written to the database.

There is no greedy fallback and no project deactivation. Every team the solver returns is guaranteed to be within
bounds; if the student count and team count can't mutually satisfy `[min_team_size, max_team_size]` for every
team, the request fails with a clear error instead of silently dropping or shrinking teams below minimum.

### Data gathering

Before any solving happens, the endpoint assembles the problem.

**Students.** It loads every non-mentor student who has an enrollment in the requested semester and meeting day,
pulling in that semester's ranked choices and enrollment record alongside each student.<sup>[3]</sup> Mentors are
excluded entirely — they are never assigned by this algorithm.

**Projects.** The set of candidate projects is *not* every project in the database. It is derived from the `Team`
rows that already exist for the requested semester and day: each such team points at a project, and that project
becomes a candidate.<sup>[4]</sup> A project only participates in team generation if an administrator has already
activated it for that semester by creating its team. If either the student list or the project list comes back
empty, the request fails with a 400 and an explanatory message.<sup>[5]</sup>

**Preference translation.** The solver identifies projects by *name*, not by database id, so each student's
`Choice` rows are sorted by rank, converted to project names, and filtered down to only those names that
correspond to a currently active project.<sup>[6]</sup> A preference for a project that was not activated this
semester silently disappears at this step. A student whose entire preference list is filtered away ends up with
an empty choice list — see [§3](#3-edge-case-handling).

**Enum translation.** The Prisma enums are remapped into the spellings the Python script expects: `FRESHMAN` →
`Freshman`, `SOFTWARE` → `SW`, `EPCS_2200` → `2200` (everything else → `3200`), `WEDNESDAY` → `Wednesday`,
`MALE`/`FEMALE`/`OTHER` → `Male`/`Female`/`Prefer not to say`, and so on.<sup>[7]</sup> Each student's enrollment
fields are read from the *first* enrollment record returned for that semester. Project day is derived from the
`Team` row (a `Team` always has a concrete `meetingDay`, independent of whether the request filtered on
day)<sup>[7]</sup> rather than dropped, so the day-matching constraint is live even when the request omits the
`day` param and both cohorts are pulled in together.

**Returning-student detection.** For each student, the endpoint looks up their most recent *prior*-semester
`Membership` (non-mentor, strictly before the current semester by year/season ordering) and treats that project as
their `previousProject`<sup>[7a]</sup> — but only if the student is 3200-level and that project is still among
their current-semester ranked choices, mirroring the two conditions the Python side itself requires (Constraint 3
and the objective's choice-list gating). A student with no qualifying prior membership, or whose prior project
fell out of their current choices, gets no `previousProject` at all.

**Process invocation.** The wrapper locates `team_generator.py` by trying four candidate paths in order and
throwing if none exist,<sup>[8]</sup> then spawns a `python` child process, writes the problem as JSON to its
stdin, and reads the result as JSON from its stdout.<sup>[9]</sup> A non-zero exit code, or a result whose
`success` flag is false, rejects the promise and surfaces as an error to the caller.<sup>[10]</sup> On success the
solver's list of student ids per project is rehydrated back into full student objects.<sup>[11]</sup>

One detail of the wrapper matters: the default configuration block is substituted **only when the caller supplies
no configuration at all**.<sup>[12]</sup> A partially specified configuration is forwarded verbatim, and the
Python side reads `min_team_size`/`max_team_size` with direct subscripting rather than `.get()` — so a partial
config that omits either one raises a `KeyError` and fails the run. The endpoint's request handler itself always
supplies a full config object built from safe defaults,<sup>[1]</sup> so this only matters for direct API callers
that bypass the UI.

The endpoint wraps the solver call in a try/catch: any rejection — infeasibility, a missing Python script, a
crashed process — is converted into a 400 with the underlying message, so the UI's error banner always shows
something actionable rather than a generic server error.<sup>[13]</sup>

---

### 1.1. CP-SAT Solver

The CP-SAT stage builds an integer program and asks OR-Tools to maximize a weighted satisfaction score.

**Decision variables.** For every (student, project) pair there is one boolean variable that is 1 if that student
is assigned to that project.<sup>[14]</sup> With *S* students and *P* projects the model has *S × P* booleans.

**Structural constraints.** Every student is assigned to exactly one project — the sum of a student's booleans
across all projects is forced to 1.<sup>[15]</sup> There is no "unassigned" option in the model.

Every project's headcount is hard-constrained to fall between `min_team_size` and `max_team_size`, with no
exceptions.<sup>[16]</sup> There is no "inactive" state, no overflow allowance, and no soft version of this
constraint — if the solver can't find an assignment where every project satisfies it, the model is infeasible and
the run fails (see below), rather than dropping a project to zero students or letting one run over capacity.

**Validation.** A student with a `previousProject` set who isn't 3200-level raises an exception that aborts the
whole run before solving begins.<sup>[17]</sup> In production this can only happen if the returning-student
derivation in `generate.post.ts` has a bug, since it already gates on 3200-level itself — the check here is a
second, independent guard.

**Day matching.** A student may not be assigned to a project whose meeting day differs from theirs, but only when
*both* sides have a day set.<sup>[18]</sup> Since project day is now always populated,<sup>[7]</sup> this
constraint is live in every run — day separation no longer relies solely on the initial student/team query
filters.

**Objective function.** The score is a sum of per-assignment terms. For each (student, project) pair where the
project appears in the student's choice list, a base score is assigned by rank: 1000 for first choice, 500 for
second, 200 for third, 100 for fourth, 50 for fifth, 25 for sixth, and 0 beyond that — the same curve for every
student regardless of class.<sup>[19]</sup>

**EPCS 3200 students** get a flat 100× multiplier applied to that rank-based score when
`prioritize_3200_first_choice` is enabled (the default).<sup>[20]</sup> This makes upper-class preferences
dominate the objective; a 3200 student's third choice (20,000) still outweighs a 2200 student's first choice
(1,000). EPCS 2200 students receive no multiplier and no special curve — they score on the same plain rank-based
values as everyone else.

Two optional bonuses are layered on top: a 1.5× multiplier for returning a student to their previous project (only
reachable when that project is also one of their current choices, since the multiplier applies to the already-
computed rank-based score),<sup>[21]</sup> and a project-type-to-major fit bonus: 80 for any student on a
"Both"-type project, or 60 for a software-track major (`CS`/`SE`/`DS`) on a software project or a
hardware-track major (`EE`/`ME`/`BME`/`CE`) on a hardware project.<sup>[22]</sup> The major-fit bonus is
unconditional — it always applies, it isn't gated behind a config flag.

**Gender balance.** When `balance_gender` is enabled (the default), the model counts male and female students per
team and applies a −500 penalty whenever exactly one student of either gender is on a team, using reified booleans
to detect the isolated case.<sup>[23]</sup> Gender is now populated on every student the endpoint sends
(`MALE`/`FEMALE`/`OTHER` from Prisma map to `Male`/`Female`/`Prefer not to say`),<sup>[7]</sup> so this penalty is
live in every run where the flag is on. `Non-binary` and `Prefer not to say` students are counted into the
tally but never isolated against, since only male/female counts drive the penalty.

**Solving.** The model is maximized with a 30-second wall-clock limit.<sup>[24]</sup> If the solver returns an
optimal or feasible solution, the assignment is read out and returned as `{success: true, teams, score,
solve_time, status}`.<sup>[25]</sup> If the solver returns anything else — infeasible, or no solution found within
the time limit — the function returns `{success: false, error: '<message>'}` describing the failure, without
attempting any fallback assignment.<sup>[26]</sup> This is a plain `return`, not a `raise`: `main()`'s exception
handler exits the process with code 1, and the TypeScript wrapper checks the exit code *before* attempting to
parse stdout as JSON,<sup>[9]</sup> so an infeasible-but-clean result must exit 0 to have its descriptive `error`
message actually reach the caller instead of being replaced by a generic "process exited with code 1" message.

---

### 1.2. Post Processing

Post-processing runs in TypeScript on whatever the Python stage returned, and always runs.

**Remapping.** The solver's project-name keys are converted back to project ids, and its student objects are
matched back to the full Prisma student records. Every active project is seeded with an empty array first.<sup>[27]</sup>

**Placing students with no valid choices.** The endpoint collects every student whose remapped choice list was
empty<sup>[28]</sup> and takes a census of current team sizes and per-team major distributions. Each such student
is then considered individually. Candidate destinations are teams that are non-empty and below `max_team_size`,
sorted smallest-first, with ties broken in favour of the team that already holds the most students of the same
major.<sup>[29]</sup> One of the top three candidates is then chosen **at random**,<sup>[30]</sup> which spreads
these students out instead of piling them all onto the single smallest team — and which also makes the endpoint
non-deterministic across runs on identical input.

The move is guarded on the source side: it's abandoned if the student is already on the chosen team, and
abandoned if their current team is at or below `min_team_size`, so this pass can never push a compliant team below
minimum.<sup>[31]</sup> Only when a student was successfully removed from a source team are they appended to the
destination and the size census updated.<sup>[32]</sup>

**The minimum-size gate.** After this pass, any team that is still non-empty and still below `min_team_size`
causes the request to fail with a 400 listing the offending projects and their sizes.<sup>[33]</sup> In practice
this should be unreachable — CP-SAT already guarantees every returned team is within bounds, and the no-choice
pass's own guards prevent it from creating a new violation — but it's kept as a cheap defensive check. Empty teams
are exempt from this check, though under the current hard-constraint model a project only ever appears empty if
`min_team_size` itself was configured to 0 via a direct API call bypassing the UI's `:min="1"` input.

**Persistence and response.** Before writing anything, all existing non-mentor `Membership` rows for this
semester/day's teams are deleted; the new assignments are then flattened into `Membership` rows and inserted in a
single `createMany`. Both steps run inside one transaction, so a run either fully replaces the prior assignment or
leaves it untouched.<sup>[34]</sup> Mentor memberships (`isMentor: true`, assigned through a separate flow) are
never touched by this deletion. The endpoint returns the assignments keyed by team id, the project list, per-team
metadata, and a `notes` object containing just `noChoiceStudentsReassigned` — the count of students placed by the
no-choice pass.<sup>[35]</sup>

Generation is therefore idempotent per semester/day: running it twice replaces the previous student roster rather
than duplicating it.

---

## 2. Key Constraints & Optional Constraints

### Hard constraints

These are enforced by the CP-SAT model and cannot be violated by any solution it returns.

| Constraint | Behaviour | Reference |
|---|---|---|
| One project per student | Each student's assignment booleans sum to exactly 1. | <sup>[15]</sup> |
| Team size bounds | Every project's headcount must be between `min_team_size` and `max_team_size`, unconditionally — no deactivation, no overflow. | <sup>[16]</sup> |
| Day matching | A student may not be assigned to a project whose meeting day differs from theirs — enforced whenever both sides have a day set, which is now always. | <sup>[18]</sup> |
| Returning students must be 3200 | Validated before solving; a `previousProject` on a non-3200 student raises an exception that aborts the whole run. | <sup>[17]</sup> |

If no assignment can satisfy all of the above simultaneously, the model is infeasible and the endpoint returns a
400 describing the failure — there is no fallback path.

### Soft constraints

These are objective terms. The solver trades them against each other, and any of them can be sacrificed if the
overall score improves.

| Term | Weight | Reference |
|---|---|---|
| Choice rank (all students) | 1000 / 500 / 200 / 100 / 50 / 25 for choices 1–6 | <sup>[19]</sup> |
| 3200 multiplier | ×100 on the rank-based score, if `prioritize_3200_first_choice` | <sup>[20]</sup> |
| Returning to previous project | ×1.5 on the rank-based score, if `prioritize_returning_students` and the project is still a current choice | <sup>[21]</sup> |
| Major fit | +80 on "Both"-type projects, +60 for a software-track major on a software project or hardware-track major on a hardware project — always applied | <sup>[22]</sup> |
| Gender isolation | −500 per team with exactly one male or exactly one female, if `balance_gender` | <sup>[23]</sup> |

### Configuration surface

`min_team_size`, `max_team_size`, `prioritize_returning_students`, `prioritize_3200_first_choice`,
`balance_gender`.<sup>[36]</sup> Everything else that previously existed here — overflow, project deactivation,
skills matching, preferred-majors matching, and the 2200-early-choices curve — has been removed outright, not just
hidden from the UI.

---

## 3. Edge Case Handling

**A student's preferences point at inactive projects.** Choices are filtered against the active project list
during translation.<sup>[6]</sup> A preference for a project with no team this semester is dropped without
comment. If every preference is dropped, the student enters the solver with an empty choice list.

**A student has no usable preferences at all.** Such a student contributes zero to the objective no matter where
they are placed. Post-processing explicitly re-places them into the smallest teams that have room, with a bias
toward major similarity.<sup>[28]</sup><sup>[29]</sup><sup>[30]</sup>

**There are more students than seats, or fewer.** Both are now the same kind of failure: if no assignment exists
that keeps every project's headcount within `[min_team_size, max_team_size]`, the model is infeasible and the
endpoint returns a 400 with a message naming the constraint and suggesting the caller adjust team size bounds or
the active project set.<sup>[26]</sup>

**A team ends up below minimum after post-processing.** The no-choice pass avoids draining teams that are at
minimum,<sup>[31]</sup> and the minimum-size gate catches anything that still slips through before any database
write occurs.<sup>[33]</sup>

**No students or no projects.** Both are checked before any solving and produce a 400 with a specific
message.<sup>[5]</sup>

**Missing Python or missing script.** The wrapper tries four candidate paths for `team_generator.py` and throws a
descriptive error listing all of them if none exist.<sup>[8]</sup> A missing `ortools` package, or a crash inside
Python, surfaces as a rejected promise carrying the process's stderr, which `generate.post.ts` converts into a
400.<sup>[13]</sup>

**Repeat invocation.** Generation deletes existing non-mentor memberships for this semester/day's teams before
inserting the new set, atomically.<sup>[34]</sup> Generating twice for the same semester and day replaces the
roster rather than duplicating it; mentor memberships are never affected.

**Partial configuration objects.** Because defaults are only substituted when config is entirely
absent,<sup>[12]</sup> and the Python side subscripts `config['min_team_size']`/`config['max_team_size']`
directly,<sup>[16]</sup> a direct API caller sending only some keys triggers a `KeyError`, surfaced as a 400 via
the same try/catch.<sup>[13]</sup> The UI itself always sends a complete config, so this only affects callers that
bypass it.

**Multiple enrollments in one semester.** The mapping reads `Enrollments[0]` for major, year, class, and
day.<sup>[7]</sup> If a student somehow holds two enrollments for the same semester, which one wins is arbitrary.

**Returning-student detection tie-breaking.** The prior-semester membership lookup keeps whichever row it
encounters last when two memberships tie for the same semester rank. Now that repeat generation replaces rather
than duplicates a semester/day's memberships, this should only matter for pre-existing data created before that
fix, or for hand-created memberships outside the generation flow.

---

## 4. Potential Malassignments

A "malassignment" here means a student placed on a project that appears nowhere in their ranked preferences, or so
far down their list that the placement is effectively arbitrary.

**1. Students with no valid preferences.** The largest remaining category. A student who submitted no choices, or
whose choices all pointed at projects not activated this semester,<sup>[6]</sup> scores identically on every
project — the objective is indifferent to where they go. The solver places them wherever helps satisfy team-size
constraints, and post-processing then moves them again toward whichever teams are thinnest, choosing at random
among the three smallest.<sup>[29]</sup><sup>[30]</sup> The count is reported back as
`notes.noChoiceStudentsReassigned`.<sup>[35]</sup>

**2. Projects outside the choice list score zero, not negative.** The entire preference-scoring block only
applies when the project appears in the student's choices;<sup>[19]</sup> a project the student never listed
contributes exactly 0. Since every student now shares the same plain rank curve (no negative-scoring 2200 curve
exists anymore), an unrequested project scoring 0 is simply neutral, not actively preferred over a low-ranked
choice the way it previously was for 2200 students under the old curve.

**3. Low-ranked choices under capacity pressure.** Nothing *forbids* a fourth, fifth, or sixth choice on the
CP-SAT path — those are lower scores, not hard constraints. If every better option is full and no zero-scoring
alternative resolves the size constraints, the solver will accept the lower score. A 3200 student is guaranteed
only a positive score, not a high-ranked one.

Two routes present in earlier versions of this document no longer apply: rebalancing-by-borrowing (removed
entirely, since CP-SAT now hard-enforces team size directly) and the greedy fallback's later phases (the greedy
solver has been removed — infeasibility now fails the request outright rather than silently producing a
lower-quality assignment).

### Summary of exposure

| Route | Preference respected? | Detectable from the API response? |
|---|---|---|
| Empty choice list | No preference exists | Yes — `notes.noChoiceStudentsReassigned` |
| Unlisted project scores 0 | No | No |
| Low-ranked choice accepted | Yes, weakly | No |

---

## Code References

| # | Location | What it covers |
|---|---|---|
| 1 | `server/api/team-formation/generate.post.ts:44-51` | Handler entry, request body, team-size defaults |
| 2 | `server/api/team-formation/generate.post.ts:53-59` | Semester id and meeting day validation |
| 3 | `server/api/team-formation/generate.post.ts:71-81` | Student query (non-mentor, semester, day) |
| 4 | `server/api/team-formation/generate.post.ts:84-97` | Active project derivation from existing teams, project-day map |
| 5 | `server/api/team-formation/generate.post.ts:99-104` | Empty-student and empty-project guards |
| 6 | `server/api/team-formation/generate.post.ts:106-117` | Choice ranking, name mapping, active-project filter |
| 7 | `server/api/team-formation/generate.post.ts:119-189` | Enum remapping and CP-SAT wire-type construction (`mapYear`/`mapProjectType`/`mapGender`/`remapClass`/`remapDay`) |
| 7a | `server/api/team-formation/generate.post.ts:124-151` | Prior-semester membership lookup and `previousProject` derivation |
| 8 | `server/services/CPSAT/ortools.ts:74-84` | Python script path resolution |
| 9 | `server/services/CPSAT/ortools.ts:137-142` | Exit-code check before JSON parsing |
| 10 | `server/services/CPSAT/ortools.ts:144-151` | Result-success check and rejection |
| 11 | `server/services/CPSAT/ortools.ts:157-165` | Student id → student object rehydration |
| 12 | `server/services/CPSAT/ortools.ts:105-112` | Default configuration substitution |
| 13 | `server/api/team-formation/generate.post.ts:191-197` | try/catch around the solver call, converted to a 400 |
| 14 | `server/services/CPSAT/team_generator.py:72-77` | Assignment decision variables |
| 15 | `server/services/CPSAT/team_generator.py:79-81` | Constraint 1: exactly one project per student |
| 16 | `server/services/CPSAT/team_generator.py:83-87` | Constraint 2: unconditional team size bounds |
| 17 | `server/services/CPSAT/team_generator.py:89-94` | Constraint 3: returning students must be 3200 |
| 18 | `server/services/CPSAT/team_generator.py:96-106` | Constraint 4: meeting-day matching |
| 19 | `server/services/CPSAT/team_generator.py:111-135` | Base preference scores by rank (all students) |
| 20 | `server/services/CPSAT/team_generator.py:137-139` | 3200 student 100× multiplier |
| 21 | `server/services/CPSAT/team_generator.py:141-144` | Returning-student ×1.5 multiplier |
| 22 | `server/services/CPSAT/team_generator.py:188-212` | Major-fit bonus based on project type |
| 23 | `server/services/CPSAT/team_generator.py:148-186` | Gender balance block |
| 24 | `server/services/CPSAT/team_generator.py:217-221` | Objective maximization and 30s time limit |
| 25 | `server/services/CPSAT/team_generator.py:225-241` | Solution extraction and success payload |
| 26 | `server/services/CPSAT/team_generator.py:242-250` | Infeasibility → clean error payload (no fallback) |
| 27 | `server/api/team-formation/generate.post.ts:199-213` | Project-name → id remapping of solver output |
| 28 | `server/api/team-formation/generate.post.ts:217-219` | No-choice cohort identification |
| 29 | `server/api/team-formation/generate.post.ts:220-259` | Candidate team filtering and ranking |
| 30 | `server/api/team-formation/generate.post.ts:261-264` | Random selection among top three candidates |
| 31 | `server/api/team-formation/generate.post.ts:266-284` | Source-team removal guards and commit |
| 32 | `server/api/team-formation/generate.post.ts:287-298` | Commit of the move and census update |
| 33 | `server/api/team-formation/generate.post.ts:302-314` | Minimum-size gate |
| 34 | `server/api/team-formation/generate.post.ts:316-330` | Transactional delete-then-insert of non-mentor memberships |
| 35 | `server/api/team-formation/generate.post.ts:332-353` | Response assembly (`teamAssignments`, `teamMeta`, `notes`) |
| 36 | `server/services/CPSAT/ortools.ts:37-43` | `CPSATConfig` — the current configuration surface |
