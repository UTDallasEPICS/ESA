<script setup lang="ts">
  import { z } from 'zod'
  import type { FormSubmitEvent } from '@nuxt/ui'
  import type { DataTableColumn } from '~/components/DataTable.vue'
  import { ACTION_ICONS } from '~/utils/icons'
  import type { MergedChild, StagedPayload, StageState } from '~/composables/useStagedChanges'
  import type { ProjectRead } from '#server/services/projectService'
  import type { TeamRead } from '#server/services/teamService'
  import type { MembershipRead } from '#server/services/membershipService'
  import type { PartnerRead } from '#server/services/partnerService'
  import type { StudentRead } from '#server/services/studentService'

  const props = defineProps<{ semesterId?: string }>()
  const emit = defineEmits<{ 'restore-semester': [previous: string | undefined] }>()

  type MeetingDay = TeamRead['meetingDay']

  /** A project row flattened with the meeting day of its team for the selected semester. */
  interface ProjectRow extends ProjectRead {
    meetingDay: MeetingDay | null
  }

  /** The shape a staged team or membership takes while it lives in the store. */
  type TeamLike = Partial<TeamRead> & { semesterId: string; meetingDay: MeetingDay }
  type MemberLike = Partial<MembershipRead> & {
    teamId: string
    studentId: string
    isMentor: boolean
  }

  const staging = useStagedChanges()
  const confirm = useConfirm()
  const toast = useToast()
  const saving = ref(false)

  const {
    data: projects,
    refresh,
    status,
  } = useFetch<ProjectRead[]>('/api/projects', {
    query: computed(() => ({ semesterId: props.semesterId })),
    default: () => [],
  })

  const { data: allPartners } = useFetch<PartnerRead[]>('/api/partners', {
    key: 'partners-all',
    default: () => [],
  })

  const { data: allStudents } = useFetch<StudentRead[]>('/api/students', {
    key: 'students-all',
    default: () => [],
  })

  const { semesters } = useSemesters()

  // ------------------------------------------------------------------ labels

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

  function dayLabel(day?: string | null) {
    return day ? `${day[0]}${day.slice(1).toLowerCase()}` : '—'
  }

  function teamLabel(team: { semesterId: string; meetingDay: MeetingDay }) {
    return `${semesterLabel(team.semesterId)} — ${dayLabel(team.meetingDay)}`
  }

  function memberLabel(member: MemberLike) {
    const student = member.Student ?? allStudents.value.find((s) => s.id === member.studentId)
    if (!student) return 'Unknown student'
    return `${student.firstName} ${student.lastName} (${student.netID})`
  }

  // Staged-change tints (§2.3.1), shared by team cards and member rows.
  const TINTS: Record<StageState, string> = {
    new: 'bg-success-50 dark:bg-success-950/50',
    edited: 'bg-info-50 dark:bg-info-950/50',
    deleted: 'bg-error-50 dark:bg-error-950/50',
    clean: '',
  }

  // ------------------------------------------------------------------- table

  const typeOptions = [
    { label: 'Software', value: 'SOFTWARE' },
    { label: 'Hardware', value: 'HARDWARE' },
    { label: 'Both', value: 'BOTH' },
  ]
  const statusOptions = [
    { label: 'New', value: 'NEW' },
    { label: 'Returning', value: 'RETURNING' },
    { label: 'Complete', value: 'COMPLETE' },
    { label: 'Withdrawn', value: 'WITHDRAWN' },
    { label: 'Hold', value: 'HOLD' },
  ]
  const dayOptions = [
    { label: 'Wednesday', value: 'WEDNESDAY' },
    { label: 'Thursday', value: 'THURSDAY' },
  ]

  const rows = computed<ProjectRow[]>(() =>
    projects.value.map((project) => ({
      ...project,
      meetingDay: props.semesterId
        ? (project.Teams.find((team) => team.semesterId === props.semesterId)?.meetingDay ?? null)
        : null,
    }))
  )

  async function searchPartners(query: string) {
    const q = query.toLowerCase()
    return allPartners.value.filter((p) => !q || p.name.toLowerCase().includes(q)).slice(0, 10)
  }

  const columns = computed<DataTableColumn<ProjectRow>[]>(() => {
    const base: DataTableColumn<ProjectRow>[] = [
      {
        id: 'name',
        header: 'Name',
        accessorKey: 'name',
        sortable: true,
        filter: { type: 'search' },
        editable: { type: 'text' },
        required: true,
      },
      {
        id: 'type',
        header: 'Type',
        accessorKey: 'type',
        filter: { type: 'multiselect', options: typeOptions },
        editable: { type: 'select', options: typeOptions },
      },
      {
        id: 'status',
        header: 'Status',
        accessorKey: 'status',
        filter: { type: 'multiselect', options: statusOptions },
        editable: { type: 'select', options: statusOptions },
      },
      {
        id: 'repoURL',
        header: 'GitHub Link',
        accessorKey: 'repoURL',
        filter: { type: 'search' },
        editable: { type: 'text' },
      },
      {
        id: 'partnerId',
        header: 'Partner',
        accessorKey: 'partnerId',
        sortable: true,
        filter: { type: 'search' },
        format: (_value, row) => row.Partner?.name ?? '',
        editable: {
          type: 'record-search',
          search: searchPartners,
          displayLabel: (partner: PartnerRead) => partner.name,
          toValue: (partner: PartnerRead) => partner.id,
          fromValue: (value: string) => allPartners.value.find((p) => p.id === value),
        },
        required: true,
      },
    ]

    if (!props.semesterId) return base

    // A proxy onto that semester's team; without one the cell stays read-only (§3.1.1).
    base.push({
      id: 'meetingDay',
      header: 'Meeting Day',
      accessorKey: 'meetingDay',
      sortable: true,
      format: (value) => dayLabel(value),
      editable: {
        type: 'select',
        options: dayOptions,
        child: (row) => {
          const team = row.Teams?.find((t) => t.semesterId === props.semesterId)
          return team ? { collection: 'Teams', id: team.id, field: 'meetingDay' } : undefined
        },
      },
    })
    return base
  })

  function newRow() {
    return {
      id: '',
      name: '',
      description: '',
      type: 'SOFTWARE',
      status: 'NEW',
      repoURL: '',
      partnerId: '',
      Partner: null,
      Teams: [],
    }
  }

  // -------------------------------------------------------------- expansion

  /** Every team on the project — fetched ones with their staged edits, then staged-new ones. */
  function allTeamCards(rowId: string, row: ProjectRow): MergedChild<TeamLike>[] {
    const originals = (row.Teams ?? []) as unknown as TeamLike[]
    return staging
      .mergeChildren<TeamLike>(rowId, 'Teams', originals, (team) => team.id!)
      .sort((a, b) => semesterSortKey(b.record.semesterId) - semesterSortKey(a.record.semesterId))
  }

  /** The cards actually rendered: one semester's team when the filter is set, else all (§3.1.3). */
  function teamCards(rowId: string, row: ProjectRow) {
    const cards = allTeamCards(rowId, row)
    if (!props.semesterId) return cards
    return cards.filter((card) => card.record.semesterId === props.semesterId)
  }

  function teamAccordionItems(rowId: string, row: ProjectRow) {
    return teamCards(rowId, row).map((card) => ({
      label: teamLabel(card.record),
      value: card.id,
      card,
    }))
  }

  /** Memberships are staged flat on the project row and grouped by team id for display. */
  function memberCards(rowId: string, row: ProjectRow): MergedChild<MemberLike>[] {
    const originals = (row.Teams ?? []).flatMap(
      (team) => (team.Memberships ?? []) as unknown as MemberLike[]
    )
    return staging.mergeChildren<MemberLike>(rowId, 'Memberships', originals, (m) => m.id!)
  }

  function teamMembers(rowId: string, row: ProjectRow, teamId: string, isMentor: boolean) {
    return memberCards(rowId, row).filter(
      (member) => member.record.teamId === teamId && !!member.record.isMentor === isMentor
    )
  }

  const roles = [
    { plural: 'Mentors', singular: 'Mentor', isMentor: true },
    { plural: 'Students', singular: 'Student', isMentor: false },
  ]

  function descriptionValue(rowId: string, row: ProjectRow) {
    return staging.getValue(rowId, 'description', row.description) ?? ''
  }

  function setDescription(rowId: string, row: ProjectRow, value: string) {
    staging.setValue(rowId, 'description', value, row.description)
  }

  function toggleTeamDeleted(rowId: string, teamId: string) {
    staging.toggleChildDeleted(rowId, 'Teams', teamId)
  }

  function undoTeam(rowId: string, teamId: string) {
    staging.dropChild(rowId, 'Teams', teamId)
  }

  function removeMember(rowId: string, memberId: string) {
    staging.toggleChildDeleted(rowId, 'Memberships', memberId)
  }

  function undoMember(rowId: string, memberId: string) {
    staging.dropChild(rowId, 'Memberships', memberId)
  }

  // ---------------------------------------------------- team creation modal

  const teamModalOpen = ref(false)
  const teamModalRowId = ref('')
  const teamSemesterOptions = ref<{ label: string; value: string }[]>([])
  const teamSchema = z.object({
    semesterId: z.string().min(1),
    meetingDay: z.enum(['WEDNESDAY', 'THURSDAY']),
  })
  const teamDraft = reactive({ semesterId: '', meetingDay: 'WEDNESDAY' as MeetingDay })

  function openTeamModal(rowId: string, row: ProjectRow) {
    // A project may hold only one team per semester, so used semesters are not offered again.
    const used = new Set(
      allTeamCards(rowId, row)
        .filter((card) => !card.deleted)
        .map((card) => card.record.semesterId)
    )
    teamSemesterOptions.value = semesters.value
      .filter((semester) => !used.has(semester.id))
      .map((semester) => ({ label: semesterLabel(semester.id), value: semester.id }))
    teamModalRowId.value = rowId
    teamDraft.semesterId = props.semesterId && !used.has(props.semesterId) ? props.semesterId : ''
    teamDraft.meetingDay = 'WEDNESDAY'
    teamModalOpen.value = true
  }

  function submitTeam(event: FormSubmitEvent<z.infer<typeof teamSchema>>) {
    staging.addChild(teamModalRowId.value, 'Teams', {
      semesterId: event.data.semesterId,
      meetingDay: event.data.meetingDay,
    })
    teamModalOpen.value = false
  }

  // -------------------------------------------------- member creation modal

  const memberModalOpen = ref(false)
  const memberModalRowId = ref('')
  const memberModalTeamId = ref('')
  const memberModalIsMentor = ref(false)
  const memberModalTaken = ref<Set<string>>(new Set())
  const memberDraft = ref<StudentRead | undefined>()

  function openMemberModal(rowId: string, row: ProjectRow, teamId: string, isMentor: boolean) {
    memberModalRowId.value = rowId
    memberModalTeamId.value = teamId
    memberModalIsMentor.value = isMentor
    // Staged additions count as taken, so the same student cannot be added twice (§3.1.5).
    memberModalTaken.value = new Set(
      memberCards(rowId, row)
        .filter((member) => member.record.teamId === teamId && !member.deleted)
        .map((member) => member.record.studentId)
    )
    memberDraft.value = undefined
    memberModalOpen.value = true
  }

  async function searchStudents(query: string) {
    const q = query.toLowerCase()
    return allStudents.value
      .filter((student) => !memberModalTaken.value.has(student.id))
      .filter(
        (student) =>
          !q ||
          student.netID.toLowerCase().includes(q) ||
          `${student.firstName} ${student.lastName}`.toLowerCase().includes(q)
      )
      .slice(0, 10)
  }

  function submitMember() {
    if (!memberDraft.value) return
    staging.addChild(memberModalRowId.value, 'Memberships', {
      teamId: memberModalTeamId.value,
      studentId: memberDraft.value.id,
      isMentor: memberModalIsMentor.value,
    })
    memberModalOpen.value = false
  }

  // ------------------------------------------------------ move student modal

  const moveModalOpen = ref(false)
  const moveModalRowId = ref('')
  const moveModalMember = ref<MergedChild<MemberLike> | null>(null)
  const moveModalOptions = ref<{ label: string; value: string }[]>([])
  const moveDestination = ref<string | undefined>()

  function openMoveModal(rowId: string, row: ProjectRow, member: MergedChild<MemberLike>) {
    moveModalRowId.value = rowId
    moveModalMember.value = member
    moveModalOptions.value = teamCards(rowId, row)
      .filter((card) => !card.deleted && card.id !== member.record.teamId)
      .map((card) => ({ label: teamLabel(card.record), value: card.id }))
    moveDestination.value = undefined
    moveModalOpen.value = true
  }

  /** A move is two staged halves: the source membership goes, an identical one arrives (§3.1.6). */
  function submitMove() {
    const member = moveModalMember.value
    const destination = moveDestination.value
    if (!member || !destination) return
    if (member.isNew) staging.dropChild(moveModalRowId.value, 'Memberships', member.id)
    else staging.toggleChildDeleted(moveModalRowId.value, 'Memberships', member.id)
    staging.addChild(moveModalRowId.value, 'Memberships', {
      teamId: destination,
      studentId: member.record.studentId,
      isMentor: !!member.record.isMentor,
    })
    moveModalOpen.value = false
  }

  // -------------------------------------------------------------------- save

  function teamIdOfMembership(projectId: string, membershipId: string) {
    const project = projects.value.find((p) => p.id === projectId)
    for (const team of project?.Teams ?? []) {
      if (team.Memberships.some((m) => m.id === membershipId)) return team.id
    }
    return undefined
  }

  async function onSave(payload: StagedPayload) {
    if (payload.deleted.length) {
      const selected = projects.value.filter((p) => payload.deleted.includes(p.id))
      const ok = await confirm({
        title: `Delete ${payload.deleted.length} project${payload.deleted.length === 1 ? '' : 's'}?`,
        description: 'This will also delete all associated teams and choices.',
        affected: [{ label: 'Team', count: selected.reduce((n, p) => n + p.Teams.length, 0) }],
      })
      if (!ok) return
    }

    saving.value = true
    try {
      for (const record of payload.created) {
        const teams = (record.children.Teams ?? []).filter((team) => !team.deleted)
        const members = record.children.Memberships ?? []
        await $fetch('/api/projects', {
          method: 'POST',
          body: {
            name: record.fields.name,
            description: record.fields.description ?? '',
            type: record.fields.type,
            status: record.fields.status,
            repoURL: record.fields.repoURL ?? '',
            partnerId: record.fields.partnerId,
            Teams: teams.map((team) => ({
              semesterId: team.fields.semesterId,
              meetingDay: team.fields.meetingDay,
              Memberships: members
                .filter((m) => m.isNew && !m.deleted && m.fields.teamId === team.id)
                .map((m) => ({ studentId: m.fields.studentId, isMentor: !!m.fields.isMentor })),
            })),
          },
        })
      }

      for (const record of payload.updated) {
        if (Object.keys(record.fields).length) {
          await $fetch(`/api/projects/${record.id}`, { method: 'PUT', body: record.fields })
        }

        // Teams first: a staged membership may point at a team that does not exist yet.
        const createdTeamIds = new Map<string, string>()
        const deletedTeamIds = new Set<string>()
        for (const team of record.children.Teams ?? []) {
          if (team.isNew) {
            const created = await $fetch<TeamRead>('/api/teams', {
              method: 'POST',
              body: {
                projectId: record.id,
                semesterId: team.fields.semesterId,
                meetingDay: team.fields.meetingDay,
              },
            })
            createdTeamIds.set(team.id, created.id)
          } else if (team.deleted) {
            deletedTeamIds.add(team.id)
            await $fetch(`/api/teams/${team.id}`, { method: 'DELETE' })
          } else if (Object.keys(team.fields).length) {
            await $fetch(`/api/teams/${team.id}`, { method: 'PUT', body: team.fields })
          }
        }

        for (const member of record.children.Memberships ?? []) {
          if (member.isNew) {
            const teamId = createdTeamIds.get(member.fields.teamId) ?? member.fields.teamId
            // A membership staged onto a team that was then deleted has nowhere to go.
            if (deletedTeamIds.has(teamId)) continue
            await $fetch('/api/memberships', {
              method: 'POST',
              body: {
                teamId,
                studentId: member.fields.studentId,
                isMentor: !!member.fields.isMentor,
              },
            })
          } else if (member.deleted) {
            // Deleting the team already cascaded this membership away.
            const teamId = teamIdOfMembership(record.id, member.id)
            if (teamId && deletedTeamIds.has(teamId)) continue
            await $fetch(`/api/memberships/${member.id}`, { method: 'DELETE' })
          }
        }
      }

      for (const id of payload.deleted) {
        await $fetch(`/api/projects/${id}`, { method: 'DELETE' })
      }

      staging.reset()
      await refresh()
    } catch (error: any) {
      toast.add({
        title: 'Save failed',
        description: error?.data?.message ?? error?.message ?? 'Something went wrong.',
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
      :new-row="newRow"
      @save="onSave"
    >
      <template #expanded="{ row, rowId, deleted }">
        <div class="space-y-4 p-3">
          <UFormField label="Description">
            <UTextarea
              :model-value="descriptionValue(rowId, row)"
              :rows="3"
              class="w-full"
              :disabled="deleted || saving"
              :highlight="staging.isFieldEdited(rowId, 'description')"
              :color="staging.isFieldEdited(rowId, 'description') ? 'warning' : undefined"
              @update:model-value="(value: string) => setDescription(rowId, row, value)"
            />
          </UFormField>

          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <h3 class="font-semibold">Teams</h3>
              <UButton
                label="Add Team"
                :icon="ACTION_ICONS.add"
                size="xs"
                variant="soft"
                :disabled="deleted || saving"
                @click="openTeamModal(rowId, row)"
              />
            </div>

            <p v-if="!teamCards(rowId, row).length" class="text-sm text-gray-500">
              {{ semesterId ? 'No team this semester.' : 'No teams yet.' }}
            </p>

            <!-- Semester set: one non-collapsible card. -->
            <template v-else-if="semesterId">
              <div
                v-for="card in teamCards(rowId, row)"
                :key="card.id"
                class="rounded border border-gray-200 dark:border-gray-800"
                :class="TINTS[card.state]"
              >
                <div class="border-b border-gray-200 px-3 py-2 font-medium dark:border-gray-800">
                  {{ teamLabel(card.record) }}
                </div>
                <div class="space-y-3 p-3">
                  <div class="flex gap-1">
                    <UButton
                      v-if="!card.deleted"
                      label="Delete Team"
                      :icon="ACTION_ICONS.delete"
                      size="xs"
                      color="error"
                      variant="ghost"
                      :disabled="deleted || saving"
                      @click="toggleTeamDeleted(rowId, card.id)"
                    />
                    <UButton
                      v-if="card.isNew || card.deleted"
                      label="Undo"
                      :icon="ACTION_ICONS.undo"
                      size="xs"
                      color="neutral"
                      variant="ghost"
                      :disabled="saving"
                      @click="undoTeam(rowId, card.id)"
                    />
                  </div>
                  <div v-for="role in roles" :key="role.plural" class="space-y-1">
                    <div class="flex items-center justify-between">
                      <span class="text-xs font-medium text-gray-500">{{ role.plural }}</span>
                      <UButton
                        :label="`Add ${role.singular}`"
                        :icon="ACTION_ICONS.add"
                        size="xs"
                        variant="ghost"
                        :disabled="deleted || card.deleted || saving"
                        @click="openMemberModal(rowId, row, card.id, role.isMentor)"
                      />
                    </div>
                    <ul class="space-y-1">
                      <li
                        v-for="member in teamMembers(rowId, row, card.id, role.isMentor)"
                        :key="member.id"
                        class="flex items-center justify-between rounded border border-gray-200 p-2 text-sm dark:border-gray-800"
                        :class="TINTS[member.state]"
                      >
                        <span>{{ memberLabel(member.record) }}</span>
                        <div class="flex items-center gap-1">
                          <UButton
                            v-if="!member.deleted"
                            label="Move"
                            :icon="ACTION_ICONS.move"
                            size="xs"
                            color="neutral"
                            variant="ghost"
                            :disabled="deleted || card.deleted || saving"
                            @click="openMoveModal(rowId, row, member)"
                          />
                          <UButton
                            v-if="!member.isNew && !member.deleted"
                            label="Remove"
                            :icon="ACTION_ICONS.delete"
                            size="xs"
                            color="error"
                            variant="ghost"
                            :disabled="deleted || card.deleted || saving"
                            @click="removeMember(rowId, member.id)"
                          />
                          <UButton
                            v-if="member.isNew || member.deleted"
                            label="Undo"
                            :icon="ACTION_ICONS.undo"
                            size="xs"
                            color="neutral"
                            variant="ghost"
                            :disabled="saving"
                            @click="undoMember(rowId, member.id)"
                          />
                        </div>
                      </li>
                      <li
                        v-if="!teamMembers(rowId, row, card.id, role.isMentor).length"
                        class="text-xs text-gray-500"
                      >
                        None
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            </template>

            <!-- Semester unset: every team, most recent first, multi-open. -->
            <UAccordion v-else :items="teamAccordionItems(rowId, row)" type="multiple">
              <template #body="{ item }">
                <div class="space-y-3 rounded p-2" :class="TINTS[item.card.state]">
                  <div class="flex gap-1">
                    <UButton
                      v-if="!item.card.deleted"
                      label="Delete Team"
                      :icon="ACTION_ICONS.delete"
                      size="xs"
                      color="error"
                      variant="ghost"
                      :disabled="deleted || saving"
                      @click="toggleTeamDeleted(rowId, item.card.id)"
                    />
                    <UButton
                      v-if="item.card.isNew || item.card.deleted"
                      label="Undo"
                      :icon="ACTION_ICONS.undo"
                      size="xs"
                      color="neutral"
                      variant="ghost"
                      :disabled="saving"
                      @click="undoTeam(rowId, item.card.id)"
                    />
                  </div>
                  <div v-for="role in roles" :key="role.plural" class="space-y-1">
                    <div class="flex items-center justify-between">
                      <span class="text-xs font-medium text-gray-500">{{ role.plural }}</span>
                      <UButton
                        :label="`Add ${role.singular}`"
                        :icon="ACTION_ICONS.add"
                        size="xs"
                        variant="ghost"
                        :disabled="deleted || item.card.deleted || saving"
                        @click="openMemberModal(rowId, row, item.card.id, role.isMentor)"
                      />
                    </div>
                    <ul class="space-y-1">
                      <li
                        v-for="member in teamMembers(rowId, row, item.card.id, role.isMentor)"
                        :key="member.id"
                        class="flex items-center justify-between rounded border border-gray-200 p-2 text-sm dark:border-gray-800"
                        :class="TINTS[member.state]"
                      >
                        <span>{{ memberLabel(member.record) }}</span>
                        <div class="flex items-center gap-1">
                          <UButton
                            v-if="!member.deleted"
                            label="Move"
                            :icon="ACTION_ICONS.move"
                            size="xs"
                            color="neutral"
                            variant="ghost"
                            :disabled="deleted || item.card.deleted || saving"
                            @click="openMoveModal(rowId, row, member)"
                          />
                          <UButton
                            v-if="!member.isNew && !member.deleted"
                            label="Remove"
                            :icon="ACTION_ICONS.delete"
                            size="xs"
                            color="error"
                            variant="ghost"
                            :disabled="deleted || item.card.deleted || saving"
                            @click="removeMember(rowId, member.id)"
                          />
                          <UButton
                            v-if="member.isNew || member.deleted"
                            label="Undo"
                            :icon="ACTION_ICONS.undo"
                            size="xs"
                            color="neutral"
                            variant="ghost"
                            :disabled="saving"
                            @click="undoMember(rowId, member.id)"
                          />
                        </div>
                      </li>
                      <li
                        v-if="!teamMembers(rowId, row, item.card.id, role.isMentor).length"
                        class="text-xs text-gray-500"
                      >
                        None
                      </li>
                    </ul>
                  </div>
                </div>
              </template>
            </UAccordion>
          </div>
        </div>
      </template>
    </DataTable>

    <UModal v-model:open="teamModalOpen" title="Add Team">
      <template #body>
        <UForm :schema="teamSchema" :state="teamDraft" class="space-y-4" @submit="submitTeam">
          <UFormField label="Semester" name="semesterId">
            <USelectMenu
              v-model="teamDraft.semesterId"
              :items="teamSemesterOptions"
              value-key="value"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Meeting Day" name="meetingDay">
            <URadioGroup
              v-model="teamDraft.meetingDay"
              orientation="horizontal"
              :items="dayOptions"
            />
          </UFormField>
          <div class="flex justify-end gap-2">
            <UButton
              label="Cancel"
              :icon="ACTION_ICONS.cancel"
              color="neutral"
              variant="soft"
              @click="teamModalOpen = false"
            />
            <UButton label="Confirm" :icon="ACTION_ICONS.confirm" type="submit" />
          </div>
        </UForm>
      </template>
    </UModal>

    <UModal
      v-model:open="memberModalOpen"
      :title="memberModalIsMentor ? 'Add Mentor' : 'Add Student'"
    >
      <template #body>
        <div class="space-y-4">
          <RecordSearchInput
            v-model="memberDraft"
            :search="searchStudents"
            :display-label="(s: StudentRead) => `${s.firstName} ${s.lastName} (${s.netID})`"
            placeholder="Search by name or netID…"
          />
          <div class="flex justify-end gap-2">
            <UButton
              label="Cancel"
              :icon="ACTION_ICONS.cancel"
              color="neutral"
              variant="soft"
              @click="memberModalOpen = false"
            />
            <UButton
              label="Confirm"
              :icon="ACTION_ICONS.confirm"
              :disabled="!memberDraft"
              @click="submitMember"
            />
          </div>
        </div>
      </template>
    </UModal>

    <UModal v-model:open="moveModalOpen" title="Move Student">
      <template #body>
        <div class="space-y-4">
          <UFormField label="Destination Team">
            <USelectMenu
              v-model="moveDestination"
              :items="moveModalOptions"
              value-key="value"
              placeholder="Select a team…"
              class="w-full"
            />
          </UFormField>
          <p v-if="!moveModalOptions.length" class="text-sm text-gray-500">
            This project has no other team to move to.
          </p>
          <div class="flex justify-end gap-2">
            <UButton
              label="Cancel"
              :icon="ACTION_ICONS.cancel"
              color="neutral"
              variant="soft"
              @click="moveModalOpen = false"
            />
            <UButton
              label="Confirm"
              :icon="ACTION_ICONS.confirm"
              :disabled="!moveDestination"
              @click="submitMove"
            />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
