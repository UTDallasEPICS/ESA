# Team Generation Algorithm

This document describes how ESA turns a semester's students, their ranked project preferences, and the set of
active projects into concrete team assignments. It covers the three stages of the pipeline, the constraints the
solver enforces, the edge cases that are handled explicitly, and the situations in which a student can end up on a
project they never asked for.

Superscript numbers throughout the document refer to specific code locations. The full mapping is in
[Code References](#code-references) at the end.

---

## 1. Algorithm

Team generation is triggered by a single endpoint, `POST /api/team-formation/generate`, which accepts a semester
id, an optional meeting day, and an optional solver configuration object.<sup>[1]</sup> The endpoint rejects a
request with no semester id, and rejects a meeting day that is not `WEDNESDAY` or `THURSDAY`.<sup>[2]</sup>

The pipeline has three stages, executed in order:

1. **CP-SAT solver** (Python, via OR-Tools) — the primary optimizer. It formulates the whole assignment problem
   as a constraint model and maximizes a satisfaction score.
2. **Greedy solver** (Python) — a fallback that runs *only* when the CP-SAT model turns out to be infeasible or
   the solver times out without any solution.
3. **Post-processing** (TypeScript) — a set of heuristic repairs applied to whichever solution came back, run
   unconditionally before anything is written to the database.

### Data gathering

Before any solving happens, the endpoint assembles the problem.

**Students.** It loads every non-mentor student who has an enrollment in the requested semester and meeting
day, pulling in that semester's ranked choices and enrollment record alongside each student.<sup>[3]</sup> Mentors
are excluded entirely — they are never assigned by this algorithm.

**Projects.** The set of candidate projects is *not* every project in the database. It is derived from the `Team`
rows that already exist for the requested semester and day: each such team points at a project, and that project
becomes a candidate.<sup>[4]</sup> In other words, a project only participates in team generation if an
administrator has already activated it for that semester by creating its team. If either the student list or the
project list comes back empty, the request fails with a 400 and an explanatory message.<sup>[5]</sup>

**Preference translation.** The solver identifies projects by *name*, not by database id, so each student's
`Choice` rows are sorted by rank, converted to project names, and — critically — filtered down to only those names
that correspond to a currently active project.<sup>[6]</sup> A preference for a project that was not activated this
semester silently disappears at this step. A student whose entire preference list is filtered away ends up with an
empty choice list, which has significant downstream consequences (see [§3](#3-edge-case-handling) and
[§4](#4-potential-malassignments)).

**Enum translation.** The Prisma enums are remapped into the spellings the Python script expects: `FRESHMAN` →
`Freshman`, `SOFTWARE` → `SW`, `EPCS_2200` → `2200` (everything else → `3200`), `WEDNESDAY` → `Wednesday`, and so
on.<sup>[7]</sup> Each student's enrollment fields are read from the *first* enrollment record returned for that
semester.

**Process invocation.** The wrapper locates `team_generator.py` by trying four candidate paths in order and
throwing if none exist,<sup>[8]</sup> then spawns a `python` child process, writes the problem as JSON to its
stdin, and reads the result as JSON from its stdout.<sup>[10]</sup> A non-zero exit code, or a result whose
`success` flag is false, rejects the promise and surfaces as a 500 to the caller.<sup>[11]</sup> On success the
solver's list of student ids per project is rehydrated back into full student objects.<sup>[12]</sup>

One detail of the wrapper matters a great deal: the default configuration block is substituted **only when the
caller supplies no configuration at all**.<sup>[9]</sup> A partially specified configuration is forwarded verbatim,
and the Python side reads several keys with direct subscripting rather than `.get()` — so a partial config that
omits `min_team_size` or `max_team_size` raises a `KeyError` and fails the entire run.

---

### 1.1. CP-SAT Solver

The CP-SAT stage builds an integer program and asks OR-Tools to maximize a weighted satisfaction score.

**Decision variables.** For every (student, project) pair there is one boolean variable that is 1 if that student
is assigned to that project.<sup>[14]</sup> With *S* students and *P* projects the model has *S × P* booleans, plus
a small number of auxiliary variables per project.

**Structural constraints.** Every student is assigned to exactly one project — the sum of a student's booleans
across all projects is forced to 1.<sup>[15]</sup> There is no "unassigned" option in the model.

Each project additionally gets an `active` boolean and an `overflow` integer variable.<sup>[16]</sup> When a
project is active, its headcount must fall between `min_team_size` and `max_team_size` plus whatever overflow it
was granted. When a project is inactive, its headcount is forced to zero and its overflow to zero. This is the
mechanism that lets the solver **drop a project entirely** rather than dragging unwilling students onto an
unpopular one.

**Overflow.** Before building the model, the script computes the total base capacity as
`projects × max_team_size` and, if there are more students than seats, records the shortfall as
`required_overflow`.<sup>[17]</sup> Overflow is only enabled when it is both permitted by configuration and
actually necessary. Each active team may exceed its maximum by at most `overflow_per_team`, and the sum of all
overflow across all teams is capped at exactly the computed shortfall<sup>[18]</sup> — so the solver can never
hand out more extra seats than the arithmetic demands.

**Placeholder constraints.** Two blocks in the script, labelled "3200 students prefer first choice" and "prefer
top choices", contain no logic at all — they are `pass` statements with comments explaining that the behaviour is
implemented through objective scoring instead of hard constraints.<sup>[19]</sup> They do nothing at runtime.

**Objective function.** The score is a sum of per-assignment terms. For each (student, project) pair where the
project appears in the student's choice list, a base score is assigned by rank: 1000 for first choice, 500 for
second, 200 for third, 100 for fourth, 50 for fifth, 25 for sixth, and 0 beyond that.<sup>[22]</sup>

That base score is then rewritten depending on the student's class:

- **EPCS 3200 students** get a flat 100× multiplier applied to whatever their rank-based score
  was.<sup>[23]</sup> This makes upper-class preferences dominate the objective; a 3200 student's third choice
  (20 000) still outweighs a 2200 student's first choice.
- **EPCS 2200 students** have their score replaced entirely by a much steeper curve: 5000, 3000, and 1500 for
  their first three choices, then −20 000, −100 000, and −500 000 for their fourth, fifth, and sixth.<sup>[24]</sup>
  The negative values mean the solver is *actively penalized* for giving an underclassman a low-ranked choice —
  in practice it will do almost anything else first.

Three optional bonuses are layered on top: a very large bonus for returning a student to their previous
project,<sup>[25]</sup> a small bonus per matching skill,<sup>[26]</sup> and a major-fit bonus of 100 for an
explicitly preferred major, 80 for any student on a "Both"-type project, or 60 for a software major on a software
project or a hardware major on a hardware project.<sup>[29]</sup>

Two structural terms complete the objective: a reward of 5000 for each project kept active,<sup>[30]</sup> which
biases the solver toward running as many projects as possible, and a penalty (20 000 by default) for each overflow
seat consumed.<sup>[31]</sup>

**Gender balance.** When enabled, the model counts male and female students per team and applies a −500 penalty
whenever exactly one student of either gender is on a team, using reified booleans to detect the isolated
case.<sup>[27]</sup>

This block has two consequences worth stating plainly. First, the ESA endpoint never populates a `gender` field
on the students it sends,<sup>[7]</sup> even though `Enrollment` stores one — so every student defaults to
"Prefer not to say", both counts are always zero, and the isolation penalty never fires. Second, and more
seriously, the block declares a team-size variable whose *domain* is `[min_team_size, max_team_size]` and then
constrains it, unconditionally, to equal the team's headcount.<sup>[28]</sup> Because this is not gated on the
project's `active` flag, it silently forces **every** project to have between `min` and `max` students — which
directly contradicts the deactivation rule (headcount 0) and the overflow rule (headcount above max). With gender
balancing left at its default of enabled, project deactivation and overflow are effectively unreachable, and the
model is only feasible when the student count happens to fall between `projects × min` and `projects × max`.

**Solving.** The model is maximized with a 30-second wall-clock limit.<sup>[32]</sup> If the solver returns an
optimal or merely feasible solution, the assignment is read out, deactivated projects are recorded, overflow usage
is summarized into a warning string, and empty teams are stripped from the result.<sup>[33]</sup> If the solver
returns anything else — infeasible, or no solution found within the time limit — control passes to the greedy
fallback.<sup>[34]</sup>

---

### 1.2. Greedy Solver

The greedy solver is a deterministic heuristic with no optimization guarantees. It exists purely so that an
infeasible CP-SAT model still produces *something* rather than an error.

Students are sorted so that EPCS 3200 students come first, and within each class, students with more ranked
choices come before students with fewer.<sup>[35]</sup> The intent is to serve upper-class students first and to
handle the most constrained students while options remain open.

Assignment then proceeds in three phases:

**Phase 1 — top choices.** Each student is offered their first three choices in rank order. They are placed on the
first of those that is below `max_team_size` and whose meeting day is compatible.<sup>[36]</sup> Choices four
through six are never consulted by the greedy path.

**Phase 2 — any opening.** A student who could not be placed in Phase 1 is walked through the project list in
arbitrary order and dropped onto the first project with a free seat and a compatible day.<sup>[37]</sup>
Preference plays no part here.

**Phase 3 — forced placement.** Any student still unassigned is placed on the least-filled project that has room.
If every project is full, the student is force-appended to the *largest* team, deliberately exceeding
`max_team_size`.<sup>[38]</sup>

**Final pruning.** After all students are placed, any team that ended up below `min_team_size` is removed from the
output and reported as deactivated.<sup>[39]</sup> The students who were on those teams are **not** reassigned —
they are simply dropped from the returned mapping, and because nothing downstream detects this, they end up with
no team and no membership record at all.

---

### 1.3. Post Processing

Post-processing runs in TypeScript on whatever the Python stage returned, and always runs — there is no path that
writes the solver's output straight to the database.

**Remapping.** The solver's project-name keys are converted back to project ids, and its student objects are
matched back to the full Prisma student records. Every active project is seeded with an empty array first, so
projects the solver deactivated are represented as empty teams rather than being missing.<sup>[40]</sup>

**Step 1 — placing students with no valid choices.** The endpoint collects every student whose remapped choice
list was empty<sup>[41]</sup> and takes a census of current team sizes and per-team major distributions. Each such
student is then considered individually. Candidate destinations are teams that are non-empty (so the pass never
resurrects a project the solver deliberately dropped) and below `max_team_size`, sorted smallest-first, with ties
broken in favour of the team that already holds the most students of the same major.<sup>[42]</sup> One of the
top three candidates is then chosen **at random**,<sup>[43]</sup> which spreads these students out instead of
piling them all onto the single smallest team — and which also makes the endpoint non-deterministic across runs
on identical input.

The move is guarded on the source side. The student's current team is located; the move is abandoned if the
student is already on the chosen team, and abandoned if their current team is at or below `min_team_size`, so this
pass can never push a compliant team below minimum.<sup>[44]</sup> Only when a student was successfully removed
from a source team are they appended to the destination and the size census updated.<sup>[45]</sup> Note that the
major census is *not* updated as students move, so the major tiebreak works from increasingly stale data as the
pass proceeds.

**Step 2 — rebalancing undersized teams.** A repair loop then repeatedly finds every non-empty team below
`min_team_size`, smallest first, and for each one borrows students from the largest team that is strictly above
`min_team_size`.<sup>[46]</sup> The borrowed student is whoever happens to be last in the donor team's array —
there is no consideration of preference, major, class, or anything else. The loop terminates because each move
strictly reduces the total shortfall and a donor is only eligible while it remains above minimum. The number of
moves is counted and returned to the caller for visibility.

**Step 3 — the minimum-size gate.** After rebalancing, any team that is still non-empty and still below
`min_team_size` causes the request to fail with a 400 listing the offending projects and their
sizes.<sup>[47]</sup> Empty teams are exempt: a fully deactivated project is an acceptable outcome, a half-filled
one is not. Because this check runs before any write, a failed generation leaves the database untouched.

**Step 4 — persistence and response.** Assignments are flattened into `Membership` rows and inserted in a single
`createMany`.<sup>[48]</sup> The endpoint returns the assignments keyed by team id, the project list, per-team
metadata, and a `fallback` summary containing the solver warning, the list of deactivated projects, the number of
no-choice students reprocessed, and the rebalance move count.<sup>[49]</sup>

This step has no idempotency protection. Running generation twice for the same semester and day inserts a second
complete set of memberships rather than replacing the first.

---

## 2. Key Constraints & Optional Constraints

### Hard constraints

These are enforced by the CP-SAT model and cannot be violated by any solution it returns.

| Constraint | Behaviour | Reference |
|---|---|---|
| One project per student | Each student's assignment booleans sum to exactly 1. There is no way for the model to leave a student unplaced. | <sup>[15]</sup> |
| Active team size bounds | An active project's headcount must be at least `min_team_size` and at most `max_team_size` plus its granted overflow. | <sup>[16]</sup> |
| Inactive teams are empty | A project marked inactive must have exactly zero students and zero overflow. | <sup>[16]</sup> |
| Global overflow cap | Total overflow seats across all projects cannot exceed the computed student-count shortfall. | <sup>[18]</sup> |
| Day matching | A student may not be assigned to a project whose meeting day differs from theirs — but only when *both* sides have a day set. | <sup>[21]</sup> |
| Returning students must be 3200 | Validated before solving; a `previousProject` on a non-3200 student raises an exception that aborts the whole run. | <sup>[20]</sup> |
| Team size must be within bounds (unintended) | The gender-balance block imposes an ungated `min ≤ headcount ≤ max` on every project, overriding both deactivation and overflow whenever gender balancing is enabled. | <sup>[28]</sup> |

Two of these are worth qualifying. The day constraint is **inert in the current integration**, because the
endpoint never sends a `day` field on projects<sup>[7]</sup> — so `project_day` is always absent and the constraint
is skipped for every pair. In practice, day separation is achieved earlier, by only loading students and teams
matching the requested day.<sup>[3]</sup><sup>[4]</sup> The returning-student rule is likewise never exercised,
since `previousProject` is never populated by the endpoint.

### Soft constraints

These are objective terms. The solver trades them against each other, and any of them can be sacrificed if the
overall score improves.

| Term | Weight | Reference |
|---|---|---|
| Choice rank, 3200 students | 100 000 / 50 000 / 20 000 / 10 000 / 5000 / 2500 for choices 1–6 | <sup>[22]</sup><sup>[23]</sup> |
| Choice rank, 2200 students | 5000 / 3000 / 1500 for choices 1–3; −20 000 / −100 000 / −500 000 for choices 4–6 | <sup>[24]</sup> |
| Returning to previous project | +500 000 | <sup>[25]</sup> |
| Skill match | +50 per matching skill | <sup>[26]</sup> |
| Gender isolation | −500 per team with exactly one male or exactly one female | <sup>[27]</sup> |
| Major fit | +100 preferred major, +80 on "Both" projects, +60 for adjacent major/type | <sup>[29]</sup> |
| Keeping a project active | +5000 per active project | <sup>[30]</sup> |
| Overflow seat used | −20 000 per seat (configurable) | <sup>[31]</sup> |

### Configuration toggles

Every soft behaviour is switchable through the `config` object forwarded from the request
body:<sup>[1]</sup><sup>[9]</sup> `min_team_size`, `max_team_size`, `allow_overflow_if_needed`,
`overflow_per_team`, `overflow_penalty`, `prioritize_returning_students`, `prioritize_3200_first_choice`,
`prefer_major_diversity`, `match_skills`, `balance_gender`, and `prefer_2200_early_choices`.

### Constraints that are currently dead

Several optional constraints are wired up in the solver but receive no data from ESA, because the endpoint's
student and project mapping omits the corresponding fields:<sup>[7]</sup>

- **Skills matching** — neither student skills nor project required-skills are sent, so the bonus never applies.
- **Gender balance** — gender is stored on `Enrollment` but never forwarded, so the penalty never applies (while
  the block's unintended size constraint still takes effect).
- **Returning students** — `previousProject` is never sent, so both the bonus and its validation are inert.
- **Preferred majors** — projects carry no `preferredMajors`, so major fit falls back entirely to the coarser
  project-type heuristic.

---

## 3. Edge Case Handling

**A student's preferences point at inactive projects.** Choices are filtered against the active project list
during translation.<sup>[6]</sup> A preference for a project with no team this semester is dropped without
comment. If every preference is dropped, the student enters the solver with an empty choice list.

**A student has no usable preferences at all.** Such a student contributes zero to the objective no matter where
they are placed, so the solver positions them purely by whatever other terms apply. Post-processing then
explicitly re-places them into the smallest teams that have room, with a bias toward major
similarity.<sup>[41]</sup><sup>[42]</sup><sup>[43]</sup>

**A project is unpopular.** Rather than force students onto it, the model can mark the project inactive and give
it zero students.<sup>[16]</sup> The +5000 activity reward means this only happens when deactivation buys more
than it costs — roughly, when it rescues several students from low-ranked assignments. Deactivated projects are
reported back to the caller in the response's `deactivatedProjects` field.<sup>[49]</sup>

**There are more students than seats.** The shortfall is computed up front and a bounded number of overflow seats
is unlocked, capped globally at exactly what is needed and penalized heavily so the solver spreads the excess
rather than concentrating it.<sup>[17]</sup><sup>[18]</sup><sup>[31]</sup>

**The model is infeasible or times out.** Instead of erroring, the script silently falls through to the greedy
heuristic.<sup>[34]</sup> The response's status becomes `greedy_fallback` and a warning is attached, but the API
still returns a 200 — the caller must inspect the `fallback` block to know that the optimizer never actually
succeeded.

**A team ends up below minimum.** Two successive repairs apply: the no-choice pass avoids draining teams that are
at minimum,<sup>[44]</sup> and the rebalance loop borrows from oversized teams until every non-empty team is at
minimum or no donor remains.<sup>[46]</sup> If a team is still short after both, the request fails with a 400
naming the team and its size, before any database write occurs.<sup>[47]</sup>

**Empty teams.** Teams with zero students are explicitly excluded from the minimum-size check<sup>[47]</sup> and
from the no-choice pass's candidate list.<sup>[42]</sup> The design treats "this project did not run" as a valid
outcome and "this project ran with two people" as an error.

**No students or no projects.** Both are checked before any solving and produce a 400 with a specific
message.<sup>[5]</sup>

**Missing Python or missing script.** The wrapper tries four candidate paths for `team_generator.py` and throws a
descriptive error listing all of them if none exist.<sup>[8]</sup> A missing `ortools` package, or a crash inside
Python, surfaces as a rejected promise carrying the process's stderr.<sup>[11]</sup>

### Edge cases that are *not* handled

**Omitted meeting day.** The `day` parameter is optional, and when it is absent both the student query and the
team query drop the day filter, pulling in Wednesday and Thursday together.<sup>[3]</sup><sup>[4]</sup> Since
project days are never sent to the solver, the day-matching constraint cannot separate them,<sup>[21]</sup> so a
Thursday student can be assigned to a Wednesday project. The response metadata also asserts a non-null day that
does not exist in this case.<sup>[49]</sup>

**Students dropped by the greedy fallback.** Students on sub-minimum teams are discarded from the greedy result
without reassignment.<sup>[39]</sup> Nothing downstream reconciles the returned assignment against the input
roster, so these students receive no membership and no error is raised.

**Repeat invocation.** Memberships are inserted, never reconciled.<sup>[48]</sup> Generating twice for the same
semester and day duplicates every membership row.

**Partial configuration objects.** Because defaults are only substituted when config is entirely
absent,<sup>[9]</sup> and the Python side subscripts `config['min_team_size']` and `config['max_team_size']`
directly,<sup>[16]</sup><sup>[27]</sup> a caller sending only some keys triggers a `KeyError` and a failed run.

**Multiple enrollments in one semester.** The mapping reads `Enrollments[0]` for major, year, class, and
day.<sup>[7]</sup> If a student somehow holds two enrollments for the same semester, which one wins is arbitrary.

**Overflow is never re-validated.** Post-processing checks only the *lower* bound on team size.<sup>[47]</sup>
Teams above `max_team_size`, whether from sanctioned overflow or from the greedy solver's forced placement,
<sup>[38]</sup> pass through unchallenged.

---

## 4. Potential Malassignments

A "malassignment" here means a student placed on a project that appears nowhere in their ranked preferences, or so
far down their list that the placement is effectively arbitrary. There are six distinct routes to this outcome.

**1. Students with no valid preferences.** This is the largest category. A student who submitted no choices, or
whose choices all pointed at projects not activated this semester,<sup>[6]</sup> scores identically on every
project — the objective is completely indifferent to where they go. The solver places them wherever they help
satisfy team-size constraints, and post-processing then moves them again toward whichever teams are thinnest,
choosing at random among the three smallest.<sup>[42]</sup><sup>[43]</sup> Nothing in either step consults a
preference, because there is none to consult. The count of students handled this way is reported back as
`noChoiceStudentsReassigned`.<sup>[49]</sup>

**2. Projects outside the choice list score zero, not negative.** The entire preference-scoring block is nested
inside a check that the project appears in the student's choices.<sup>[22]</sup> A project the student never
listed therefore contributes exactly 0. For a 2200 student, this is *better* than their own fourth choice
(−20 000) and vastly better than their sixth (−500 000). When capacity forces a compromise, the objective will
prefer to assign an underclassman to a project they never heard of over their own low-ranked choice — which is
arguably intentional as a way of avoiding actively-unwanted assignments, but does mean a completely unrequested
project is a normal, expected outcome rather than a last resort.

**3. Rebalancing moves ignore preferences entirely.** When the repair loop needs a body to lift an undersized team
to minimum, it pops the last student off the largest donor team and pushes them onto the target.<sup>[46]</sup>
There is no preference check, no major check, no class check — the selection is purely an artifact of array
ordering. A student who received their genuine first choice from the solver can be relocated to an unrelated
project by this pass. The number of such moves is surfaced as `rebalancedMoveCount`,<sup>[49]</sup> which is the
only signal the caller gets that this happened.

**4. The greedy fallback's later phases.** Phase 1 consults only a student's top three choices; Phase 2 assigns to
the first project with an open seat in arbitrary list order; Phase 3 force-appends to the least-filled or, failing
that, the largest team.<sup>[36]</sup><sup>[37]</sup><sup>[38]</sup> Any student reaching Phase 2 or 3 gets a
project chosen without reference to their preferences at all. Because the fallback triggers silently on
infeasibility,<sup>[34]</sup> and because the gender-balance size constraint makes infeasibility much more likely
than intended,<sup>[28]</sup> this path may be reached more often than the design anticipates.

**5. Low-ranked choices under capacity pressure.** Even on the CP-SAT path, nothing *forbids* a fourth, fifth, or
sixth choice — those are steep penalties, not hard constraints.<sup>[24]</sup> If every better option is full or
deactivated and no zero-scoring alternative resolves the size constraints, the solver will accept the penalty.
Likewise, a 3200 student is guaranteed only a positive score, not a high-ranked one.<sup>[23]</sup>

**6. Cross-day assignment when no day is specified.** As described in [§3](#3-edge-case-handling), omitting the
`day` parameter merges both cohorts with no constraint separating them, so a student can be assigned to a project
that meets on a day they cannot attend — a malassignment on a dimension preferences do not even
model.<sup>[3]</sup><sup>[4]</sup><sup>[21]</sup>

### Summary of exposure

| Route | Preference respected? | Detectable from the API response? |
|---|---|---|
| Empty choice list | No preference exists | Yes — `noChoiceStudentsReassigned` |
| Unlisted project scores 0 | No | No |
| Rebalance borrowing | No | Partially — `rebalancedMoveCount` (count only) |
| Greedy Phase 2 / 3 | No | Partially — `solverWarning` indicates fallback ran |
| Low-ranked choice accepted | Yes, weakly | No |
| Cross-day assignment | Not applicable | No |

The overall picture is that the CP-SAT stage optimizes preferences carefully, and then two later stages —
post-processing repair and the greedy fallback — can undo that work without any scoring model of their own. Both
of those stages operate outside the objective function entirely, so a placement they produce carries no guarantee
of quality beyond satisfying team-size arithmetic.

---

## Code References

| # | Location | What it covers |
|---|---|---|
| 1 | `server/api/team-formation/generate.post.ts:35-42` | Handler entry, request body, team-size defaults |
| 2 | `server/api/team-formation/generate.post.ts:44-50` | Semester id and meeting day validation |
| 3 | `server/api/team-formation/generate.post.ts:63-72` | Student query (non-mentor, semester, day) |
| 4 | `server/api/team-formation/generate.post.ts:76-85` | Active project derivation from existing teams |
| 5 | `server/api/team-formation/generate.post.ts:87-92` | Empty-student and empty-project guards |
| 6 | `server/api/team-formation/generate.post.ts:94-105` | Choice ranking, name mapping, active-project filter |
| 7 | `server/api/team-formation/generate.post.ts:107-133` | Enum remapping and CP-SAT wire-type construction |
| 8 | `server/services/CPSAT/ortools.ts:85-95` | Python script path resolution |
| 9 | `server/services/CPSAT/ortools.ts:119-131` | Default configuration substitution |
| 10 | `server/services/CPSAT/ortools.ts:136-209` | Process spawn, stdin/stdout handling |
| 11 | `server/services/CPSAT/ortools.ts:157-171` | Exit-code and failure handling |
| 12 | `server/services/CPSAT/ortools.ts:184-191` | Student id → student object rehydration |
| 13 | `server/services/CPSAT/team_generator.py:41-47` | Model creation and index building |
| 14 | `server/services/CPSAT/team_generator.py:58-62` | Assignment decision variables |
| 15 | `server/services/CPSAT/team_generator.py:65-66` | Constraint 1: exactly one project per student |
| 16 | `server/services/CPSAT/team_generator.py:71-89` | Constraint 2: active/inactive projects, size bounds |
| 17 | `server/services/CPSAT/team_generator.py:49-55` | Capacity and required-overflow computation |
| 18 | `server/services/CPSAT/team_generator.py:91-94` | Global overflow cap |
| 19 | `server/services/CPSAT/team_generator.py:96-113` | Constraints 3 and 4 (no-op placeholders) |
| 20 | `server/services/CPSAT/team_generator.py:115-120` | Constraint 5: returning students must be 3200 |
| 21 | `server/services/CPSAT/team_generator.py:122-132` | Constraint 6: meeting-day matching |
| 22 | `server/services/CPSAT/team_generator.py:137-161` | Base preference scores by rank |
| 23 | `server/services/CPSAT/team_generator.py:163-166` | 3200 student 100× multiplier |
| 24 | `server/services/CPSAT/team_generator.py:167-181` | 2200 student boost/penalty curve |
| 25 | `server/services/CPSAT/team_generator.py:186-188` | Returning-student bonus |
| 26 | `server/services/CPSAT/team_generator.py:190-198` | Skill-matching bonus |
| 27 | `server/services/CPSAT/team_generator.py:202-246` | Gender balance block |
| 28 | `server/services/CPSAT/team_generator.py:230-231` | Ungated team-size variable and its bounds |
| 29 | `server/services/CPSAT/team_generator.py:248-277` | Major diversity / project-type fit bonus |
| 30 | `server/services/CPSAT/team_generator.py:279-283` | Project-activity reward |
| 31 | `server/services/CPSAT/team_generator.py:285-288` | Overflow penalty |
| 32 | `server/services/CPSAT/team_generator.py:291-299` | Objective maximization and 30s time limit |
| 33 | `server/services/CPSAT/team_generator.py:301-334` | Solution extraction and result payload |
| 34 | `server/services/CPSAT/team_generator.py:335-337` | Fallback trigger on infeasibility |
| 35 | `server/services/CPSAT/team_generator.py:353-374` | Greedy config defaults and student ordering |
| 36 | `server/services/CPSAT/team_generator.py:376-395` | Greedy Phase 1: top three choices |
| 37 | `server/services/CPSAT/team_generator.py:397-407` | Greedy Phase 2: any available project |
| 38 | `server/services/CPSAT/team_generator.py:409-424` | Greedy Phase 3: forced placement |
| 39 | `server/services/CPSAT/team_generator.py:426-443` | Sub-minimum team pruning and student loss |
| 40 | `server/api/team-formation/generate.post.ts:143-156` | Project-name → id remapping of solver output |
| 41 | `server/api/team-formation/generate.post.ts:160-178` | No-choice cohort identification and team census |
| 42 | `server/api/team-formation/generate.post.ts:183-202` | Candidate team filtering and ranking |
| 43 | `server/api/team-formation/generate.post.ts:204-207` | Random selection among top three candidates |
| 44 | `server/api/team-formation/generate.post.ts:209-228` | Source-team removal guards |
| 45 | `server/api/team-formation/generate.post.ts:231-240` | Commit of the move and census update |
| 46 | `server/api/team-formation/generate.post.ts:247-284` | Undersized-team rebalancing loop |
| 47 | `server/api/team-formation/generate.post.ts:286-298` | Final minimum-size gate |
| 48 | `server/api/team-formation/generate.post.ts:300-309` | Membership persistence |
| 49 | `server/api/team-formation/generate.post.ts:311-335` | Response assembly and fallback diagnostics |