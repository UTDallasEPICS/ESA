# Requirements

This is the single source of truth for what your hardware project must do. Capture every
requirement as a row in the matrix below, give it a stable ID, and track its status through
the project lifecycle.

> The rows below are **examples** — replace them with your own project's requirements and
> delete the ones that don't apply.

## 1. Requirement Matrix

- **Category:** Functional (`REQ-F`) — what the system does; Non-Functional (`REQ-NF`) —
  how well it does it (performance, mechanical, electrical, safety, cost, regulatory).
- **Status:** Backlog, In-progress, Verified, Deferred, Deprecated.
- **Verification:** how you will prove the requirement is met — Test, Demonstration,
  Inspection, or Analysis.
- **Mapping:** the GitHub issue, design doc, drawing, BOM line, or test that satisfies it.

| ID        | Description                                                                             | Category | Status      | Verification  | Target Semester | Mapping (issue / doc)          |
| --------- | --------------------------------------------------------------------------------------- | -------- | ----------- | ------------- | --------------- | ------------------------------ |
| REQ-F-01  | Teambuilder algorithm converts inputted skills into numerical weights     | REQ-F    | Backlog     | Test          | 2026F           | #1                             |
| REQ-F-02 | Algorithm enforces minimum 3200 student threshold                                 | REQ-F   | Backlog     | Inspection    | 2026F           | #2   |
| REQ-F-03 | An operator is able to lock students and teams and run algorithm on remaining "unlocked students" | REQ-F   | Backlog     | Test          | 2026F           | #3                             |
| REQ-NF-01  | Allow teambuilder to be iterative process rather than one-shot     | REQ-F    | Backlog     | Demonstration | 2026F           | #4                            |
| REQ-NF-02 | Teambuilder UI/UX/workflow is intuitive and easy for project director to navigate    | REQ-NF   | Backlog     | Test          | 2026F           | #5                             |
| REQ-NF-03 | Total bill of materials cost stays under the project budget of $500.                    | REQ-NF   | Backlog     | Analysis      | 2026F           | `docs/bom.md`                  |
| REQ-NF-04 | Total bill of materials cost stays under the project budget of $500.                    | REQ-NF   | Backlog     | Analysis      | 2026F           | `docs/bom.md`                  |

## 2. Change Log

Track major changes, additions, or deprecations to the project scope.

| Date       | Requirement ID | Change Description                                        | Author | Approved By |
| ---------- | -------------- | -------------------------------------------------------- | ------ | ----------- |
| YYYY-MM-DD | REQ-F/NF-\*    | Established the initial requirements register.           | @you   | —           |
