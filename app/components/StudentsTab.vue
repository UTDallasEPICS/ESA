<script setup lang="ts">
  import { z } from 'zod'
  import type { FormSubmitEvent } from '@nuxt/ui'
  import type { DataTableColumn } from '~/components/DataTable.vue'
  import { ACTION_ICONS } from '~/utils/icons'
  import type { StudentRead } from '#server/services/studentService'
  import type { ProjectRead } from '#server/services/projectService'
  import type { ChoiceRead } from '#server/services/choiceService'

  const props = defineProps<{ semesterId?: string }>()

  interface StudentRow extends StudentRead {
    semesterRole?: string
    meetingDay?: string
  }

  const {
    data: students,
    refresh,
    status,
  } = useFetch<StudentRead[]>('/api/students', {
    query: computed(() => ({ semesterId: props.semesterId })),
    default: () => [],
  })

  const { data: allProjects } = useFetch<ProjectRead[]>('/api/projects', {
    key: 'projects-all',
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

  function studentSemesterInfo(student: StudentRead, semesterId: string) {
    const enrollment = student.Enrollments.find((e) => e.semesterId === semesterId)
    const mentorMembership = student.Memberships.find(
      (m) => m.isMentor && m.Team.semesterId === semesterId
    )
    if (mentorMembership) return { role: 'Mentor', meetingDay: mentorMembership.Team.meetingDay }
    if (enrollment) return { role: 'Student', meetingDay: enrollment.meetingDay }
    return undefined
  }

  const rows = computed<StudentRow[]>(() =>
    students.value.map((student) => {
      const info = props.semesterId ? studentSemesterInfo(student, props.semesterId) : undefined
      return {
        ...student,
        semesterRole: info?.role,
        meetingDay: info?.meetingDay,
      }
    })
  )

  const columns = computed<DataTableColumn<StudentRow>[]>(() => {
    const base: DataTableColumn<StudentRow>[] = [
      {
        id: 'netID',
        header: 'NetID',
        accessorKey: 'netID',
        sortable: true,
        filter: { type: 'search' },
        editable: { type: 'text' },
      },
      {
        id: 'firstName',
        header: 'First Name',
        accessorKey: 'firstName',
        sortable: true,
        filter: { type: 'search' },
        editable: { type: 'text' },
      },
      {
        id: 'lastName',
        header: 'Last Name',
        accessorKey: 'lastName',
        sortable: true,
        filter: { type: 'search' },
        editable: { type: 'text' },
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
    if (props.semesterId) {
      base.push(
        { id: 'semesterRole', header: 'Role', accessorKey: 'semesterRole', sortable: true },
        { id: 'meetingDay', header: 'Meeting Day', accessorKey: 'meetingDay', sortable: true }
      )
    }
    return base
  })

  const confirm = useConfirm()

  async function onDeleteRequest(ids: string[]) {
    const selected = rows.value.filter((s) => ids.includes(s.id))
    const ok = await confirm({
      title: `Delete ${ids.length} student${ids.length === 1 ? '' : 's'}?`,
      description: 'This will also delete all associated enrollments, choices, and memberships.',
      affected: [
        { label: 'Enrollment', count: selected.reduce((n, s) => n + s.Enrollments.length, 0) },
        { label: 'Choice', count: selected.reduce((n, s) => n + s.Choices.length, 0) },
        { label: 'Membership', count: selected.reduce((n, s) => n + s.Memberships.length, 0) },
      ],
    })
    if (!ok) return
    await Promise.all(ids.map((id) => $fetch(`/api/students/${id}`, { method: 'DELETE' })))
    await refresh()
  }

  async function onSaveEdits(edits: Record<string, Record<string, any>>) {
    await Promise.all(
      Object.entries(edits).map(([id, changes]) =>
        $fetch(`/api/students/${id}`, { method: 'PUT', body: changes })
      )
    )
    await refresh()
  }

  // Creation panel
  const panelOpen = ref(false)

  const createSchema = z.object({
    netID: z.string().min(1),
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    email: z.string().email().optional().or(z.literal('')),
    discord: z.string().optional(),
    isMentor: z.boolean(),
  })
  const draft = reactive({
    netID: '',
    firstName: '',
    lastName: '',
    email: '',
    discord: '',
    isMentor: false,
  })

  function openCreatePanel() {
    Object.assign(draft, {
      netID: '',
      firstName: '',
      lastName: '',
      email: '',
      discord: '',
      isMentor: false,
    })
    panelOpen.value = true
  }

  async function onPanelConfirm() {
    const body = {
      netID: draft.netID,
      firstName: draft.firstName,
      lastName: draft.lastName,
      email: draft.email || undefined,
      discord: draft.discord || undefined,
      isMentor: draft.isMentor,
    }
    await $fetch('/api/students', { method: 'POST', body })
    panelOpen.value = false
    await refresh()
  }

  // Semester info cards
  interface SemesterCard {
    semesterId: string
    label: string
    role: 'Mentor' | 'Student'
    meetingDay: string
    choices: ChoiceRead[]
  }

  function semesterCardsFor(student: StudentRow): SemesterCard[] {
    const byKey = new Map<string, SemesterCard>()
    for (const e of student.Enrollments) {
      byKey.set(`${e.semesterId}:Student`, {
        semesterId: e.semesterId,
        label: semesterLabel(e.semesterId),
        role: 'Student',
        meetingDay: e.meetingDay,
        choices: student.Choices.filter((c) => c.semesterId === e.semesterId).sort(
          (a, b) => a.rank - b.rank
        ),
      })
    }
    for (const m of student.Memberships.filter((m) => m.isMentor)) {
      byKey.set(`${m.Team.semesterId}:Mentor`, {
        semesterId: m.Team.semesterId,
        label: semesterLabel(m.Team.semesterId),
        role: 'Mentor',
        meetingDay: m.Team.meetingDay,
        choices: [],
      })
    }
    return [...byKey.values()]
      .filter((c) => !props.semesterId || c.semesterId === props.semesterId)
      .sort((a, b) => semesterSortKey(b.semesterId) - semesterSortKey(a.semesterId))
  }

  function accordionItemsFor(student: StudentRow) {
    return semesterCardsFor(student).map((card) => ({
      label: `${card.label} — ${card.role}`,
      value: `${card.semesterId}:${card.role}`,
      disabled: card.role === 'Mentor',
      card,
    }))
  }

  function projectName(projectId: string) {
    return allProjects.value.find((p) => p.id === projectId)?.name ?? 'Unknown Project'
  }

  async function moveChoice(choice: ChoiceRead, direction: -1 | 1) {
    await $fetch(`/api/choices/${choice.id}`, {
      method: 'PUT',
      body: { rank: choice.rank + direction },
    })
    await refresh()
  }

  async function deleteChoice(choiceId: string) {
    await $fetch(`/api/choices/${choiceId}`, { method: 'DELETE' })
    await refresh()
  }

  // Team preference (choice) creation modal
  const choiceModalOpen = ref(false)
  const choiceModalStudentId = ref<string | null>(null)
  const choiceModalCard = ref<SemesterCard | null>(null)
  const choiceDraft = ref<ProjectRead | undefined>()

  function openChoiceModal(student: StudentRow, card: SemesterCard) {
    choiceModalStudentId.value = student.id
    choiceModalCard.value = card
    choiceDraft.value = undefined
    choiceModalOpen.value = true
  }

  async function searchTeamsForCard(query: string) {
    if (!choiceModalCard.value || !choiceModalStudentId.value) return []
    const student = students.value.find((s) => s.id === choiceModalStudentId.value)
    if (!student) return []
    const semesterId = choiceModalCard.value.semesterId
    const existing = new Set(
      student.Choices.filter((c) => c.semesterId === semesterId).map((c) => c.projectId)
    )
    const q = query.toLowerCase()
    return allProjects.value
      .filter((p) => p.Teams.some((t) => t.semesterId === semesterId))
      .filter((p) => !existing.has(p.id))
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.Partner.name.toLowerCase().includes(q))
      .slice(0, 10)
  }

  async function submitChoice() {
    if (!choiceModalCard.value || !choiceModalStudentId.value || !choiceDraft.value) return
    const student = students.value.find((s) => s.id === choiceModalStudentId.value)
    if (!student) return
    const rank =
      Math.max(
        0,
        ...student.Choices.filter((c) => c.semesterId === choiceModalCard.value!.semesterId).map(
          (c) => c.rank
        )
      ) + 1
    await $fetch('/api/choices', {
      method: 'POST',
      body: {
        studentId: student.id,
        projectId: choiceDraft.value.id,
        semesterId: choiceModalCard.value.semesterId,
        rank,
      },
    })
    choiceModalOpen.value = false
    await refresh()
  }

  // Semester Info creation modal
  const infoModalOpen = ref(false)
  const infoModalStudent = ref<StudentRow | null>(null)
  const infoSchema = z.object({
    semesterId: z.string().min(1),
    meetingDay: z.enum(['WEDNESDAY', 'THURSDAY']),
    role: z.enum(['STUDENT', 'MENTOR']),
    major: z.string().min(1).optional(),
    year: z.enum(['FRESHMAN', 'SOPHOMORE', 'JUNIOR', 'SENIOR']).optional(),
    class: z.enum(['EPCS_2200', 'EPCS_3200']).optional(),
    gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
  })
  const infoDraft = reactive({
    semesterId: '',
    meetingDay: 'WEDNESDAY' as 'WEDNESDAY' | 'THURSDAY',
    role: 'STUDENT' as 'STUDENT' | 'MENTOR',
    major: '',
    year: 'FRESHMAN' as 'FRESHMAN' | 'SOPHOMORE' | 'JUNIOR' | 'SENIOR',
    class: 'EPCS_2200' as 'EPCS_2200' | 'EPCS_3200',
    gender: 'OTHER' as 'MALE' | 'FEMALE' | 'OTHER',
  })
  const infoTeamDraft = ref<ProjectRead | undefined>()

  function openInfoModal(student: StudentRow) {
    infoModalStudent.value = student
    Object.assign(infoDraft, {
      semesterId: '',
      meetingDay: 'WEDNESDAY',
      role: 'STUDENT',
      major: '',
      year: 'FRESHMAN',
      class: 'EPCS_2200',
      gender: 'OTHER',
    })
    infoTeamDraft.value = undefined
    infoModalOpen.value = true
  }

  async function searchTeamsForSemester(query: string) {
    if (!infoDraft.semesterId) return []
    const q = query.toLowerCase()
    return allProjects.value
      .filter((p) => p.Teams.some((t) => t.semesterId === infoDraft.semesterId))
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.Partner.name.toLowerCase().includes(q))
      .slice(0, 10)
  }

  async function submitInfo(event: FormSubmitEvent<z.infer<typeof infoSchema>>) {
    if (!infoModalStudent.value) return
    if (event.data.role === 'STUDENT') {
      await $fetch('/api/enrollments', {
        method: 'POST',
        body: {
          studentId: infoModalStudent.value.id,
          semesterId: event.data.semesterId,
          meetingDay: event.data.meetingDay,
          major: infoDraft.major,
          year: infoDraft.year,
          class: infoDraft.class,
          gender: infoDraft.gender,
        },
      })
    } else {
      const team = infoTeamDraft.value?.Teams.find((t) => t.semesterId === infoDraft.semesterId)
      if (!team) return
      await $fetch('/api/memberships', {
        method: 'POST',
        body: { teamId: team.id, studentId: infoModalStudent.value.id, isMentor: true },
      })
    }
    infoModalOpen.value = false
    await refresh()
  }
</script>

<template>
  <div>
    <DataTable
      :data="rows"
      :columns="columns"
      :row-key="(row) => row.id"
      :loading="status === 'pending'"
      expandable
      @add="openCreatePanel"
      @delete-request="onDeleteRequest"
      @save-edits="onSaveEdits"
    >
      <template #expanded="{ row }">
        <div class="space-y-4 p-3">
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <h3 class="font-semibold">Semester Info</h3>
              <UButton
                label="Add Semester Info"
                :icon="ACTION_ICONS.add"
                size="xs"
                variant="soft"
                @click="openInfoModal(row)"
              />
            </div>

            <UAccordion :items="accordionItemsFor(row)" type="multiple">
              <template #body="{ item }">
                <div v-if="item.card.role === 'Student'" class="space-y-2 p-2">
                  <div class="flex items-center justify-between">
                    <span class="text-xs text-gray-500">Team Preferences</span>
                    <UButton
                      label="Add Preference"
                      :icon="ACTION_ICONS.add"
                      size="xs"
                      variant="ghost"
                      @click="openChoiceModal(row, item.card)"
                    />
                  </div>
                  <ul class="space-y-1">
                    <li
                      v-for="choice in item.card.choices"
                      :key="choice.id"
                      class="flex items-center justify-between rounded border border-gray-200 p-2 text-sm dark:border-gray-800"
                    >
                      <span>#{{ choice.rank }} {{ projectName(choice.projectId) }}</span>
                      <div class="flex gap-1">
                        <UButton
                          icon="i-heroicons-arrow-up"
                          size="xs"
                          variant="ghost"
                          @click="moveChoice(choice, -1)"
                        />
                        <UButton
                          icon="i-heroicons-arrow-down"
                          size="xs"
                          variant="ghost"
                          @click="moveChoice(choice, 1)"
                        />
                        <UButton
                          label="Remove"
                          :icon="ACTION_ICONS.delete"
                          size="xs"
                          color="error"
                          variant="ghost"
                          @click="deleteChoice(choice.id)"
                        />
                      </div>
                    </li>
                  </ul>
                </div>
              </template>
            </UAccordion>
          </div>
        </div>
      </template>
    </DataTable>

    <RecordPanel v-model:open="panelOpen" title="New Student" @confirm="onPanelConfirm">
      <div class="grid grid-cols-2 gap-4">
        <UFormField label="NetID"><UInput v-model="draft.netID" class="w-full" /></UFormField>
        <UFormField label="First Name">
          <UInput v-model="draft.firstName" class="w-full" />
        </UFormField>
        <UFormField label="Last Name"><UInput v-model="draft.lastName" class="w-full" /></UFormField>
        <UFormField label="Email"><UInput v-model="draft.email" class="w-full" /></UFormField>
        <UFormField label="Discord"><UInput v-model="draft.discord" class="w-full" /></UFormField>
        <UFormField label="Is Mentor?">
          <USwitch v-model="draft.isMentor" label="Is Mentor?" />
        </UFormField>
      </div>
    </RecordPanel>

    <UModal v-model:open="choiceModalOpen" title="Add Team Preference">
      <template #body>
        <div class="space-y-4">
          <RecordSearchInput
            v-model="choiceDraft"
            :search="searchTeamsForCard"
            :display-label="(p) => `${p.name} (${p.Partner.name})`"
            placeholder="Search by project or partner name…"
          />
          <div class="flex justify-end gap-2">
            <UButton
              label="Cancel"
              :icon="ACTION_ICONS.cancel"
              color="neutral"
              variant="soft"
              @click="choiceModalOpen = false"
            />
            <UButton
              label="Confirm"
              :icon="ACTION_ICONS.confirm"
              :disabled="!choiceDraft"
              @click="submitChoice"
            />
          </div>
        </div>
      </template>
    </UModal>

    <UModal v-model:open="infoModalOpen" title="Add Semester Info">
      <template #body>
        <UForm :schema="infoSchema" :state="infoDraft" class="space-y-4" @submit="submitInfo">
          <UFormField label="Semester" name="semesterId">
            <USelectMenu
              v-model="infoDraft.semesterId"
              :items="semesters.map((s) => ({ label: `${s.season} ${s.year}`, value: s.id }))"
              value-key="value"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Meeting Day" name="meetingDay">
            <USelectMenu
              v-model="infoDraft.meetingDay"
              :items="[
                { label: 'Wednesday', value: 'WEDNESDAY' },
                { label: 'Thursday', value: 'THURSDAY' },
              ]"
              value-key="value"
              class="w-full"
            />
          </UFormField>
          <UFormField v-if="infoModalStudent?.isMentor" label="Role" name="role">
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
            <UFormField label="Major" name="major">
              <UInput v-model="infoDraft.major" class="w-full" />
            </UFormField>
            <UFormField label="Year" name="year">
              <USelectMenu
                v-model="infoDraft.year"
                :items="['FRESHMAN', 'SOPHOMORE', 'JUNIOR', 'SENIOR']"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Class" name="class">
              <USelectMenu v-model="infoDraft.class" :items="['EPCS_2200', 'EPCS_3200']" class="w-full" />
            </UFormField>
            <UFormField label="Gender" name="gender">
              <USelectMenu v-model="infoDraft.gender" :items="['MALE', 'FEMALE', 'OTHER']" class="w-full" />
            </UFormField>
          </template>
          <UFormField v-else label="Team">
            <RecordSearchInput
              v-model="infoTeamDraft"
              :search="searchTeamsForSemester"
              :display-label="(p) => `${p.name} (${p.Partner.name})`"
              placeholder="Search by project or partner name…"
            />
          </UFormField>

          <div class="flex justify-end gap-2">
            <UButton
              label="Cancel"
              :icon="ACTION_ICONS.cancel"
              color="neutral"
              variant="soft"
              @click="infoModalOpen = false"
            />
            <UButton label="Confirm" :icon="ACTION_ICONS.confirm" type="submit" />
          </div>
        </UForm>
      </template>
    </UModal>
  </div>
</template>
