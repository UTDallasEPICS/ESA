<script setup lang="ts">
  import { parseCsv, validateBidRows, type BidRowError } from '~/utils/bidCsv'
  import { downloadCsv } from '~/utils/csvExport'
  import { titleCase } from '~/utils/labels'
  import { MEETING_DAY_OPTIONS } from '~/utils/options'
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

  const {
    data: projectsForSemester,
    status: projectsStatus,
    refresh: refreshProjectsForSemester,
  } = useFetch<ProjectRead[]>('/api/projects', {
    query: computed(() => ({ semesterId: semesterId.value })),
    watch: [semesterId],
    default: () => [],
  })

  const teamsForDay = computed(() =>
    projectsForSemester.value.flatMap((project) =>
      project.Teams.filter(
        (t) => t.semesterId === semesterId.value && t.meetingDay === meetingDay.value
      ).map((team) => ({
        id: team.id,
        projectName: project.name,
        partnerName: project.Partner.name,
        memberCount: team.Memberships.length,
      }))
    )
  )

  // Single source of truth for "is this team locked" — reads straight off
  // projectsForSemester (always loaded, not dependent on having clicked Generate
  // Teams this page load) so lock status and the Lock/Unlock button are visible
  // everywhere, not just inside a freshly-generated results view.
  function membershipsForTeam(teamId: string) {
    for (const project of projectsForSemester.value) {
      const team = project.Teams.find((t) => t.id === teamId)
      if (team) return team.Memberships.filter((m) => !m.isMentor)
    }
    return []
  }

  function isTeamLocked(teamId: string) {
    const memberships = membershipsForTeam(teamId)
    return memberships.length > 0 && memberships.every((m) => m.locked)
  }

  const lockingTeamKey = ref<string | null>(null)
  const teamLockError = ref<string | null>(null)

  async function toggleTeamLock(teamId: string, locked: boolean) {
    lockingTeamKey.value = teamId
    teamLockError.value = null
    try {
      await $fetch('/api/team-formation/lock-team', { method: 'POST', body: { teamId, locked } })
      await Promise.all([refreshProjectsForSemester(), refreshStudentsForSemester()])
    } catch (e: any) {
      teamLockError.value = e?.data?.message ?? e?.message ?? 'Failed to update team lock.'
    } finally {
      lockingTeamKey.value = null
    }
  }

  const { data: studentsForSemester, refresh: refreshStudentsForSemester } = useFetch<
    StudentRead[]
  >('/api/students', {
    query: computed(() => ({ semesterId: semesterId.value })),
    watch: [semesterId],
    default: () => [],
  })

  const { data: allProjects, refresh: refreshAllProjects } = useFetch<ProjectRead[]>(
    '/api/projects',
    {
      default: () => [],
    }
  )

  const canExport = computed(() => !!semesterId.value && !!meetingDay.value)

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
        'Skills',
        'Comments',
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
            ...choiceCells,
            enrollment?.major ?? '',
            enrollment ? titleCase(enrollment.year) : '',
            enrollment ? titleCase(enrollment.gender) : '',
            enrollment?.skills.join('; ') ?? '',
            enrollment?.comments ?? '',
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
  } | null>(null)
  const uploading = ref(false)
  const uploadError = ref<string | null>(null)

  watch(bidFile, async (file) => {
    parsedRows.value = []
    parseErrors.value = []
    missingColumns.value = []
    if (!file) return

    // Only clear prior results once a new file is actually chosen, so a successful
    // upload's summary stays visible after we reset `bidFile` below.
    uploadResult.value = null
    uploadError.value = null

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
      // Require an explicit new file selection before another upload can be submitted —
      // otherwise switching the meeting day and re-clicking Upload silently resubmits the
      // same roster under the new day, overwriting those students' enrollment day.
      bidFile.value = null
      await Promise.all([
        refreshProjectsForSemester(),
        refreshAllProjects(),
        refreshStudentsForSemester(),
      ])
    } catch (e: any) {
      uploadError.value = e?.data?.message ?? e?.message ?? 'Failed to import bid file.'
    } finally {
      uploading.value = false
    }
  }

  // ── 3200 lock-in ──────────────────────────────────────────────────────────────

  // Purely visual — collapsing this section never touches lockSelections,
  // suggestions, or anything already locked in the database. Remembered across
  // reloads via localStorage since it's just a per-viewer display preference.
  const lockSectionCollapsed = ref(false)
  onMounted(() => {
    try {
      lockSectionCollapsed.value = localStorage.getItem('esa-lock-section-collapsed') === 'true'
    } catch {
      // localStorage unavailable (private browsing, etc.) — just stay expanded.
    }
  })
  watch(lockSectionCollapsed, (val) => {
    try {
      localStorage.setItem('esa-lock-section-collapsed', String(val))
    } catch {
      // ignore — nothing to persist to
    }
  })

  const students3200ForDay = computed(() =>
    studentsForSemester.value.filter((s) => {
      const enrollment = s.Enrollments.find((e) => e.semesterId === semesterId.value)
      return enrollment?.class === 'EPCS_3200' && enrollment.meetingDay === meetingDay.value
    })
  )

  function lockedMembershipFor(student: StudentRead) {
    return student.Memberships.find(
      (m) =>
        m.locked &&
        m.Team.semesterId === semesterId.value &&
        m.Team.meetingDay === meetingDay.value
    )
  }

  function choiceLabelsFor(student: StudentRead) {
    return student.Choices.filter((c) => c.semesterId === semesterId.value)
      .sort((a, b) => a.rank - b.rank)
      .map((c) => allProjects.value.find((p) => p.id === c.projectId)?.name ?? '')
      .filter(Boolean)
  }

  const SEASON_ORDER: Record<string, number> = { SPRING: 0, SUMMER: 1, FALL: 2 }

  // The project a student most recently worked on in an earlier semester, if any —
  // mirrors the "returning student" logic the solver itself uses, computed here from
  // data already on the student object so the dropdown/labels can show it live.
  function previousProjectFor(student: StudentRead): string | undefined {
    const currentSemester = semesters.value.find((s) => s.id === semesterId.value)
    if (!currentSemester) return undefined
    const currentRank = currentSemester.year * 10 + SEASON_ORDER[currentSemester.season]!

    let best: { rank: number; name: string } | undefined
    for (const m of student.Memberships) {
      if (m.isMentor) continue
      const sem = m.Team.Semester
      const rank = sem.year * 10 + SEASON_ORDER[sem.season]!
      if (rank >= currentRank) continue
      if (!best || rank > best.rank) {
        best = { rank, name: m.Team.Project.name }
      }
    }
    return best?.name
  }

  function ordinal(n: number) {
    if (n % 10 === 1 && n % 100 !== 11) return `${n}st`
    if (n % 10 === 2 && n % 100 !== 12) return `${n}nd`
    if (n % 10 === 3 && n % 100 !== 13) return `${n}rd`
    return `${n}th`
  }

  // Team dropdown options for one student, ordered by THEIR ranking (1st choice on
  // top) and labeled with the rank number, so staff can pick straight off the list
  // instead of cross-referencing the Choices line above. Teams they didn't rank at
  // all sort to the bottom, prefixed with "—" instead of a number. Their returning
  // project (if any) is flagged regardless of where it falls in their ranking.
  function teamOptionsFor(student: StudentRead) {
    const rankByProjectName = new Map(choiceLabelsFor(student).map((name, i) => [name, i + 1]))
    const prevProject = previousProjectFor(student)
    return teamsForDay.value
      .map((t) => ({ team: t, rank: rankByProjectName.get(t.projectName) }))
      .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity))
      .map(({ team, rank }) => {
        const base = rank ? `${rank}. ${team.projectName}` : `Not ranked: ${team.projectName}`
        return {
          label: team.projectName === prevProject ? `${base} ⟲ returning` : base,
          value: team.id,
        }
      })
  }

  // Live label for whatever team is CURRENTLY picked in the dropdown — recomputes as
  // staff changes the selection, whether it started from a suggestion or a manual pick.
  function selectionLabel(student: StudentRead) {
    const teamId = lockSelections[student.id]
    if (!teamId) return null

    const suggestion = suggestions[student.id]
    if (suggestion && suggestion.teamId === teamId) {
      return `Suggested: ${suggestion.reason}`
    }

    const projectName = teamsForDay.value.find((t) => t.id === teamId)?.projectName
    if (!projectName) return null
    const isReturning = projectName === previousProjectFor(student)
    const idx = choiceLabelsFor(student).indexOf(projectName)
    const rankPart = idx === -1 ? 'not one of their ranked choices' : `their ${ordinal(idx + 1)} choice`
    return isReturning ? `This is their returning project, and ${rankPart}` : `This is ${rankPart}`
  }

  const lockSelections = reactive<Record<string, string>>({})
  const lockingKey = ref<string | null>(null)
  const lockError = ref<string | null>(null)

  async function lockStudent(studentId: string) {
    const teamId = lockSelections[studentId]
    if (!teamId) return
    lockingKey.value = studentId
    lockError.value = null
    try {
      await $fetch('/api/team-formation/lock', { method: 'POST', body: { teamId, studentId } })
      await refreshStudentsForSemester()
    } catch (e: any) {
      lockError.value = e?.data?.message ?? e?.message ?? 'Failed to lock student.'
    } finally {
      lockingKey.value = null
    }
  }

  async function unlockMembership(membershipId: string) {
    lockingKey.value = membershipId
    lockError.value = null
    try {
      await $fetch('/api/team-formation/lock', { method: 'DELETE', body: { membershipId } })
      await refreshStudentsForSemester()
    } catch (e: any) {
      lockError.value = e?.data?.message ?? e?.message ?? 'Failed to unlock student.'
    } finally {
      lockingKey.value = null
    }
  }

  // Algorithm-suggested placements for unlocked 3200 students, shown as a pre-filled
  // team choice + a reason staff can review before locking anything in.
  interface Suggestion {
    teamId: string
    reason: string
  }
  const suggestions = reactive<Record<string, Suggestion>>({})
  const noChoiceStudentIds = ref<Set<string>>(new Set())
  const suggesting = ref(false)
  const suggestError = ref<string | null>(null)
  const usedFallbackThirdChoice = ref(false)
  const lockingAllSuggested = ref(false)
  // How many 3200 students a single project can absorb before the suggestion step
  // starts pushing the rest to their next choice — keeps a popular project from
  // soaking up every available 3200 and leaving another project without one.
  const maxUpperclassPerProject = ref(4)

  function reasonFor(placement: { choiceRank: number; isReturning: boolean }) {
    if (placement.isReturning) return 'Returning to their previous project'
    if (placement.choiceRank === 1) return 'Their 1st choice'
    if (placement.choiceRank === 2) return 'Their 2nd choice'
    return `Their ${placement.choiceRank}rd choice, since 1st and 2nd were full`
  }

  async function suggestPlacements() {
    if (!semesterId.value) return
    suggesting.value = true
    suggestError.value = null
    try {
      const result = await $fetch<{
        placements: { studentId: string; teamId: string; choiceRank: number; isReturning: boolean }[]
        noChoicesStudentIds: string[]
        usedFallbackThirdChoice: boolean
      }>('/api/team-formation/suggest-locks', {
        method: 'POST',
        body: {
          semesterId: semesterId.value,
          day: meetingDay.value,
          maxTeamSize: config.max_team_size,
          maxUpperclassPerProject: maxUpperclassPerProject.value,
        },
      })
      for (const key of Object.keys(suggestions)) delete suggestions[key]
      for (const p of result.placements) {
        lockSelections[p.studentId] = p.teamId
        suggestions[p.studentId] = { teamId: p.teamId, reason: reasonFor(p) }
      }
      noChoiceStudentIds.value = new Set(result.noChoicesStudentIds)
      usedFallbackThirdChoice.value = result.usedFallbackThirdChoice
    } catch (e: any) {
      suggestError.value = e?.data?.message ?? e?.message ?? 'Failed to compute suggestions.'
    } finally {
      suggesting.value = false
    }
  }

  async function lockAllSuggested() {
    const studentIds = Object.keys(suggestions)
    lockingAllSuggested.value = true
    lockError.value = null
    try {
      for (const studentId of studentIds) {
        await $fetch('/api/team-formation/lock', {
          method: 'POST',
          body: { teamId: suggestions[studentId]!.teamId, studentId },
        })
        delete suggestions[studentId]
      }
      await refreshStudentsForSemester()
    } catch (e: any) {
      lockError.value = e?.data?.message ?? e?.message ?? 'Failed to lock all suggested students.'
    } finally {
      lockingAllSuggested.value = false
    }
  }

  // ── Team generation ──────────────────────────────────────────────────────────

  const config = reactive({
    min_team_size: 4,
    max_team_size: 6,
    prioritize_returning_students: true,
    prioritize_3200_first_choice: true,
    balance_gender: true,
  })

  // 0 means no minimum enforced. Requiring a 3200 on every team is tight by nature
  // (needs roughly one 3200 per team) and can make a solve infeasible if there
  // genuinely aren't enough 3200 students to go around, so it defaults off.
  const minUpperclassPerProject = ref(1)

  const generating = ref(false)
  const generateError = ref<string | null>(null)
  interface GenerateResponse {
    teamAssignments: Record<
      string,
      {
        id: string
        firstName: string
        lastName: string
        netID: string
        Choices: { projectId: string; rank: number }[]
        Enrollments: { semesterId: string; class: string }[]
      }[]
    >
    projects: { id: string; name: string }[]
    teamMeta: Record<string, { projectId: string; meetingDay: MeetingDay; projectName: string }>
  }
  const generateResult = ref<GenerateResponse | null>(null)

  function is3200(student: { Enrollments: { semesterId: string; class: string }[] }) {
    return student.Enrollments.find((e) => e.semesterId === semesterId.value)?.class === 'EPCS_3200'
  }
  // Off by default so the results view doesn't dump everyone's full ranking in
  // staff's face — flip it on only if you actually want to see choice rank per student.
  const showChoiceRank = ref(false)

  function choiceRankLabel(
    student: { Choices: { projectId: string; rank: number }[] },
    teamId: string
  ) {
    const projectId = generateResult.value?.teamMeta[teamId]?.projectId
    const choice = student.Choices.find((c) => c.projectId === projectId)
    return choice ? `${ordinal(choice.rank)} choice` : 'not ranked'
  }

  const canGenerate = computed(() => !!semesterId.value && teamsForDay.value.length > 0)

  async function generateTeams() {
    if (!canGenerate.value || !semesterId.value) return
    generating.value = true
    generateError.value = null
    generateResult.value = null
    try {
      generateResult.value = await $fetch<GenerateResponse>('/api/team-formation/generate', {
        method: 'POST',
        body: {
          semesterId: semesterId.value,
          day: meetingDay.value,
          config: {
            ...config,
            max_upperclass_per_project: maxUpperclassPerProject.value,
            min_upperclass_per_project: minUpperclassPerProject.value,
          },
        },
      })
      await Promise.all([
        refreshProjectsForSemester(),
        refreshAllProjects(),
        refreshStudentsForSemester(),
      ])
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
        <URadioGroup v-model="meetingDay" orientation="horizontal" :items="MEETING_DAY_OPTIONS" />
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
        <UAlert
          v-if="teamLockError"
          color="error"
          variant="subtle"
          title="Could not update team lock"
          :description="teamLockError"
        />

        <ul v-else class="space-y-1">
          <li
            v-for="team in teamsForDay"
            :key="team.id"
            class="flex flex-wrap items-center justify-between gap-2 rounded border border-gray-200 p-2 text-sm dark:border-gray-800"
          >
            <span>
              {{ team.projectName }} ({{ team.partnerName }})
              <UBadge v-if="isTeamLocked(team.id)" color="primary" variant="subtle" size="sm">Locked</UBadge>
            </span>
            <div class="flex items-center gap-2">
              <span class="text-gray-500">{{ team.memberCount }} member(s)</span>
              <UButton
                v-if="team.memberCount > 0"
                :label="isTeamLocked(team.id) ? 'Unlock Team' : 'Lock Team'"
                size="xs"
                :color="isTeamLocked(team.id) ? 'neutral' : 'primary'"
                :variant="isTeamLocked(team.id) ? 'soft' : 'solid'"
                :loading="lockingTeamKey === team.id"
                @click="toggleTeamLock(team.id, !isTeamLocked(team.id))"
              />
            </div>
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
          :title="`${parseErrors.length} error(s) found. Upload aborted.`"
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
      </div>
    </section>

    <USeparator />

    <section class="space-y-4">
      <div class="flex items-center justify-between gap-2">
        <h2 class="text-lg font-semibold">3. Lock 3200 Students</h2>
        <UButton
          :label="lockSectionCollapsed ? 'Show' : 'Hide'"
          :icon="lockSectionCollapsed ? 'i-heroicons-chevron-down' : 'i-heroicons-chevron-up'"
          size="xs"
          color="neutral"
          variant="ghost"
          @click="lockSectionCollapsed = !lockSectionCollapsed"
        />
      </div>

      <p v-if="lockSectionCollapsed" class="text-sm text-gray-500">
        Hidden. Your locks and selections are untouched. Click "Show" to bring it back.
      </p>

      <div v-else class="space-y-4">
      <p class="text-sm text-gray-500">
        Place specific 3200 students into a team ahead of time. Locked students are
        skipped by the solver below and kept as is. Everyone else, including any
        3200 students you leave unlocked, is assigned by Team Generation.
      </p>

      <p v-if="!semesterId" class="text-sm text-gray-500">Select a semester above first.</p>



<div v-if="semesterId" class="space-y-4">
  <UCheckbox
    :model-value="minUpperclassPerProject >= 1"
    label="Force at least one CS 3200 student per team"
    @update:model-value="minUpperclassPerProject = $event ? 1 : 0"
  />

  <UFormField label="Max 3200 per Project">
    <UInputNumber
      v-model="maxUpperclassPerProject"
      :min="minUpperclassPerProject || 1"
      class="w-full"
    />
  </UFormField>
</div>



      <div v-if="semesterId" class="flex flex-wrap items-end gap-2">
        <UButton
          label="Suggest Placements"
          icon="i-heroicons-light-bulb"
          color="neutral"
          variant="soft"
          :loading="suggesting"
          @click="suggestPlacements"
        />
        <UButton
          v-if="Object.keys(suggestions).length"
          label="Lock All Suggested"
          icon="i-heroicons-lock-closed"
          :loading="lockingAllSuggested"
          @click="lockAllSuggested"
        />
      </div>
      <p class="text-sm text-gray-500">
        "Suggest Placements" runs the algorithm on just the unlocked 3200 students,
        guaranteeing each one their 1st or 2nd choice whenever possible, and pre-fills
        the team below with a reason. Review it, then lock individually or all at once.
        Max above also applies when you hit Generate Teams later, so a popular project
        can't absorb all the 3200s and leave another project without one. Min is 0 by
        default (no requirement) since it's tight by nature (roughly one 3200 per
        project) and only applies to Generate Teams. Set it above 0 if you want every
        project guaranteed that many. It fails with a clear message if there genuinely
        aren't enough 3200 students to meet it.
      </p>

      <UAlert
        v-if="suggestError"
        color="error"
        variant="subtle"
        title="Could not compute suggestions"
        :description="suggestError"
      />
      <UAlert
        v-if="usedFallbackThirdChoice"
        color="warning"
        variant="subtle"
        title="Some students required their 3rd choice"
        description="Capacity didn't allow 1st/2nd choice for everyone. Check which students show a 3rd-choice reason below before locking."
      />

      <UAlert
        v-if="lockError"
        color="error"
        variant="subtle"
        title="Lock/unlock failed"
        :description="lockError"
      />

      <p
        v-else-if="semesterId && !students3200ForDay.length"
        class="text-sm text-gray-500"
      >
        No 3200 students enrolled for this semester/day.
      </p>

      <ul v-else-if="semesterId" class="space-y-2">
        <li
          v-for="student in students3200ForDay"
          :key="student.id"
          class="flex flex-wrap items-center justify-between gap-2 rounded border border-gray-200 p-2 text-sm dark:border-gray-800"
        >
          <div>
            <div class="font-medium">
              {{ student.firstName }} {{ student.lastName }} ({{ student.netID }})
            </div>
            <div v-if="!lockedMembershipFor(student) && selectionLabel(student)" class="text-primary-500">
              {{ selectionLabel(student) }}
            </div>
            <div
              v-else-if="!lockedMembershipFor(student) && noChoiceStudentIds.has(student.id)"
              class="text-amber-500"
            >
              No bid submitted. Needs manual placement.
            </div>
          </div>

          <div v-if="lockedMembershipFor(student)" class="flex items-center gap-2">
            <UBadge color="primary" variant="subtle">
              Locked: {{ lockedMembershipFor(student)!.Team.Project.name }}
            </UBadge>
            <UButton
              label="Unlock"
              size="xs"
              color="neutral"
              variant="soft"
              :loading="lockingKey === lockedMembershipFor(student)!.id"
              @click="unlockMembership(lockedMembershipFor(student)!.id)"
            />
          </div>
          <div v-else class="flex items-center gap-2">
            <USelect
              v-model="lockSelections[student.id]"
              :items="teamOptionsFor(student)"
              placeholder="Choose team"
              class="w-64"
            />
            <UButton
              label="Lock"
              size="xs"
              :disabled="!lockSelections[student.id]"
              :loading="lockingKey === student.id"
              @click="lockStudent(student.id)"
            />
          </div>
        </li>
      </ul>
      </div>
    </section>

    <USeparator />

    <section class="space-y-4">
      <h2 class="text-lg font-semibold">4. Team Generation</h2>

      <div class="grid grid-cols-2 gap-4">
        <UFormField label="Min Team Size">
          <UInputNumber v-model="config.min_team_size" :min="1" class="w-full" />
        </UFormField>
        <UFormField label="Max Team Size">
          <UInputNumber v-model="config.max_team_size" :min="config.min_team_size" class="w-full" />
        </UFormField>
      </div>

      <div class="grid grid-cols-2 gap-2">
        <UCheckbox
          v-model="config.prioritize_returning_students"
          label="Prioritize returning students"
        />
        <UCheckbox
          v-model="config.prioritize_3200_first_choice"
          label="Prioritize 3200 first choice"
        />
        <UCheckbox v-model="config.balance_gender" label="Balance gender" />
      </div>

      <p class="text-sm text-gray-500">
        3200-per-project range is set in section 3 above (currently
        {{ minUpperclassPerProject }} to {{ maxUpperclassPerProject }}) and applies here too.
      </p>

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
        <UAlert color="success" variant="subtle" title="Teams generated successfully" />
        <p class="text-sm text-gray-500">
          Happy with a team? Lock it, then hit Generate Teams again. Locked teams are
          left exactly as is, and the algorithm only re-solves for everyone else. Keep
          locking and regenerating as many rounds as you want.
        </p>

        <UCheckbox
          v-model="showChoiceRank"
          label="Show each student's choice rank for their assigned project"
        />

        <UAlert
          v-if="teamLockError"
          color="error"
          variant="subtle"
          title="Could not update team lock"
          :description="teamLockError"
        />

        <div class="space-y-2">
          <div
            v-for="[teamId, meta] in Object.entries(generateResult.teamMeta)"
            :key="teamId"
            class="rounded border border-gray-200 p-3 dark:border-gray-800"
          >
            <div class="mb-1 flex items-center justify-between gap-2">
              <div class="flex items-center gap-2 font-medium">
                {{ meta.projectName }}
                <UBadge v-if="isTeamLocked(teamId)" color="primary" variant="subtle" size="sm">Locked</UBadge>
              </div>
              <UButton
                :label="isTeamLocked(teamId) ? 'Unlock Team' : 'Lock Team'"
                size="xs"
                :color="isTeamLocked(teamId) ? 'neutral' : 'primary'"
                :variant="isTeamLocked(teamId) ? 'soft' : 'solid'"
                :loading="lockingTeamKey === teamId"
                @click="toggleTeamLock(teamId, !isTeamLocked(teamId))"
              />
            </div>
            <ul class="text-sm text-gray-600 dark:text-gray-400">
              <li v-for="student in studentsFor(teamId)" :key="student.netID">
                {{ student.firstName }} {{ student.lastName }} ({{ student.netID }})
                <UBadge v-if="is3200(student)" color="primary" variant="subtle" size="sm">3200</UBadge>
                <span v-if="showChoiceRank" class="text-gray-400">
                  ({{ choiceRankLabel(student, teamId) }})
                </span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  </UContainer>
</template>
