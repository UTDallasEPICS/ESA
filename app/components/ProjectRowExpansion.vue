<script setup lang="ts">
  import { ACTION_ICONS } from '~/utils/icons'
  import type { MembershipRead } from '#server/services/membershipService'
  import type { ProjectRead } from '#server/services/projectService'
  import type { TeamRead } from '#server/services/teamService'

  type TeamLike = Partial<TeamRead> & { semesterId: string; meetingDay: TeamRead['meetingDay'] }
  type MemberLike = Partial<MembershipRead> & {
    teamId: string
    studentId: string
    isMentor: boolean
  }

  const props = defineProps<{
    rowId: string
    row: ProjectRead
    /** The project row itself is marked for deletion. */
    disabled?: boolean
  }>()

  const { staging, saving } = useRowStaging()
  const { semesterId } = useSemesterFilter()
  const { semesters, semesterLabel, semesterSortKey, teamLabel } = useSemesterLookup()
  const { data: allStudents } = useAllStudents()
  const { data: allProjects } = useAllProjects()
  const { openTeamModal, openMemberModal, openMoveModal } = useRecordModals()

  // ------------------------------------------------------------------- teams

  /** Every team on the project — fetched ones with their staged edits, then staged-new ones. */
  const allTeamCards = computed(() =>
    staging.children
      .merge<TeamLike>(props.rowId, 'Teams')
      .sort((a, b) => semesterSortKey(b.record.semesterId) - semesterSortKey(a.record.semesterId))
  )

  /** The cards actually rendered: one semester's team when the filter is set, else all (§3.1.3). */
  const teamCards = computed(() =>
    semesterId.value
      ? allTeamCards.value.filter((card) => card.record.semesterId === semesterId.value)
      : allTeamCards.value
  )

  const accordionItems = computed(() =>
    teamCards.value.map((card) => ({ label: teamLabel(card.record), value: card.id, card }))
  )

  // ------------------------------------------------------------- description

  function descriptionValue() {
    return staging.fields.get(props.rowId, 'description') ?? ''
  }

  function setDescription(value: string) {
    staging.fields.set(props.rowId, 'description', value)
  }

  // ------------------------------------------------------------------ modals

  async function addTeam() {
    // A project may hold only one team per semester, so used semesters are not offered again.
    const used = new Set(
      allTeamCards.value.filter((card) => !card.deleted).map((card) => card.record.semesterId)
    )
    const draft = await openTeamModal({
      semesters: semesters.value
        .filter((semester) => !used.has(semester.id))
        .map((semester) => ({ label: semesterLabel(semester.id), value: semester.id })),
      defaultSemesterId:
        semesterId.value && !used.has(semesterId.value) ? semesterId.value : undefined,
    })
    if (draft) staging.children.add(props.rowId, 'Teams', draft)
  }

  function stagedMembers() {
    return staging.children.merge<MemberLike>(props.rowId, 'Memberships')
  }

  async function addMember(teamId: string, isMentor: boolean) {
    // Staged additions count as taken, so the same student cannot be added twice (§3.1.5).
    const taken = new Set(
      stagedMembers()
        .filter((member) => member.record.teamId === teamId && !member.deleted)
        .map((member) => member.record.studentId)
    )
    const student = await openMemberModal({
      title: isMentor ? 'Add Mentor' : 'Add Student',
      students: allStudents.value.filter((s) => !taken.has(s.id) && (!isMentor || s.isMentor)),
    })
    if (student) {
      staging.children.add(props.rowId, 'Memberships', { teamId, studentId: student.id, isMentor })
    }
  }

  /**
   * The destination choices for a move: every other team, across every project, that meets on the
   * same day in the same semester as the team the member is leaving — not just this project's own
   * teams, and not gated by the ambient semester filter, which would leave nothing to move to when
   * a filter is set.
   */
  function moveDestinations(sourceTeamId: string) {
    const source = allTeamCards.value.find((card) => card.id === sourceTeamId)?.record
    if (!source) return []
    return allProjects.value.flatMap((project) =>
      (project.Teams ?? [])
        .filter(
          (team) =>
            team.id !== sourceTeamId &&
            team.semesterId === source.semesterId &&
            team.meetingDay === source.meetingDay
        )
        .map((team) => ({ label: `${project.name} — ${teamLabel(team)}`, value: team.id }))
    )
  }

  /** A move is two staged halves: the source membership goes, an identical one arrives (§3.1.6). */
  async function moveMember(member: MergedChild<MemberLike>) {
    const destination = await openMoveModal({
      teams: moveDestinations(member.record.teamId),
    })
    if (!destination) return
    if (member.isNew) staging.children.undo(props.rowId, 'Memberships', member.id)
    else staging.children.markDeleted(props.rowId, 'Memberships', member.id)
    staging.children.add(props.rowId, 'Memberships', {
      teamId: destination,
      studentId: member.record.studentId,
      isMentor: !!member.record.isMentor,
    })
  }
</script>

<template>
  <div class="space-y-4 p-3">
    <UFormField label="Description">
      <UTextarea
        :model-value="descriptionValue()"
        :rows="3"
        class="w-full"
        :disabled="disabled || saving"
        :highlight="staging.fields.isEdited(rowId, 'description')"
        :color="staging.fields.isEdited(rowId, 'description') ? 'warning' : undefined"
        @update:model-value="setDescription"
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
          :disabled="disabled || saving"
          @click="addTeam"
        />
      </div>

      <p v-if="!teamCards.length" class="text-sm text-gray-500">
        {{ semesterId ? 'No team this semester.' : 'No teams yet.' }}
      </p>

      <!-- Semester set: one non-collapsible card. -->
      <template v-else-if="semesterId">
        <div
          v-for="card in teamCards"
          :key="card.id"
          class="rounded border border-gray-200 dark:border-gray-800"
          :class="STAGE_TINTS[card.state]"
        >
          <div class="border-b border-gray-200 px-3 py-2 font-medium dark:border-gray-800">
            {{ teamLabel(card.record) }}
          </div>
          <ProjectTeamCard
            class="p-3"
            :row-id="rowId"
            :row="row"
            :card="card"
            :disabled="disabled"
            @add-member="addMember"
            @move-member="moveMember"
          />
        </div>
      </template>

      <!-- Semester unset: every team, most recent first, multi-open. -->
      <UAccordion v-else :items="accordionItems" type="multiple">
        <template #body="{ item }">
          <ProjectTeamCard
            class="rounded p-2"
            :class="STAGE_TINTS[item.card.state]"
            :row-id="rowId"
            :row="row"
            :card="item.card"
            :disabled="disabled"
            @add-member="addMember"
            @move-member="moveMember"
          />
        </template>
      </UAccordion>
    </div>
  </div>
</template>
