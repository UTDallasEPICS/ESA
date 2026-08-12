<script setup lang="ts">
  import { parseCsv, validateBidRows, type BidRowError } from '~/utils/bidCsv'
  import { downloadCsv } from '~/utils/csvExport'
  import type { ProjectRead } from '#server/services/projectService'
  import type { StudentRead } from '#server/services/studentService'

  type MeetingDay = 'WEDNESDAY' | 'THURSDAY'

  // ── Semester & meeting day ───────────────────────────────────────────────────

  const semesterId = ref<string | undefined>()
  const meetingDay = ref<MeetingDay>('WEDNESDAY')

  const { semesters } = useSemesters()
  const selectedSemesterLabel = computed(() => {
    const semester = semesters.value.find((s) => s.id === semesterId.value)
    if (!semester) return 'semester'
    const season = semester.season[0] + semester.season.slice(1).toLowerCase()
    return `${season}-${semester.year}`
  })

  const { data: projectsForSemester, status: projectsStatus } = useFetch<ProjectRead[]>(
    '/api/projects',
    {
      query: computed(() => ({ semesterId: semesterId.value })),
      watch: [semesterId],
      default: () => [],
    }
  )

  const teamsForDay = computed(() =>
    projectsForSemester.value.flatMap((project) =>
      project.Teams.filter((t) => t.meetingDay === meetingDay.value).map((team) => ({
        id: team.id,
        projectName: project.name,
        partnerName: project.Partner.name,
        memberCount: team.Memberships.length,
      }))
    )
  )

  const { data: studentsForSemester } = useFetch<StudentRead[]>('/api/students', {
    query: computed(() => ({ semesterId: semesterId.value })),
    watch: [semesterId],
    default: () => [],
  })

  const { data: allProjects } = useFetch<ProjectRead[]>('/api/projects', {
    default: () => [],
  })

  const canExport = computed(() => !!semesterId.value && !!meetingDay.value)

  function titleCase(value: string) {
    return value[0] + value.slice(1).toLowerCase()
  }

  function seasonCode(season: string) {
    if (season === 'SPRING') return 'S'
    if (season === 'SUMMER') return 'U'
    if (season === 'FALL') return 'F'
    return season[0]
  }

  const CHOICE_COLUMN_COUNT = 6

  function exportTeams() {
    const semester = semesters.value.find((s) => s.id === semesterId.value)
    if (!semester) return

    const term = `${seasonCode(semester.season)}${String(semester.year).slice(-2)}`
    const projectLabelById = new Map(
      allProjects.value.map((p) => [p.id, `${term} - ${p.Partner.name}: ${p.name}`])
    )
    const studentById = new Map(studentsForSemester.value.map((s) => [s.id, s]))

    const rows: string[][] = [
      [
        'Team',
        'Student',
        ...Array.from({ length: CHOICE_COLUMN_COUNT }, (_, i) => `Choice ${i + 1}`),
        'Student Major',
        'Student Classification',
        'Gender',
      ],
    ]

    for (const project of projectsForSemester.value) {
      const teamLabel =
        projectLabelById.get(project.id) ?? `${term} - ${project.Partner.name}: ${project.name}`

      for (const team of project.Teams) {
        if (team.meetingDay !== meetingDay.value) continue

        for (const membership of team.Memberships) {
          const student = studentById.get(membership.studentId)
          const enrollment = student?.Enrollments.find((e) => e.semesterId === semesterId.value)

          const choices = (student?.Choices ?? [])
            .filter((c) => c.semesterId === semesterId.value)
            .sort((a, b) => a.rank - b.rank)
            .map((c) => projectLabelById.get(c.projectId) ?? '')
          const choiceCells = Array.from(
            { length: CHOICE_COLUMN_COUNT },
            (_, i) => choices[i] ?? ''
          )

          rows.push([
            teamLabel,
            `${membership.Student.lastName}, ${membership.Student.firstName}`,
            ...choices,
            enrollment?.major ?? '',
            enrollment ? titleCase(enrollment.year) : '',
            enrollment ? titleCase(enrollment.gender) : '',
          ])
        }
      }
    }

    const dayLabel = meetingDay.value === 'WEDNESDAY' ? 'Wed' : 'Thu'
    downloadCsv(`${dayLabel} Teams - ${selectedSemesterLabel.value}.csv`, rows)
  }

  // ── Bid file upload ──────────────────────────────────────────────────────────

  const bidFile = ref<File | null>(null)
  const parsedRows = ref<Record<string, string>[]>([])
  const parseErrors = ref<BidRowError[]>([])
  const missingColumns = ref<string[]>([])
  const uploadResult = ref<{
    studentsImported: number
    choicesCreated: number
    skippedStudents: string[]
    unmatchedProjects: string[]
  } | null>(null)
  const uploading = ref(false)
  const uploadError = ref<string | null>(null)

  watch(bidFile, async (file) => {
    uploadResult.value = null
    uploadError.value = null
    parsedRows.value = []
    parseErrors.value = []
    missingColumns.value = []
    if (!file) return

    const text = await file.text()
    const rows = parseCsv(text)
    const validation = validateBidRows(rows)
    missingColumns.value = validation.missingColumns
    parseErrors.value = validation.errors
    if (!validation.missingColumns.length && !validation.errors.length) {
      parsedRows.value = rows
    }
  })

  const canUpload = computed(
    () =>
      !!semesterId.value &&
      parsedRows.value.length > 0 &&
      !parseErrors.value.length &&
      !missingColumns.value.length
  )

  async function submitBidFile() {
    if (!canUpload.value || !semesterId.value) return
    uploading.value = true
    uploadError.value = null
    try {
      uploadResult.value = await $fetch('/api/team-formation/bids', {
        method: 'POST',
        query: { semesterId: semesterId.value, meetingDay: meetingDay.value },
        body: parsedRows.value,
      })
    } catch (e: any) {
      uploadError.value = e?.data?.message ?? e?.message ?? 'Failed to import bid file.'
    } finally {
      uploading.value = false
    }
  }

  // ── Team generation ──────────────────────────────────────────────────────────

  const config = reactive({
    min_team_size: 4,
    max_team_size: 6,
    allow_overflow_if_needed: true,
    prioritize_returning_students: true,
    prioritize_3200_first_choice: true,
    prefer_major_diversity: true,
    match_skills: true,
    balance_gender: true,
    prefer_2200_early_choices: true,
  })

  const generating = ref(false)
  const generateError = ref<string | null>(null)
  interface GenerateResponse {
    teamAssignments: Record<string, { firstName: string; lastName: string; netID: string }[]>
    projects: { id: string; name: string }[]
    teamMeta: Record<string, { projectId: string; meetingDay: MeetingDay; projectName: string }>
    fallback: {
      solverWarning: string | null
      deactivatedProjects: string[]
      noChoiceStudentsReassigned: number
      rebalancedMoveCount: number
    }
  }
  const generateResult = ref<GenerateResponse | null>(null)

  const canGenerate = computed(() => !!semesterId.value && teamsForDay.value.length > 0)

  const fallbackNotice = computed(() => {
    const fb = generateResult.value?.fallback
    if (!fb) return null
    const notes: string[] = []
    if (fb.solverWarning) notes.push(fb.solverWarning)
    if (fb.deactivatedProjects.length)
      notes.push(
        `Deactivated projects (could not be staffed): ${fb.deactivatedProjects.join(', ')}`
      )
    if (fb.noChoiceStudentsReassigned > 0)
      notes.push(
        `${fb.noChoiceStudentsReassigned} student(s) had no valid choices and were placed by fallback logic.`
      )
    if (fb.rebalancedMoveCount > 0)
      notes.push(
        `${fb.rebalancedMoveCount} student(s) were moved between teams to satisfy minimum team size.`
      )
    return notes.length ? notes : null
  })

  async function generateTeams() {
    if (!canGenerate.value || !semesterId.value) return
    generating.value = true
    generateError.value = null
    generateResult.value = null
    try {
      generateResult.value = await $fetch<GenerateResponse>('/api/team-formation/generate', {
        method: 'POST',
        body: { semesterId: semesterId.value, day: meetingDay.value, config },
      })
    } catch (e: any) {
      generateError.value = e?.data?.message ?? e?.message ?? 'Team generation failed.'
    } finally {
      generating.value = false
    }
  }

  function studentsFor(teamId: string) {
    return generateResult.value?.teamAssignments[teamId] ?? []
  }
</script>

<template>
  <UContainer class="max-w-4xl space-y-10 py-8">
    <section class="space-y-4">
      <h2 class="text-lg font-semibold">1. Semester & Meeting Day</h2>

      <UFormField label="Semester">
        <SemesterFilter v-model="semesterId" />
      </UFormField>

      <UFormField label="Meeting Day">
        <URadioGroup
          v-model="meetingDay"
          orientation="horizontal"
          :items="[
            { label: 'Wednesday', value: 'WEDNESDAY' },
            { label: 'Thursday', value: 'THURSDAY' },
          ]"
        />
      </UFormField>

      <UButton
        label="Export Teams"
        icon="i-heroicons-arrow-down-tray"
        color="neutral"
        variant="soft"
        :disabled="!canExport"
        @click="exportTeams"
      />

      <div v-if="semesterId" class="space-y-2">
        <h3 class="font-medium">Teams already entered for this semester/day</h3>
        <UAlert
          v-if="projectsStatus !== 'pending' && !teamsForDay.length"
          icon="i-heroicons-exclamation-triangle"
          color="warning"
          variant="subtle"
          title="No teams found"
          description="Create projects and teams for this semester/day in the Database tab before continuing."
        />
        <ul v-else class="space-y-1">
          <li
            v-for="team in teamsForDay"
            :key="team.id"
            class="flex items-center justify-between rounded border border-gray-200 p-2 text-sm dark:border-gray-800"
          >
            <span>{{ team.projectName }} — {{ team.partnerName }}</span>
            <span class="text-gray-500">{{ team.memberCount }} member(s)</span>
          </li>
        </ul>
      </div>
    </section>

    <USeparator />

    <section class="space-y-4">
      <h2 class="text-lg font-semibold">2. Bid File</h2>

      <UFormField label="Bid Response CSV">
        <UFileUpload
          v-model="bidFile"
          accept=".csv"
          label="Drop CSV here or click to browse"
          :disabled="!semesterId"
        />
      </UFormField>
      <p v-if="!semesterId" class="text-sm text-gray-500">Select a semester above first.</p>

      <UAlert
        v-if="missingColumns.length"
        color="error"
        variant="subtle"
        title="Missing required columns"
        :description="missingColumns.join(', ')"
      />

      <div v-else-if="parseErrors.length" class="space-y-2">
        <UAlert
          color="error"
          variant="subtle"
          :title="`${parseErrors.length} error(s) found — upload aborted`"
        />
        <ul class="max-h-64 space-y-1 overflow-y-auto text-sm">
          <li v-for="(err, i) in parseErrors" :key="i" class="text-red-600 dark:text-red-400">
            Row {{ err.row }}: {{ err.message }}
          </li>
        </ul>
      </div>

      <UAlert
        v-else-if="parsedRows.length"
        color="success"
        variant="subtle"
        :title="`${parsedRows.length} row(s) validated successfully`"
      />

      <UButton
        label="Upload"
        icon="i-heroicons-arrow-up-tray"
        :loading="uploading"
        :disabled="!canUpload || uploading"
        @click="submitBidFile"
      />

      <UAlert
        v-if="uploadError"
        color="error"
        variant="subtle"
        title="Upload failed"
        :description="uploadError"
      />

      <div v-if="uploadResult" class="space-y-2">
        <UAlert
          color="success"
          variant="subtle"
          title="Import complete"
          :description="`${uploadResult.studentsImported} student(s) imported, ${uploadResult.choicesCreated} choice(s) recorded.`"
        />
        <UAlert
          v-if="uploadResult.skippedStudents.length"
          color="warning"
          variant="subtle"
          title="Skipped rows (missing SSO ID)"
          :description="uploadResult.skippedStudents.join(', ')"
        />
        <UAlert
          v-if="uploadResult.unmatchedProjects.length"
          color="warning"
          variant="subtle"
          title="Unmatched project choices"
          :description="uploadResult.unmatchedProjects.join(', ')"
        />
      </div>
    </section>

    <USeparator />

    <section class="space-y-4">
      <h2 class="text-lg font-semibold">3. Team Generation</h2>

      <div class="grid grid-cols-2 gap-4">
        <UFormField label="Min Team Size">
          <UInputNumber v-model="config.min_team_size" :min="1" class="w-full" />
        </UFormField>
        <UFormField label="Max Team Size">
          <UInputNumber v-model="config.max_team_size" :min="config.min_team_size" class="w-full" />
        </UFormField>
      </div>

      <div class="grid grid-cols-2 gap-2">
        <UCheckbox v-model="config.allow_overflow_if_needed" label="Allow overflow if needed" />
        <UCheckbox
          v-model="config.prioritize_returning_students"
          label="Prioritize returning students"
        />
        <UCheckbox
          v-model="config.prioritize_3200_first_choice"
          label="Prioritize 3200 first choice"
        />
        <UCheckbox v-model="config.prefer_major_diversity" label="Prefer major diversity" />
        <UCheckbox v-model="config.match_skills" label="Match skills" />
        <UCheckbox v-model="config.balance_gender" label="Balance gender" />
        <UCheckbox v-model="config.prefer_2200_early_choices" label="Prefer 2200 early choices" />
      </div>

      <UButton
        label="Generate Teams"
        icon="i-heroicons-sparkles"
        :loading="generating"
        :disabled="!canGenerate || generating"
        @click="generateTeams"
      />
      <p v-if="!canGenerate" class="text-sm text-gray-500">
        Select a semester/day with at least one team above first.
      </p>

      <UAlert
        v-if="generateError"
        color="error"
        variant="subtle"
        title="Team generation failed"
        :description="generateError"
      />

      <div v-if="generateResult" class="space-y-4">
        <UAlert
          v-if="fallbackNotice"
          icon="i-heroicons-exclamation-triangle"
          color="warning"
          variant="subtle"
          title="Hard constraints could not be fully satisfied — fallback logic was used"
        >
          <template #description>
            <ul class="list-inside list-disc space-y-1">
              <li v-for="(note, i) in fallbackNotice" :key="i">{{ note }}</li>
            </ul>
          </template>
        </UAlert>
        <UAlert v-else color="success" variant="subtle" title="Teams generated successfully" />

        <div class="space-y-2">
          <div
            v-for="[teamId, meta] in Object.entries(generateResult.teamMeta)"
            :key="teamId"
            class="rounded border border-gray-200 p-3 dark:border-gray-800"
          >
            <div class="mb-1 font-medium">{{ meta.projectName }}</div>
            <ul class="text-sm text-gray-600 dark:text-gray-400">
              <li v-for="student in studentsFor(teamId)" :key="student.netID">
                {{ student.firstName }} {{ student.lastName }} ({{ student.netID }})
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  </UContainer>
</template>
