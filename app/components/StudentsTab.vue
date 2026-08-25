<script setup lang="ts">
  import type { DataTableColumn } from '~/components/DataTable.vue'
  import type {
    ChildStage,
    MergedChild,
    StageState,
    StagedPayload,
    StagedRecord,
  } from '~/composables/useStagedChanges'
  import { ACTION_ICONS } from '~/utils/icons'
  import type { StudentRead } from '#server/services/studentService'
  import type { ProjectRead } from '#server/services/projectService'

  const props = defineProps<{ semesterId?: string }>()
  const emit = defineEmits<{ 'restore-semester': [previous: string | undefined] }>()

  /** A student flattened with the selected semester's enrollment, so those columns can display. */
  interface StudentRow extends StudentRead {
    meetingDay: string | null
    gender: string | null
    major: string | null
    year: string | null
    class: string | null
  }

  const staging = useStagedChanges()
  const confirm = useConfirm()
  const toast = useToast()
  const saving = ref(false)

  const {
    data: students,
    refresh,
    status,
  } = useFetch<StudentRead[]>('/api/students', {
    query: computed(() => ({ semesterId: props.semesterId })),
    default: () => [],
  })

  // Every semester's projects, so a card can offer the teams of whichever semester it belongs to.
  const { data: allProjects } = useFetch<ProjectRead[]>('/api/projects', {
    key: 'projects-all',
    default: () => [],
  })

  const { semesters } = useSemesters()

  function semesterLabel(id: string) {
    const semester = semesters.value.find((s) => s.id === id)
    if (!semester) return 'Unknown Semester'
    return `${semester.season[0]}${semester.season.slice(1).toLowerCase()} ${semester.year}`
  }

  function semesterSortKey(id: string) {
    const semester = semesters.value.find((s) => s.id === id)
    if (!semester) return 0
    const order = { SPRING: 0, SUMMER: 1, FALL: 2 } as const
    return semester.year * 10 + order[semester.season]
  }

  const MEETING_DAY_OPTIONS = [
    { label: 'Wednesday', value: 'WEDNESDAY' },
    { label: 'Thursday', value: 'THURSDAY' },
  ]
  const GENDER_OPTIONS = [
    { label: 'Male', value: 'MALE' },
    { label: 'Female', value: 'FEMALE' },
    { label: 'Other', value: 'OTHER' },
  ]
  const YEAR_OPTIONS = [
    { label: 'Freshman', value: 'FRESHMAN' },
    { label: 'Sophomore', value: 'SOPHOMORE' },
    { label: 'Junior', value: 'JUNIOR' },
    { label: 'Senior', value: 'SENIOR' },
  ]
  const CLASS_OPTIONS = [
    { label: 'EPCS 2200', value: 'EPCS_2200' },
    { label: 'EPCS 3200', value: 'EPCS_3200' },
  ]

  /** The five enrollment fields shared by the table columns (§3.2.1) and the cards (§3.2.3). */
  const ENROLLMENT_FIELDS = [
    { field: 'meetingDay', label: 'Meeting Day', options: MEETING_DAY_OPTIONS },
    { field: 'gender', label: 'Gender', options: GENDER_OPTIONS },
    { field: 'major', label: 'Major', options: undefined },
    { field: 'year', label: 'Year', options: YEAR_OPTIONS },
    { field: 'class', label: 'Class', options: CLASS_OPTIONS },
  ] as const

  // ------------------------------------------------------------------- table

  const rows = computed<StudentRow[]>(() =>
    students.value.map((student) => {
      const enrollment = props.semesterId
        ? student.Enrollments.find((e) => e.semesterId === props.semesterId)
        : undefined
      return {
        ...student,
        meetingDay: enrollment?.meetingDay ?? null,
        gender: enrollment?.gender ?? null,
        major: enrollment?.major ?? null,
        year: enrollment?.year ?? null,
        class: enrollment?.class ?? null,
      }
    })
  )

  /**
   * Points a semester column at the selected semester's enrollment. Returning undefined — a student
   * who only mentors that semester — leaves the cell read-only; no enrollment is invented (§3.2.1).
   */
  function enrollmentTarget(field: string) {
    return (row: StudentRow) => {
      const enrollment = row.Enrollments?.find((e) => e.semesterId === props.semesterId)
      return enrollment ? { collection: 'Enrollments', id: enrollment.id, field } : undefined
    }
  }

  const columns = computed<DataTableColumn<StudentRow>[]>(() => {
    const base: DataTableColumn<StudentRow>[] = [
      {
        id: 'netID',
        header: 'NetID',
        accessorKey: 'netID',
        sortable: true,
        filter: { type: 'search' },
        editable: { type: 'text' },
        required: true,
      },
      {
        id: 'firstName',
        header: 'First Name',
        accessorKey: 'firstName',
        sortable: true,
        filter: { type: 'search' },
        editable: { type: 'text' },
        required: true,
      },
      {
        id: 'lastName',
        header: 'Last Name',
        accessorKey: 'lastName',
        sortable: true,
        filter: { type: 'search' },
        editable: { type: 'text' },
        required: true,
      },
      {
        id: 'email',
        header: 'Email',
        accessorKey: 'email',
        sortable: true,
        filter: { type: 'search' },
        editable: { type: 'text' },
      },
      {
        id: 'discord',
        header: 'Discord',
        accessorKey: 'discord',
        sortable: true,
        filter: { type: 'search' },
        editable: { type: 'text' },
      },
      {
        id: 'isMentor',
        header: 'Is Mentor?',
        accessorKey: 'isMentor',
        sortable: true,
        filter: {
          type: 'multiselect',
          options: [
            { label: 'Mentor', value: 'true' },
            { label: 'Student', value: 'false' },
          ],
        },
        editable: { type: 'switch' },
      },
    ]
    if (!props.semesterId) return base
    for (const { field, label, options } of ENROLLMENT_FIELDS) {
      base.push({
        id: field,
        header: label,
        accessorKey: field,
        sortable: true,
        editable: options
          ? { type: 'select', options: [...options], child: enrollmentTarget(field) }
          : { type: 'text', child: enrollmentTarget(field) },
      })
    }
    return base
  })

  function newStudentRow() {
    return {
      id: '',
      netID: '',
      firstName: '',
      lastName: '',
      email: '',
      discord: '',
      isMentor: false,
      Enrollments: [],
      Memberships: [],
      Choices: [],
    }
  }

  // ------------------------------------------------------------ semester cards

  interface SemesterCard {
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

  const teamIndex = computed(() => {
    const index = new Map<string, { teamId: string; semesterId: string; project: ProjectRead }>()
    for (const project of allProjects.value) {
      for (const team of project.Teams) {
        index.set(team.id, { teamId: team.id, semesterId: team.semesterId, project })
      }
    }
    return index
  })

  function teamIn(project: ProjectRead, semesterId: string) {
    return project.Teams.find((team) => team.semesterId === semesterId)
  }

  function membershipSemester(membership: MergedChild<any>) {
    return membership.isNew ? membership.record.semesterId : membership.record.Team?.semesterId
  }

  /**
   * The one team assignment for a semester and role, as a fetched membership, a staged-new one, or
   * both — a change of team is staged as delete-then-create because there is no membership update
   * endpoint, and the two halves have to read as a single field on the card.
   */
  function membershipSlot(row: StudentRow, rowId: string, semesterId: string, isMentor: boolean) {
    const merged = staging.mergeChildren(rowId, 'Memberships', row.Memberships ?? [], (m) => m.id)
    let existing: MergedChild<any> | undefined
    let added: MergedChild<any> | undefined
    for (const membership of merged) {
      if (!!membership.record.isMentor !== isMentor) continue
      if (membershipSemester(membership) !== semesterId) continue
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

    const enrollments = staging.mergeChildren(
      rowId,
      'Enrollments',
      row.Enrollments ?? [],
      (e) => e.id
    )
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

    const memberships = staging.mergeChildren(
      rowId,
      'Memberships',
      row.Memberships ?? [],
      (m) => m.id
    )
    const mentorSemesters = new Set<string>()
    for (const membership of memberships) {
      if (!membership.record.isMentor) continue
      const semesterId = membershipSemester(membership)
      if (semesterId) mentorSemesters.add(semesterId)
    }
    for (const semesterId of mentorSemesters) {
      const slot = membershipSlot(row, rowId, semesterId, true)
      const anchor = slot.existing ?? slot.added
      if (!anchor) continue
      const deleted = !!slot.existing?.deleted && !slot.added
      cards.push({
        key: `mentor:${anchor.id}`,
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

  const CARD_TINTS: Record<StageState, string> = {
    new: 'bg-success-50 dark:bg-success-950/50',
    edited: 'bg-info-50 dark:bg-info-950/50',
    deleted: 'bg-error-50 dark:bg-error-950/50',
    clean: '',
  }

  function accordionItems(row: StudentRow, rowId: string) {
    return cardsFor(row, rowId)
      .filter((card) => !props.semesterId || card.semesterId === props.semesterId)
      .map((card) => ({
        label: card.label,
        value: card.key,
        class: CARD_TINTS[card.state],
        card,
        choices: card.role === 'Student' ? choiceEntries(row, rowId, card.semesterId) : [],
      }))
  }

  // ------------------------------------------------------- enrollment fields

  function originalEnrollment(row: StudentRow, childId: string) {
    return (row.Enrollments ?? []).find((e) => e.id === childId) as Record<string, any> | undefined
  }

  function enrollmentValue(row: StudentRow, rowId: string, childId: string, field: string) {
    const original = originalEnrollment(row, childId)?.[field]
    return staging.getChildValue(rowId, 'Enrollments', childId, field, original)
  }

  function setEnrollmentValue(
    row: StudentRow,
    rowId: string,
    childId: string,
    field: string,
    value: any
  ) {
    const original = originalEnrollment(row, childId)?.[field]
    staging.setChildValue(rowId, 'Enrollments', childId, field, value, original)
  }

  // --------------------------------------------------------------- team field

  function teamProject(teamId?: string) {
    return teamId ? teamIndex.value.get(teamId)?.project : undefined
  }

  function searchSemesterProjects(semesterId: string, query: string, exclude?: Set<string>) {
    const q = query.trim().toLowerCase()
    return allProjects.value
      .filter((project) => project.Teams.some((team) => team.semesterId === semesterId))
      .filter((project) => !exclude?.has(project.id))
      .filter(
        (project) =>
          !q ||
          project.name.toLowerCase().includes(q) ||
          project.Partner.name.toLowerCase().includes(q)
      )
      .slice(0, 10)
  }

  async function searchTeamsFor(semesterId: string, query: string) {
    return searchSemesterProjects(semesterId, query)
  }

  function setTeam(row: StudentRow, rowId: string, card: SemesterCard, project?: ProjectRead) {
    const isMentor = card.role === 'Mentor'
    const teamId = project ? teamIn(project, card.semesterId)?.id : undefined
    const slot = membershipSlot(row, rowId, card.semesterId, isMentor)

    // A staged-new membership with no fetched counterpart is simply retargeted in place; on a
    // Mentor card it is the card itself, so it survives being cleared.
    if (slot.added && !slot.existing) {
      if (!teamId && !isMentor) staging.dropChild(rowId, 'Memberships', slot.added.id)
      else staging.setChildValue(rowId, 'Memberships', slot.added.id, 'teamId', teamId)
      return
    }
    if (slot.added) staging.dropChild(rowId, 'Memberships', slot.added.id)
    if (!slot.existing) {
      if (teamId) {
        staging.addChild(rowId, 'Memberships', { semesterId: card.semesterId, teamId, isMentor })
      }
      return
    }
    const shouldDelete = teamId !== slot.originalTeamId
    if (slot.existing.deleted !== shouldDelete) {
      staging.toggleChildDeleted(rowId, 'Memberships', slot.existing.id)
    }
    if (teamId && shouldDelete) {
      staging.addChild(rowId, 'Memberships', { semesterId: card.semesterId, teamId, isMentor })
    }
  }

  // --------------------------------------------------------------- card actions

  function deleteCard(rowId: string, card: SemesterCard) {
    if (card.role === 'Student') {
      // Dropping a staged-new card takes its staged team assignment with it, so nothing is left
      // behind to be POSTed for a card that is no longer on screen.
      if (card.state === 'new' && card.addedMembershipId) {
        staging.dropChild(rowId, 'Memberships', card.addedMembershipId)
      }
      staging.toggleChildDeleted(rowId, 'Enrollments', card.childId)
      return
    }
    if (card.addedMembershipId) staging.dropChild(rowId, 'Memberships', card.addedMembershipId)
    if (!card.membershipId) return
    if (staging.childState(rowId, 'Memberships', card.membershipId) !== 'deleted') {
      staging.toggleChildDeleted(rowId, 'Memberships', card.membershipId)
    }
  }

  function undoCard(rowId: string, card: SemesterCard) {
    if (card.addedMembershipId) staging.dropChild(rowId, 'Memberships', card.addedMembershipId)
    if (card.membershipId) staging.dropChild(rowId, 'Memberships', card.membershipId)
    if (card.role === 'Student') staging.dropChild(rowId, 'Enrollments', card.childId)
  }

  // -------------------------------------------------------- team preferences

  interface ChoiceEntry {
    id: string
    projectId: string
    rank: number
    baseRank: number
    state: StageState
    isNew: boolean
    deleted: boolean
  }

  /**
   * Merged choices for one semester, ordered by their effective rank. Ties — a choice that was just
   * moved onto a sibling's rank — break in favour of the mover, which is what the server's own rank
   * shifting produces once the edit is saved.
   */
  function choiceEntries(row: StudentRow, rowId: string, semesterId: string): ChoiceEntry[] {
    const originals = row.Choices ?? []
    return staging
      .mergeChildren(rowId, 'Choices', originals, (choice) => choice.id)
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

  function projectLabel(projectId: string) {
    return allProjects.value.find((project) => project.id === projectId)?.name ?? 'Unknown Project'
  }

  /**
   * Stages a new rank on the moved choice only. `PUT /api/choices/:id` shifts the siblings server
   * side, so rewriting every sibling here would fight it.
   */
  function moveChoice(
    row: StudentRow,
    rowId: string,
    entries: ChoiceEntry[],
    index: number,
    direction: -1 | 1
  ) {
    const entry = entries[index]
    const neighbour = entries[index + direction]
    if (!entry || !neighbour) return
    const original = (row.Choices ?? []).find((choice) => choice.id === entry.id)?.rank
    staging.setChildValue(rowId, 'Choices', entry.id, 'rank', entry.rank + direction, original)
  }

  function removeChoice(rowId: string, entry: ChoiceEntry) {
    staging.toggleChildDeleted(rowId, 'Choices', entry.id)
  }

  function undoChoice(rowId: string, entry: ChoiceEntry) {
    staging.dropChild(rowId, 'Choices', entry.id)
  }

  // ----------------------------------------------------- team preference modal

  const choiceModal = reactive({ open: false, rowId: '', semesterId: '' })
  const choicePick = ref<ProjectRead | undefined>()

  function openChoiceModal(rowId: string, card: SemesterCard) {
    choiceModal.rowId = rowId
    choiceModal.semesterId = card.semesterId
    choicePick.value = undefined
    choiceModal.open = true
  }

  function choiceRow() {
    return students.value.find((student) => student.id === choiceModal.rowId)
  }

  function stagedChoices() {
    const student = choiceRow()
    return choiceEntries(
      (student ?? { Choices: [] }) as StudentRow,
      choiceModal.rowId,
      choiceModal.semesterId
    )
  }

  async function searchChoiceProjects(query: string) {
    // Staged-deleted picks stay excluded: re-creating one in the same batch would collide with the
    // choice that has not been deleted server side yet.
    const taken = new Set(stagedChoices().map((entry) => entry.projectId))
    return searchSemesterProjects(choiceModal.semesterId, query, taken)
  }

  function submitChoice() {
    if (!choicePick.value) return
    const rank = Math.max(0, ...stagedChoices().map((entry) => entry.rank)) + 1
    staging.addChild(choiceModal.rowId, 'Choices', {
      semesterId: choiceModal.semesterId,
      projectId: choicePick.value.id,
      rank,
      baseRank: rank,
    })
    choiceModal.open = false
  }

  // -------------------------------------------------- semester info creation modal

  const infoModal = reactive({ open: false, rowId: '', isMentor: false })
  const infoDraft = reactive({
    semesterId: '',
    meetingDay: 'WEDNESDAY',
    role: 'STUDENT' as 'STUDENT' | 'MENTOR',
    major: '',
    year: 'FRESHMAN',
    class: 'EPCS_2200',
    gender: 'OTHER',
  })
  const infoTeam = ref<ProjectRead | undefined>()
  // Semesters that already carry a card of each role. A student may hold one of each in the same
  // semester, so the two roles are tracked apart.
  const infoTaken = ref<{ Student: Set<string>; Mentor: Set<string> }>({
    Student: new Set(),
    Mentor: new Set(),
  })

  function openInfoModal(row: StudentRow, rowId: string) {
    infoModal.rowId = rowId
    infoModal.isMentor = !!row.isMentor
    Object.assign(infoDraft, {
      semesterId: '',
      meetingDay: 'WEDNESDAY',
      role: 'STUDENT',
      major: '',
      year: 'FRESHMAN',
      class: 'EPCS_2200',
      gender: 'OTHER',
    })
    infoTeam.value = undefined
    const taken = { Student: new Set<string>(), Mentor: new Set<string>() }
    for (const card of cardsFor(row, rowId)) taken[card.role].add(card.semesterId)
    infoTaken.value = taken
    infoModal.open = true
  }

  // A student has at most one enrollment per semester, and one Mentor card is enough, so a semester
  // that already carries a card of the chosen role cannot be picked again.
  const infoTakenForRole = computed(() =>
    infoDraft.role === 'MENTOR' ? infoTaken.value.Mentor : infoTaken.value.Student
  )

  const infoSemesterItems = computed(() =>
    semesters.value.map((semester) => ({
      label: semesterLabel(semester.id),
      value: semester.id,
      disabled: infoTakenForRole.value.has(semester.id),
    }))
  )

  const infoValid = computed(
    () => !!infoDraft.semesterId && !infoTakenForRole.value.has(infoDraft.semesterId)
  )

  async function searchInfoTeams(query: string) {
    if (!infoDraft.semesterId) return []
    return searchSemesterProjects(infoDraft.semesterId, query)
  }

  watch(
    () => infoDraft.semesterId,
    () => {
      infoTeam.value = undefined
    }
  )

  function submitInfo() {
    if (!infoValid.value) return
    const rowId = infoModal.rowId
    const semesterId = infoDraft.semesterId
    const isMentor = infoModal.isMentor && infoDraft.role === 'MENTOR'
    const teamId = infoTeam.value ? teamIn(infoTeam.value, semesterId)?.id : undefined

    if (isMentor) {
      // Left unassigned the card still stages, and its membership is only sent once a team is set.
      staging.addChild(rowId, 'Memberships', { semesterId, teamId, isMentor: true })
    } else {
      staging.addChild(rowId, 'Enrollments', {
        semesterId,
        meetingDay: infoDraft.meetingDay,
        major: infoDraft.major,
        year: infoDraft.year,
        class: infoDraft.class,
        gender: infoDraft.gender,
      })
      if (teamId) {
        staging.addChild(rowId, 'Memberships', { semesterId, teamId, isMentor: false })
      }
    }
    infoModal.open = false
  }

  // ---------------------------------------------------------------- saving

  function pickEnrollment(fields: Record<string, any>) {
    return {
      semesterId: fields.semesterId,
      meetingDay: fields.meetingDay,
      major: fields.major,
      year: fields.year,
      class: fields.class,
      gender: fields.gender,
    }
  }

  /** New choices are renumbered 1..n per semester so the rank uniqueness constraint holds. */
  function nestedChoices(children: ChildStage[]) {
    const bySemester = new Map<string, ChildStage[]>()
    for (const child of children) {
      if (child.deleted) continue
      const list = bySemester.get(child.fields.semesterId) ?? []
      list.push(child)
      bySemester.set(child.fields.semesterId, list)
    }
    const choices: { semesterId: string; projectId: string; rank: number }[] = []
    for (const [semesterId, list] of bySemester) {
      list.sort((a, b) => a.fields.rank - b.fields.rank || b.fields.baseRank - a.fields.baseRank)
      list.forEach((child, index) => {
        choices.push({ semesterId, projectId: child.fields.projectId, rank: index + 1 })
      })
    }
    return choices
  }

  async function createStudentRow(record: StagedRecord) {
    const fields = record.fields
    const enrollments = (record.children.Enrollments ?? [])
      .filter((child) => !child.deleted)
      .map((child) => pickEnrollment(child.fields))
    const memberships = (record.children.Memberships ?? [])
      .filter((child) => !child.deleted && child.fields.teamId)
      .map((child) => ({ teamId: child.fields.teamId, isMentor: !!child.fields.isMentor }))
    const choices = nestedChoices(record.children.Choices ?? [])

    await $fetch('/api/students', {
      method: 'POST',
      body: {
        netID: fields.netID,
        firstName: fields.firstName,
        lastName: fields.lastName,
        email: fields.email || undefined,
        discord: fields.discord || undefined,
        isMentor: !!fields.isMentor,
        Enrollments: enrollments.length ? enrollments : undefined,
        Memberships: memberships.length ? memberships : undefined,
        Choices: choices.length ? choices : undefined,
      },
    })
  }

  async function updateStudentRow(record: StagedRecord) {
    const id = record.id
    const fields = record.fields

    const body: Record<string, any> = {}
    for (const key of ['netID', 'firstName', 'lastName', 'isMentor'] as const) {
      if (key in fields) body[key] = fields[key]
    }
    for (const key of ['email', 'discord'] as const) {
      if (key in fields) body[key] = fields[key] === '' ? null : fields[key]
    }
    if (Object.keys(body).length) {
      await $fetch(`/api/students/${id}`, { method: 'PUT', body })
    }

    // Deletions run before creations for both enrollments and memberships: a semester's enrollment
    // and a team's membership are unique per student, so re-adding one has to wait for the old row.
    const enrollments = record.children.Enrollments ?? []
    for (const child of enrollments) {
      if (child.deleted) await $fetch(`/api/enrollments/${child.id}`, { method: 'DELETE' })
    }
    for (const child of enrollments) {
      if (child.deleted) continue
      if (child.isNew) {
        await $fetch('/api/enrollments', {
          method: 'POST',
          body: { studentId: id, ...pickEnrollment(child.fields) },
        })
      } else if (Object.keys(child.fields).length) {
        await $fetch(`/api/enrollments/${child.id}`, { method: 'PUT', body: child.fields })
      }
    }

    const memberships = record.children.Memberships ?? []
    for (const child of memberships) {
      if (child.deleted) await $fetch(`/api/memberships/${child.id}`, { method: 'DELETE' })
    }
    for (const child of memberships) {
      if (child.deleted || !child.isNew || !child.fields.teamId) continue
      await $fetch('/api/memberships', {
        method: 'POST',
        body: {
          studentId: id,
          teamId: child.fields.teamId,
          isMentor: !!child.fields.isMentor,
        },
      })
    }

    // Choices are created at the end of their semester's list and then moved, because only the
    // update endpoint shifts the siblings out of the way of a rank.
    const choices = record.children.Choices ?? []
    const fetched = students.value.find((student) => student.id === id)
    const lastRank = new Map<string, number>()
    for (const choice of fetched?.Choices ?? []) {
      lastRank.set(choice.semesterId, Math.max(lastRank.get(choice.semesterId) ?? 0, choice.rank))
    }
    const added = choices
      .filter((child) => child.isNew && !child.deleted)
      .sort((a, b) => a.fields.rank - b.fields.rank || b.fields.baseRank - a.fields.baseRank)
    for (const child of added) {
      const semesterId = child.fields.semesterId
      const appended = (lastRank.get(semesterId) ?? 0) + 1
      lastRank.set(semesterId, appended)
      const created = await $fetch<{ id: string }>('/api/choices', {
        method: 'POST',
        body: { studentId: id, semesterId, projectId: child.fields.projectId, rank: appended },
      })
      const target = child.fields.rank
      if (typeof target === 'number' && target >= 1 && target !== appended) {
        await $fetch(`/api/choices/${created.id}`, { method: 'PUT', body: { rank: target } })
      }
    }
    for (const child of choices) {
      if (child.isNew || child.deleted) continue
      if (typeof child.fields.rank === 'number') {
        await $fetch(`/api/choices/${child.id}`, {
          method: 'PUT',
          body: { rank: child.fields.rank },
        })
      }
    }
    for (const child of choices) {
      if (child.deleted) await $fetch(`/api/choices/${child.id}`, { method: 'DELETE' })
    }
  }

  async function onSave(payload: StagedPayload) {
    if (payload.deleted.length) {
      const affected = students.value.filter((student) => payload.deleted.includes(student.id))
      const ok = await confirm({
        title: `Delete ${payload.deleted.length} student${payload.deleted.length === 1 ? '' : 's'}?`,
        description: 'This will also delete all associated enrollments, choices, and memberships.',
        affected: [
          {
            label: 'Enrollment',
            count: affected.reduce((n, student) => n + student.Enrollments.length, 0),
          },
          {
            label: 'Choice',
            count: affected.reduce((n, student) => n + student.Choices.length, 0),
          },
          {
            label: 'Membership',
            count: affected.reduce((n, student) => n + student.Memberships.length, 0),
          },
        ],
      })
      if (!ok) return
    }

    saving.value = true
    try {
      for (const record of payload.created) await createStudentRow(record)
      for (const record of payload.updated) await updateStudentRow(record)
      for (const id of payload.deleted) {
        await $fetch(`/api/students/${id}`, { method: 'DELETE' })
      }
      staging.reset()
      await refresh()
    } catch (error: any) {
      toast.add({
        title: 'Could not save changes',
        description: error?.data?.message ?? error?.message ?? 'Please try again.',
        color: 'error',
      })
    } finally {
      saving.value = false
    }
  }

  // --------------------------------------------------------- semester guard

  let restoring = false
  watch(
    () => props.semesterId,
    async (next, previous) => {
      if (restoring) {
        restoring = false
        return
      }
      if (!staging.isDirty.value) return
      const ok = await confirm({
        title: 'Discard staged changes?',
        description: 'Changing the semester filter will discard everything you have staged here.',
        confirmLabel: 'Discard',
      })
      if (ok) staging.reset()
      else {
        restoring = true
        emit('restore-semester', previous)
      }
    }
  )
</script>

<template>
  <div>
    <DataTable
      :data="rows"
      :columns="columns"
      :row-key="(row) => row.id"
      :staging="staging"
      :loading="status === 'pending'"
      :saving="saving"
      expandable
      :new-row="newStudentRow"
      @save="onSave"
    >
      <template #expanded="{ row, rowId, deleted }">
        <div class="space-y-3 p-3">
          <div class="flex items-center justify-between">
            <h3 class="font-semibold">Semester Info</h3>
            <UButton
              label="Add Semester Info"
              :icon="ACTION_ICONS.add"
              size="xs"
              variant="soft"
              :disabled="deleted || saving"
              @click="openInfoModal(row, rowId)"
            />
          </div>

          <UAccordion :items="accordionItems(row, rowId)" type="multiple">
            <template #body="{ item }">
              <div class="space-y-3 p-2">
                <div class="flex justify-end gap-1">
                  <UButton
                    v-if="item.card.state !== 'clean'"
                    label="Undo"
                    :icon="ACTION_ICONS.undo"
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    :disabled="deleted || saving"
                    @click="undoCard(rowId, item.card)"
                  />
                  <UButton
                    v-if="!item.card.deleted"
                    label="Delete Semester Info"
                    :icon="ACTION_ICONS.delete"
                    size="xs"
                    color="error"
                    variant="ghost"
                    :disabled="deleted || saving"
                    @click="deleteCard(rowId, item.card)"
                  />
                </div>

                <div
                  v-if="item.card.role === 'Student'"
                  class="grid grid-cols-1 gap-2 sm:grid-cols-3"
                >
                  <UFormField
                    v-for="field in ENROLLMENT_FIELDS"
                    :key="field.field"
                    :label="field.label"
                  >
                    <USelectMenu
                      v-if="field.options"
                      :model-value="
                        enrollmentValue(row, rowId, item.card.childId, field.field) ?? undefined
                      "
                      :items="field.options"
                      value-key="value"
                      class="w-full"
                      :disabled="deleted || item.card.deleted || saving"
                      :highlight="
                        staging.isChildFieldEdited(
                          rowId,
                          'Enrollments',
                          item.card.childId,
                          field.field
                        )
                      "
                      color="warning"
                      @update:model-value="
                        (value: any) =>
                          setEnrollmentValue(row, rowId, item.card.childId, field.field, value)
                      "
                    />
                    <UInput
                      v-else
                      :model-value="
                        enrollmentValue(row, rowId, item.card.childId, field.field) ?? ''
                      "
                      class="w-full"
                      :disabled="deleted || item.card.deleted || saving"
                      :highlight="
                        staging.isChildFieldEdited(
                          rowId,
                          'Enrollments',
                          item.card.childId,
                          field.field
                        )
                      "
                      color="warning"
                      @update:model-value="
                        (value: any) =>
                          setEnrollmentValue(row, rowId, item.card.childId, field.field, value)
                      "
                    />
                  </UFormField>
                </div>

                <UFormField label="Team">
                  <div class="flex items-center gap-1">
                    <RecordSearchInput
                      :model-value="teamProject(item.card.teamId)"
                      :search="(query: string) => searchTeamsFor(item.card.semesterId, query)"
                      :display-label="(project: any) => `${project.name} (${project.Partner.name})`"
                      placeholder="Search by project or partner name…"
                      :disabled="deleted || item.card.deleted || saving"
                      :highlight="item.card.teamChanged"
                      color="warning"
                      class="flex-1"
                      @update:model-value="
                        (project: any) => setTeam(row, rowId, item.card, project)
                      "
                    />
                    <UButton
                      v-if="item.card.teamId"
                      :icon="ACTION_ICONS.cancel"
                      size="xs"
                      color="neutral"
                      variant="ghost"
                      aria-label="Clear team"
                      :disabled="deleted || item.card.deleted || saving"
                      @click="setTeam(row, rowId, item.card, undefined)"
                    />
                  </div>
                </UFormField>

                <div v-if="item.card.role === 'Student'" class="space-y-2">
                  <div class="flex items-center justify-between">
                    <span class="text-xs font-medium text-gray-500">Team Preferences</span>
                    <UButton
                      label="Add Preference"
                      :icon="ACTION_ICONS.add"
                      size="xs"
                      variant="ghost"
                      :disabled="deleted || item.card.deleted || saving"
                      @click="openChoiceModal(rowId, item.card)"
                    />
                  </div>
                  <ul class="space-y-1">
                    <li
                      v-for="(entry, index) in item.choices"
                      :key="entry.id"
                      class="flex items-center justify-between rounded border border-gray-200 p-2 text-sm dark:border-gray-800"
                      :class="CARD_TINTS[entry.state]"
                    >
                      <span>#{{ index + 1 }} {{ projectLabel(entry.projectId) }}</span>
                      <div class="flex items-center gap-1">
                        <UButton
                          :icon="ACTION_ICONS.moveUp"
                          size="xs"
                          color="neutral"
                          variant="ghost"
                          aria-label="Move up"
                          :disabled="
                            index === 0 || entry.deleted || deleted || item.card.deleted || saving
                          "
                          @click="moveChoice(row, rowId, item.choices, index, -1)"
                        />
                        <UButton
                          :icon="ACTION_ICONS.moveDown"
                          size="xs"
                          color="neutral"
                          variant="ghost"
                          aria-label="Move down"
                          :disabled="
                            index === item.choices.length - 1 ||
                            entry.deleted ||
                            deleted ||
                            item.card.deleted ||
                            saving
                          "
                          @click="moveChoice(row, rowId, item.choices, index, 1)"
                        />
                        <UButton
                          v-if="entry.state === 'new' || entry.deleted"
                          label="Undo"
                          :icon="ACTION_ICONS.undo"
                          size="xs"
                          color="neutral"
                          variant="ghost"
                          :disabled="deleted || item.card.deleted || saving"
                          @click="undoChoice(rowId, entry)"
                        />
                        <UButton
                          v-else
                          label="Remove"
                          :icon="ACTION_ICONS.delete"
                          size="xs"
                          color="error"
                          variant="ghost"
                          :disabled="deleted || item.card.deleted || saving"
                          @click="removeChoice(rowId, entry)"
                        />
                      </div>
                    </li>
                  </ul>
                </div>
              </div>
            </template>
          </UAccordion>
        </div>
      </template>
    </DataTable>

    <UModal v-model:open="choiceModal.open" title="Add Team Preference">
      <template #body>
        <div class="space-y-4">
          <RecordSearchInput
            v-model="choicePick"
            :search="searchChoiceProjects"
            :display-label="(project: any) => `${project.name} (${project.Partner.name})`"
            placeholder="Search by project or partner name…"
          />
          <div class="flex justify-end gap-2">
            <UButton
              label="Cancel"
              :icon="ACTION_ICONS.cancel"
              color="neutral"
              variant="soft"
              @click="choiceModal.open = false"
            />
            <UButton
              label="Confirm"
              :icon="ACTION_ICONS.confirm"
              :disabled="!choicePick"
              @click="submitChoice"
            />
          </div>
        </div>
      </template>
    </UModal>

    <UModal v-model:open="infoModal.open" title="Add Semester Info">
      <template #body>
        <div class="space-y-4">
          <UFormField label="Semester">
            <USelectMenu
              v-model="infoDraft.semesterId"
              :items="infoSemesterItems"
              value-key="value"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Meeting Day">
            <USelectMenu
              v-model="infoDraft.meetingDay"
              :items="MEETING_DAY_OPTIONS"
              value-key="value"
              class="w-full"
            />
          </UFormField>
          <UFormField v-if="infoModal.isMentor" label="Role">
            <URadioGroup
              v-model="infoDraft.role"
              orientation="horizontal"
              :items="[
                { label: 'Student', value: 'STUDENT' },
                { label: 'Mentor', value: 'MENTOR' },
              ]"
            />
          </UFormField>

          <template v-if="infoDraft.role === 'STUDENT'">
            <UFormField label="Major">
              <UInput v-model="infoDraft.major" class="w-full" />
            </UFormField>
            <UFormField label="Year">
              <USelectMenu
                v-model="infoDraft.year"
                :items="YEAR_OPTIONS"
                value-key="value"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Class">
              <USelectMenu
                v-model="infoDraft.class"
                :items="CLASS_OPTIONS"
                value-key="value"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Gender">
              <USelectMenu
                v-model="infoDraft.gender"
                :items="GENDER_OPTIONS"
                value-key="value"
                class="w-full"
              />
            </UFormField>
          </template>

          <UFormField label="Team" hint="Optional">
            <RecordSearchInput
              v-model="infoTeam"
              :search="searchInfoTeams"
              :display-label="(project: any) => `${project.name} (${project.Partner.name})`"
              placeholder="Search by project or partner name…"
            />
          </UFormField>

          <div class="flex justify-end gap-2">
            <UButton
              label="Cancel"
              :icon="ACTION_ICONS.cancel"
              color="neutral"
              variant="soft"
              @click="infoModal.open = false"
            />
            <UButton
              label="Confirm"
              :icon="ACTION_ICONS.confirm"
              :disabled="!infoValid"
              @click="submitInfo"
            />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
