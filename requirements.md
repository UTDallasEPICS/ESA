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
| REQ-F-01  | The device powers on and reaches a ready state within 5 seconds of the main switch.     | REQ-F    | Backlog     | Test          | 2026F           | #1                             |
| REQ-F-02  | An operator can start and stop a cycle from the front-panel controls without tools.     | REQ-F    | Backlog     | Demonstration | 2026F           | #2                             |
| REQ-NF-01 | The enclosure fits within a 300 × 300 × 200 mm envelope.                                 | REQ-NF   | Backlog     | Inspection    | 2026F           | `docs/adr/002_enclosure.md`    |
| REQ-NF-02 | The system runs from standard 120 V / 15 A wall power and draws under 1.5 A steady-state.| REQ-NF   | Backlog     | Test          | 2026F           | #3                             |
| REQ-NF-03 | All user-accessible surfaces stay below 48 °C during normal operation (burn safety).    | REQ-NF   | Backlog     | Test          | 2026F           | #4                             |
| REQ-NF-04 | Total bill of materials cost stays under the project budget of $500.                    | REQ-NF   | Backlog     | Analysis      | 2026F           | `docs/bom.md`                  |

## 2. Change Log

Track major changes, additions, or deprecations to the project scope.

| Date       | Requirement ID | Change Description                                        | Author | Approved By |
| ---------- | -------------- | -------------------------------------------------------- | ------ | ----------- |
| YYYY-MM-DD | REQ-F/NF-\*    | Established the initial requirements register.           | @you   | —           |
