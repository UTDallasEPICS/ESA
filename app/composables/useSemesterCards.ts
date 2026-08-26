// The derivation behind the Students row expansion (§3.2.3).
//
// A student's semester is presented as one card, but it is assembled from two staged collections:
// an Enrollment (the Student card) or a mentor Membership (the Mentor card), plus the Membership
// holding the team assignment. Because there is no `PUT /api/memberships/:id`, changing a team is
// staged as a delete plus a create — `membershipSlot` re-collapses that pair so the card can read
// as a single Team field.

import type { ProjectRead } from '#server/services/projectService'
import type { StudentRead } from '#server/services/studentService'
import type { ChoiceRead } from '#server/services/choiceService'

/** `baseRank` is a client-only tiebreak (the rank a choice had before this session's edits) that
 *  never reaches the server, so it's layered onto `ChoiceRead` here rather than in the service. */
type StagedChoice = ChoiceRead & { baseRank?: number }

/** A student flattened with the selected semester's enrollment, so those columns can display. */
export interface StudentRow extends StudentRead {
  meetingDay: string | null
  gender: string | null
  major: string | null
  year: string | null
  class: string | null
}

export interface SemesterCard {
  key: string
  role: 'Student' | 'Mentor'
  semesterId: string
  label: string
  /** The enrollment behind a Student card, or the membership behind a Mentor card. */
  childId: string
  state: StageState
  deleted: boolean
  teamId?: string
  teamChanged: boolean
  /** The fetched membership holding this card's team assignment, if there is one. */
  membershipId?: string
  /** A staged-new membership standing in for it. */
  addedMembershipId?: string
}

export interface ChoiceEntry {
  id: string
  projectId: string
  rank: number
  baseRank: number
  state: StageState
  isNew: boolean
  deleted: boolean
}

export function useSemesterCards(input: {
  staging: RowFieldStaging
  projects: Ref<ProjectRead[]>
  semesterLabel: (id?: string | null) => string
  semesterSortKey: (id?: string | null) => number
}) {
  const { staging, projects, semesterLabel, semesterSortKey } = input

  const teamIndex = computed(() => {
    const index = new Map<string, { teamId: string; semesterId: string; project: ProjectRead }>()
    for (const project of projects.value) {
      for (const team of project.Teams) {
        index.set(team.id, { teamId: team.id, semesterId: team.semesterId, project })
      }
    }
    return index
  })

  function teamIn(project: ProjectRead, semesterId: string) {
    return project.Teams.find((team) => team.semesterId === semesterId)
  }

  function teamProject(teamId?: string) {
    return teamId ? teamIndex.value.get(teamId)?.project : undefined
  }

  function membershipSemester(membership: MergedChild<any>) {
    return membership.isNew ? membership.record.semesterId : membership.record.Team?.semesterId
  }

  /**
   * The one team assignment for a semester+role slot, as a fetched membership, a staged-new one, or
   * both — the two halves of a team change have to read as a single field on the card. A Student
   * slot is unambiguous (one Enrollment, one team) so `anchorId` can be omitted and the first match
   * taken; a Mentor can hold several simultaneous team memberships in one semester, so their slot is
   * pinned to a specific membership by id — either the fetched one being edited, or a staged-new one
   * tagged `replacesId` when it's retargeting that fetched membership to a different team.
   */
  function membershipSlot(
    row: StudentRow,
    rowId: string,
    semesterId: string,
    isMentor: boolean,
    anchorId?: string
  ) {
    const merged = staging.children.merge(rowId, 'Memberships')
    let existing: MergedChild<any> | undefined
    let added: MergedChild<any> | undefined
    for (const membership of merged) {
      if (!!membership.record.isMentor !== isMentor) continue
      if (membershipSemester(membership) !== semesterId) continue
      if (anchorId) {
        if (membership.isNew) {
          if (membership.id === anchorId || membership.record.replacesId === anchorId) {
            added ??= membership
          }
        } else if (membership.id === anchorId) {
          existing = membership
        }
        continue
      }
      if (membership.isNew) added ??= membership
      else existing ??= membership
    }
    const originalTeamId = existing
      ? (row.Memberships ?? []).find((m) => m.id === existing!.id)?.teamId
      : undefined
    const teamId = added
      ? added.record.teamId
      : existing && !existing.deleted
        ? existing.record.teamId
        : undefined
    return { existing, added, teamId, originalTeamId, changed: teamId !== originalTeamId }
  }

  function cardsFor(row: StudentRow, rowId: string): SemesterCard[] {
    const cards: SemesterCard[] = []

    const enrollments = staging.children.merge(rowId, 'Enrollments')
    for (const enrollment of enrollments) {
      const semesterId = enrollment.record.semesterId
      if (!semesterId) continue
      const slot = membershipSlot(row, rowId, semesterId, false)
      cards.push({
        key: `enrollment:${enrollment.id}`,
        role: 'Student',
        semesterId,
        label: `${semesterLabel(semesterId)} — Student`,
        childId: enrollment.id,
        state: enrollment.state !== 'clean' ? enrollment.state : slot.changed ? 'edited' : 'clean',
        deleted: enrollment.deleted,
        teamId: slot.teamId,
        // A green card needs no per-field outline; the whole card already reads as an addition.
        teamChanged: !enrollment.isNew && slot.changed,
        membershipId: slot.existing?.id,
        addedMembershipId: slot.added?.id,
      })
    }

    // A mentor can hold several simultaneous team memberships in one semester (leading more than one
    // project), so each mentor Membership is its own card — anchored to the fetched membership it
    // came from, or to itself when it's a staged-new one with no fetched counterpart to replace.
    const memberships = staging.children.merge(rowId, 'Memberships')
    const mentorAnchors = new Map<string, string>()
    for (const membership of memberships) {
      if (!membership.record.isMentor) continue
      const semesterId = membershipSemester(membership)
      if (!semesterId) continue
      if (membership.isNew && membership.record.replacesId) continue
      mentorAnchors.set(membership.id, semesterId)
    }
    for (const [anchorId, semesterId] of mentorAnchors) {
      const slot = membershipSlot(row, rowId, semesterId, true, anchorId)
      const anchor = slot.existing ?? slot.added
      if (!anchor) continue
      const deleted = !!slot.existing?.deleted && !slot.added
      cards.push({
        key: `mentor:${anchorId}`,
        role: 'Mentor',
        semesterId,
        label: `${semesterLabel(semesterId)} — Mentor`,
        childId: anchor.id,
        state: deleted ? 'deleted' : slot.existing && slot.added ? 'edited' : anchor.state,
        deleted,
        teamId: slot.teamId,
        teamChanged: !anchor.isNew && slot.changed,
        membershipId: slot.existing?.id,
        addedMembershipId: slot.added?.id,
      })
    }

    return cards.sort((a, b) => semesterSortKey(b.semesterId) - semesterSortKey(a.semesterId))
  }

  function setTeam(row: StudentRow, rowId: string, card: SemesterCard, project?: ProjectRead) {
    const isMentor = card.role === 'Mentor'
    const teamId = project ? teamIn(project, card.semesterId)?.id : undefined
    // Pinned to this card's own membership so a change on one mentor slot can't be picked up by
    // `membershipSlot`'s search and misattributed to a sibling mentor slot in the same semester.
    const anchorId = card.membershipId ?? card.addedMembershipId
    const slot = membershipSlot(row, rowId, card.semesterId, isMentor, anchorId)

    // A staged-new membership with no fetched counterpart is simply retargeted in place; on a
    // Mentor card it is the card itself, so it survives being cleared.
    if (slot.added && !slot.existing) {
      if (!teamId && !isMentor) staging.children.undo(rowId, 'Memberships', slot.added.id)
      else staging.children.set(rowId, 'Memberships', slot.added.id, 'teamId', teamId)
      return
    }
    if (slot.added) staging.children.undo(rowId, 'Memberships', slot.added.id)
    if (!slot.existing) {
      if (teamId) {
        staging.children.add(rowId, 'Memberships', {
          semesterId: card.semesterId,
          teamId,
          isMentor,
        })
      }
      return
    }
    const shouldDelete = teamId !== slot.originalTeamId
    if (slot.existing.deleted !== shouldDelete) {
      if (shouldDelete) staging.children.markDeleted(rowId, 'Memberships', slot.existing.id)
      else staging.children.undo(rowId, 'Memberships', slot.existing.id)
    }
    if (teamId && shouldDelete) {
      // `replacesId` links this staged-new membership back to the fetched one it's retargeting, so
      // `membershipSlot` can re-pair them into a single card even when a mentor has other, untouched
      // mentor memberships in the same semester. It's a client-only field — see `baseRank` above —
      // and never reaches the server.
      staging.children.add(rowId, 'Memberships', {
        semesterId: card.semesterId,
        teamId,
        isMentor,
        replacesId: slot.existing.id,
      })
    }
  }

  function deleteCard(rowId: string, card: SemesterCard) {
    if (card.role === 'Student') {
      // Dropping a staged-new card takes its staged team assignment with it, so nothing is left
      // behind to be POSTed for a card that is no longer on screen.
      if (card.state === 'new' && card.addedMembershipId) {
        staging.children.undo(rowId, 'Memberships', card.addedMembershipId)
      }
      staging.children.markDeleted(rowId, 'Enrollments', card.childId)
      return
    }
    if (card.addedMembershipId) staging.children.undo(rowId, 'Memberships', card.addedMembershipId)
    if (card.membershipId) staging.children.markDeleted(rowId, 'Memberships', card.membershipId)
  }

  function undoCard(rowId: string, card: SemesterCard) {
    if (card.addedMembershipId) staging.children.undo(rowId, 'Memberships', card.addedMembershipId)
    if (card.membershipId) staging.children.undo(rowId, 'Memberships', card.membershipId)
    if (card.role === 'Student') staging.children.undo(rowId, 'Enrollments', card.childId)
  }

  /**
   * Merged choices for one semester, ordered by their effective rank. Ties — a choice that was just
   * moved onto a sibling's rank — break in favour of the mover, which is what the server's own rank
   * shifting produces once the edit is saved.
   */
  function choiceEntries(row: StudentRow, rowId: string, semesterId: string): ChoiceEntry[] {
    const originals = row.Choices ?? []
    return staging.children
      .merge<StagedChoice>(rowId, 'Choices')
      .filter((choice) => choice.record.semesterId === semesterId)
      .map((choice) => ({
        id: choice.id,
        projectId: choice.record.projectId,
        rank: choice.record.rank,
        baseRank: choice.isNew
          ? (choice.record.baseRank ?? choice.record.rank)
          : (originals.find((original) => original.id === choice.id)?.rank ?? choice.record.rank),
        state: choice.state,
        isNew: choice.isNew,
        deleted: choice.deleted,
      }))
      .sort((a, b) => a.rank - b.rank || b.baseRank - a.baseRank)
  }

  /**
   * Stages a new rank on the moved choice only. `PUT /api/choices/:id` shifts the siblings server
   * side, so rewriting every sibling here would fight it.
   */
  function moveChoice(rowId: string, entries: ChoiceEntry[], index: number, direction: -1 | 1) {
    const entry = entries[index]
    const neighbour = entries[index + direction]
    if (!entry || !neighbour) return
    staging.children.set(rowId, 'Choices', entry.id, 'rank', entry.rank + direction)
  }

  return {
    teamIn,
    teamProject,
    cardsFor,
    setTeam,
    deleteCard,
    undoCard,
    choiceEntries,
    moveChoice,
  }
}
