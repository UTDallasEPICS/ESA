<script setup lang="ts">
  import type { DataTableColumn } from '~/components/DataTable.vue'
  import type { ChildStage, StagedRecord } from '~/composables/useStagedChanges'
  import { STAGE_TINTS } from '~/composables/useStagedChanges'
  import { type StudentRow, useSemesterCards } from '~/composables/useSemesterCards'
  import { ACTION_ICONS } from '~/utils/icons'
  import { textColumn } from '~/utils/columns'
  import { ENROLLMENT_FIELDS, MENTOR_FILTER_OPTIONS } from '~/utils/options'
  import type { StudentRead } from '#server/services/studentService'
  import { useSemesterFilter } from '~/composables/useSemesterFilter'
  import { useRecordModals } from '~/composables/useRecordModals'
  import { useAllProjects } from '~/composables/useDirectory'
  import { useSemesterLookup } from '~/composables/useSemesters'
  import { useStagedSave } from '~/composables/useStagedSave'
  import { provideRowStaging } from '~/composables/useRowStaging'

  const { semesterId, guard } = useSemesterFilter()
  const { openSemesterInfoModal } = useRecordModals()

  const staging = useStagedChanges()
  guard(staging)

  const {
    data: students,
    refresh,
    status,
  } = useFetch<StudentRead[]>('/api/students', {
    key: 'students',
    query: computed(() => ({ semesterId: semesterId.value })),
    default: () => [],
  })

  // Registers every student's enrollments, memberships, and choices, so StudentSemesterCard and
  // useSemesterCards never have to look up the fetched original themselves.
  watch(
    students,
    (list) => {
      for (const student of list) {
        staging.registerChildren(student.id, 'Enrollments', student.Enrollments ?? [], (e) => e.id)
        staging.registerChildren(student.id, 'Memberships', student.Memberships ?? [], (m) => m.id)
        staging.registerChildren(student.id, 'Choices', student.Choices ?? [], (c) => c.id)
      }
    },
    { immediate: true }
  )

  // Every semester's projects, so a card can offer the teams of whichever semester it belongs to.
  const { data: allProjects } = useAllProjects()

  const { semesters, semesterLabel, semesterSortKey, semesterOptions } = useSemesterLookup()
  const { cardsFor, choiceEntries, teamIn } = useSemesterCards({
    staging,
    projects: allProjects,
    semesterLabel,
    semesterSortKey,
  })

  // ------------------------------------------------------------------- table

  const rows = computed<StudentRow[]>(() =>
    students.value.map((student) => {
      const enrollment = semesterId.value
        ? student.Enrollments.find((e) => e.semesterId === semesterId.value)
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
      const enrollment = row.Enrollments?.find((e) => e.semesterId === semesterId.value)
      return enrollment ? { collection: 'Enrollments', id: enrollment.id, field } : undefined
    }
  }

  const columns = computed<DataTableColumn<StudentRow>[]>(() => {
    const base: DataTableColumn<StudentRow>[] = [
      textColumn<StudentRow>('netID', 'NetID', { required: true }),
      textColumn<StudentRow>('firstName', 'First Name', { required: true }),
      textColumn<StudentRow>('lastName', 'Last Name', { required: true }),
      textColumn<StudentRow>('email', 'Email'),
      textColumn<StudentRow>('discord', 'Discord'),
      {
        id: 'isMentor',
        header: 'Is Mentor?',
        accessorKey: 'isMentor',
        sortable: true,
        filter: { type: 'multiselect', options: MENTOR_FILTER_OPTIONS },
        editable: { type: 'switch' },
      },
    ]
    if (!semesterId.value) return base
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

  // --------------------------------------------------------------- expansion

  function accordionItems(row: StudentRow, rowId: string) {
    return cardsFor(row, rowId)
      .filter((card) => !semesterId.value || card.semesterId === semesterId.value)
      .map((card) => ({
        label: card.label,
        value: card.key,
        class: STAGE_TINTS[card.state],
        card,
        choices: card.role === 'Student' ? choiceEntries(row, rowId, card.semesterId) : [],
      }))
  }

  async function addSemesterInfo(row: StudentRow, rowId: string) {
    const taken = { STUDENT: [] as string[], MENTOR: [] as string[] }
    for (const card of cardsFor(row, rowId)) {
      taken[card.role === 'Mentor' ? 'MENTOR' : 'STUDENT'].push(card.semesterId)
    }

    const draft = await openSemesterInfoModal({
      isMentor: !!row.isMentor,
      semesters: semesterOptions.value,
      taken,
      projects: allProjects.value,
    })
    if (!draft) return

    const isMentor = !!row.isMentor && draft.role === 'MENTOR'
    const teamId = draft.project ? teamIn(draft.project, draft.semesterId)?.id : undefined

    if (isMentor) {
      // Left unassigned the card still stages, and its membership is only sent once a team is set.
      staging.addChild(rowId, 'Memberships', {
        semesterId: draft.semesterId,
        teamId,
        isMentor: true,
      })
      return
    }
    staging.addChild(rowId, 'Enrollments', {
      semesterId: draft.semesterId,
      meetingDay: draft.meetingDay,
      major: draft.major,
      year: draft.year,
      class: draft.class,
      gender: draft.gender,
    })
    if (teamId) {
      staging.addChild(rowId, 'Memberships', {
        semesterId: draft.semesterId,
        teamId,
        isMentor: false,
      })
    }
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

  async function createStudent(record: StagedRecord) {
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

  async function updateStudent(record: StagedRecord) {
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
      const childSemesterId = child.fields.semesterId
      const appended = (lastRank.get(childSemesterId) ?? 0) + 1
      lastRank.set(childSemesterId, appended)
      const created = await $fetch<{ id: string }>('/api/choices', {
        method: 'POST',
        body: {
          studentId: id,
          semesterId: childSemesterId,
          projectId: child.fields.projectId,
          rank: appended,
        },
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

  async function deleteStudent(id: string) {
    await $fetch(`/api/students/${id}`, { method: 'DELETE' })
  }

  const { saving, onSave } = useStagedSave({
    staging,
    entity: 'student',
    cascade: 'This will also delete all associated enrollments, choices, and memberships.',
    affected: (ids) => {
      const selected = students.value.filter((student) => ids.includes(student.id))
      return [
        {
          label: 'Enrollment',
          count: selected.reduce((n, student) => n + student.Enrollments.length, 0),
        },
        { label: 'Choice', count: selected.reduce((n, student) => n + student.Choices.length, 0) },
        {
          label: 'Membership',
          count: selected.reduce((n, student) => n + student.Memberships.length, 0),
        },
      ]
    },
    refresh,
    create: createStudent,
    update: updateStudent,
    delete: deleteStudent,
  })

  provideRowStaging({ staging, saving })
</script>

<template>
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
            @click="addSemesterInfo(row, rowId)"
          />
        </div>

        <UAccordion :items="accordionItems(row, rowId)" type="multiple">
          <template #body="{ item }">
            <StudentSemesterCard
              :row-id="rowId"
              :row="row"
              :card="item.card"
              :choices="item.choices"
              :disabled="deleted"
            />
          </template>
        </UAccordion>
      </div>
    </template>
  </DataTable>
</template>
