<script setup lang="ts">
  import { z } from 'zod'
  import type { FormSubmitEvent } from '@nuxt/ui'
  import type { DataTableColumn } from '~/components/DataTable.vue'
  import { ACTION_ICONS } from '~/utils/icons'
  import type { ProjectRead } from '#server/services/projectService'
  import type { TeamRead } from '#server/services/teamService'
  import type { StudentRead } from '#server/services/studentService'

  const props = defineProps<{ semesterId?: string }>()

  const {
    data: projects,
    refresh,
    status,
  } = useFetch<ProjectRead[]>('/api/projects', {
    query: computed(() => ({ semesterId: props.semesterId })),
    default: () => [],
  })

  const { data: allStudents } = useFetch<StudentRead[]>('/api/students', {
    key: 'students-all',
    default: () => [],
  })

  const { semesters } = useSemesters()

  function semesterLabel(id: string) {
    const s = semesters.value.find((s) => s.id === id)
    if (!s) return 'Unknown Semester'
    return `${s.season[0]}${s.season.slice(1).toLowerCase()} ${s.year}`
  }

  function semesterSortKey(id: string) {
    const s = semesters.value.find((s) => s.id === id)
    if (!s) return 0
    const order = { SPRING: 0, SUMMER: 1, FALL: 2 } as const
    return s.year * 10 + order[s.season]
  }

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

  const columns: DataTableColumn<ProjectRead>[] = [
    {
      id: 'name',
      header: 'Name',
      accessorKey: 'name',
      sortable: true,
      filter: { type: 'search' },
      clickable: true,
    },
    {
      id: 'description',
      header: 'Description',
      accessorKey: 'description',
      filter: { type: 'search' },
      editable: { type: 'text' },
    },
    {
      id: 'type',
      header: 'Type',
      accessorKey: 'type',
      sortable: true,
      filter: { type: 'multiselect', options: typeOptions },
      editable: { type: 'select', options: typeOptions },
    },
    {
      id: 'status',
      header: 'Status',
      accessorKey: 'status',
      sortable: true,
      filter: { type: 'multiselect', options: statusOptions },
      editable: { type: 'select', options: statusOptions },
    },
    {
      id: 'repoURL',
      header: 'GitHub Link',
      accessorKey: 'repoURL',
      editable: { type: 'text' },
    },
  ]

  const confirm = useConfirm()

  async function onDeleteRequest(ids: string[]) {
    const selected = projects.value.filter((p) => ids.includes(p.id))
    const ok = await confirm({
      title: `Delete ${ids.length} project${ids.length === 1 ? '' : 's'}?`,
      description: 'This will also delete all associated teams and choices.',
      affected: [{ label: 'Team', count: selected.reduce((n, p) => n + p.Teams.length, 0) }],
    })
    if (!ok) return
    await Promise.all(ids.map((id) => $fetch(`/api/projects/${id}`, { method: 'DELETE' })))
    await refresh()
  }

  async function onSaveEdits(edits: Record<string, Record<string, any>>) {
    await Promise.all(
      Object.entries(edits).map(([id, changes]) =>
        $fetch(`/api/projects/${id}`, { method: 'PUT', body: changes })
      )
    )
    await refresh()
  }

  // Item / creation panel
  const panelOpen = ref(false)
  const panelMode = ref<'view' | 'create'>('create')
  const selected = ref<ProjectRead | null>(null)

  const createSchema = z.object({
    name: z.string().min(1),
    description: z.string().min(1),
    type: z.enum(['SOFTWARE', 'HARDWARE', 'BOTH']),
    status: z.enum(['NEW', 'RETURNING', 'COMPLETE', 'WITHDRAWN', 'HOLD']),
    repoURL: z.string().min(1),
    partnerId: z.string().min(1),
  })
  const draft = reactive({
    name: '',
    description: '',
    type: 'SOFTWARE' as 'SOFTWARE' | 'HARDWARE' | 'BOTH',
    status: 'NEW' as 'NEW' | 'RETURNING' | 'COMPLETE' | 'WITHDRAWN' | 'HOLD',
    repoURL: '',
    partnerId: '',
  })

  const { data: allPartners } = useFetch('/api/partners', {
    key: 'partners-all',
    default: () => [],
  })

  function openCreatePanel() {
    panelMode.value = 'create'
    selected.value = null
    Object.assign(draft, {
      name: '',
      description: '',
      type: 'SOFTWARE',
      status: 'NEW',
      repoURL: '',
      partnerId: '',
    })
    panelOpen.value = true
  }

  function onRowClick(row: ProjectRead) {
    panelMode.value = 'view'
    selected.value = row
    Object.assign(draft, {
      name: row.name,
      description: row.description,
      type: row.type,
      status: row.status,
      repoURL: row.repoURL,
      partnerId: row.partnerId,
    })
    panelOpen.value = true
  }

  async function onPanelConfirm() {
    if (panelMode.value === 'create') {
      await $fetch('/api/projects', { method: 'POST', body: draft })
    } else if (selected.value) {
      const { partnerId, ...rest } = draft
      await $fetch(`/api/projects/${selected.value.id}`, { method: 'PUT', body: rest })
    }
    panelOpen.value = false
    await refresh()
  }

  async function onPanelDelete() {
    if (!selected.value) return
    const ok = await confirm({
      title: `Delete ${selected.value.name}?`,
      description: 'This will also delete all associated teams and choices.',
      affected: [{ label: 'Team', count: selected.value.Teams.length }],
    })
    if (!ok) return
    await $fetch(`/api/projects/${selected.value.id}`, { method: 'DELETE' })
    panelOpen.value = false
    await refresh()
  }

  function refreshSelected() {
    selected.value = projects.value.find((p) => p.id === selected.value?.id) ?? null
  }

  const panelTeams = computed(() => {
    if (!selected.value) return []
    return [...selected.value.Teams]
      .filter((t) => !props.semesterId || t.semesterId === props.semesterId)
      .sort((a, b) => semesterSortKey(b.semesterId) - semesterSortKey(a.semesterId))
  })

  const teamAccordionItems = computed(() =>
    panelTeams.value.map((team) => ({
      label: `${semesterLabel(team.semesterId)} — ${team.meetingDay[0]}${team.meetingDay.slice(1).toLowerCase()}`,
      value: team.id,
      team,
    }))
  )

  // Team creation modal
  const teamModalOpen = ref(false)
  const teamSchema = z.object({
    semesterId: z.string().min(1),
    meetingDay: z.enum(['WEDNESDAY', 'THURSDAY']),
  })
  const teamDraft = reactive({ semesterId: '', meetingDay: 'WEDNESDAY' as 'WEDNESDAY' | 'THURSDAY' })

  function openTeamModal() {
    teamDraft.semesterId = ''
    teamDraft.meetingDay = 'WEDNESDAY'
    teamModalOpen.value = true
  }

  async function submitTeam(event: FormSubmitEvent<z.infer<typeof teamSchema>>) {
    if (!selected.value) return
    await $fetch('/api/teams', {
      method: 'POST',
      body: { projectId: selected.value.id, ...event.data },
    })
    teamModalOpen.value = false
    await refresh()
    refreshSelected()
  }

  async function deleteTeam(teamId: string) {
    await $fetch(`/api/teams/${teamId}`, { method: 'DELETE' })
    await refresh()
    refreshSelected()
  }

  // Membership (mentor/student) creation modal
  const memberModalOpen = ref(false)
  const memberModalTeam = ref<TeamRead | null>(null)
  const memberIsMentor = ref(false)
  const memberDraft = ref<StudentRead | undefined>()

  function openMemberModal(team: TeamRead, isMentor: boolean) {
    memberModalTeam.value = team
    memberIsMentor.value = isMentor
    memberDraft.value = undefined
    memberModalOpen.value = true
  }

  async function searchStudents(query: string) {
    if (!memberModalTeam.value) return []
    const existing = new Set(memberModalTeam.value.Memberships.map((m) => m.studentId))
    const q = query.toLowerCase()
    return allStudents.value
      .filter((s) => !existing.has(s.id))
      .filter(
        (s) =>
          !q ||
          s.netID.toLowerCase().includes(q) ||
          `${s.firstName} ${s.lastName}`.toLowerCase().includes(q)
      )
      .slice(0, 10)
  }

  async function submitMember() {
    if (!memberModalTeam.value || !memberDraft.value) return
    await $fetch('/api/memberships', {
      method: 'POST',
      body: {
        teamId: memberModalTeam.value.id,
        studentId: memberDraft.value.id,
        isMentor: memberIsMentor.value,
      },
    })
    memberModalOpen.value = false
    await refresh()
    refreshSelected()
  }

  async function removeMember(membershipId: string) {
    await $fetch(`/api/memberships/${membershipId}`, { method: 'DELETE' })
    await refresh()
    refreshSelected()
  }
</script>

<template>
  <div>
    <DataTable
      :data="projects"
      :columns="columns"
      :row-key="(row) => row.id"
      :loading="status === 'pending'"
      @add="openCreatePanel"
      @delete-request="onDeleteRequest"
      @save-edits="onSaveEdits"
      @row-click="onRowClick"
    />

    <RecordPanel
      v-model:open="panelOpen"
      :title="panelMode === 'create' ? 'New Project' : (selected?.name ?? 'Project')"
      :mode="panelMode"
      @confirm="onPanelConfirm"
      @delete="onPanelDelete"
    >
      <div class="space-y-6">
        <div class="grid grid-cols-2 gap-4">
          <UFormField label="Name" class="col-span-2">
            <UInput v-model="draft.name" class="w-full" />
          </UFormField>
          <UFormField label="Description" class="col-span-2">
            <UTextarea v-model="draft.description" class="w-full" />
          </UFormField>
          <UFormField label="Type">
            <USelectMenu v-model="draft.type" :items="typeOptions" value-key="value" class="w-full" />
          </UFormField>
          <UFormField label="Status">
            <USelectMenu v-model="draft.status" :items="statusOptions" value-key="value" class="w-full" />
          </UFormField>
          <UFormField label="GitHub Link" class="col-span-2">
            <UInput v-model="draft.repoURL" class="w-full" />
          </UFormField>
          <UFormField v-if="panelMode === 'create'" label="Partner" class="col-span-2">
            <USelectMenu
              v-model="draft.partnerId"
              :items="allPartners.map((p) => ({ label: p.name, value: p.id }))"
              value-key="value"
              class="w-full"
            />
          </UFormField>
        </div>

        <div v-if="panelMode === 'view'" class="space-y-2">
          <div class="flex items-center justify-between">
            <h3 class="font-semibold">Teams</h3>
            <UButton :icon="ACTION_ICONS.add" size="xs" variant="soft" @click="openTeamModal" />
          </div>

          <UAccordion :items="teamAccordionItems" type="multiple">
            <template #body="{ item }">
              <div class="space-y-3 p-2">
                <UButton
                  :icon="ACTION_ICONS.delete"
                  label="Delete Team"
                  size="xs"
                  color="error"
                  variant="ghost"
                  @click="deleteTeam(item.team.id)"
                />
                <div v-for="role in ['Mentors', 'Students']" :key="role">
                  <div class="flex items-center justify-between">
                    <span class="text-xs font-medium text-gray-500">{{ role }}</span>
                    <UButton
                      :icon="ACTION_ICONS.add"
                      size="xs"
                      variant="ghost"
                      @click="openMemberModal(item.team, role === 'Mentors')"
                    />
                  </div>
                  <ul class="space-y-1">
                    <li
                      v-for="membership in item.team.Memberships.filter(
                        (m) => m.isMentor === (role === 'Mentors')
                      )"
                      :key="membership.id"
                      class="flex items-center justify-between rounded border border-gray-200 p-2 text-sm dark:border-gray-800"
                    >
                      {{ membership.Student.firstName }} {{ membership.Student.lastName }}
                      <UButton
                        :icon="ACTION_ICONS.delete"
                        size="xs"
                        color="error"
                        variant="ghost"
                        @click="removeMember(membership.id)"
                      />
                    </li>
                  </ul>
                </div>
              </div>
            </template>
          </UAccordion>
        </div>
      </div>
    </RecordPanel>

    <UModal v-model:open="teamModalOpen" title="Add Team">
      <template #body>
        <UForm :schema="teamSchema" :state="teamDraft" class="space-y-4" @submit="submitTeam">
          <UFormField label="Semester" name="semesterId">
            <USelectMenu
              v-model="teamDraft.semesterId"
              :items="semesters.map((s) => ({ label: `${s.season} ${s.year}`, value: s.id }))"
              value-key="value"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Meeting Day" name="meetingDay">
            <URadioGroup
              v-model="teamDraft.meetingDay"
              orientation="horizontal"
              :items="[
                { label: 'Wednesday', value: 'WEDNESDAY' },
                { label: 'Thursday', value: 'THURSDAY' },
              ]"
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

    <UModal v-model:open="memberModalOpen" :title="memberIsMentor ? 'Add Mentor' : 'Add Student'">
      <template #body>
        <div class="space-y-4">
          <RecordSearchInput
            v-model="memberDraft"
            :search="searchStudents"
            :display-label="(s) => `${s.firstName} ${s.lastName} (${s.netID})`"
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
  </div>
</template>
