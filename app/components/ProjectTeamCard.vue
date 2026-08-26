<script setup lang="ts">
  import { ACTION_ICONS } from '~/utils/icons'
  import { STAGE_TINTS, type MergedChild } from '~/composables/useStagedChanges'
  import { studentLabel } from '~/utils/labels'
  import type { MembershipRead } from '#server/services/membershipService'
  import type { ProjectRead } from '#server/services/projectService'
  import type { TeamRead } from '#server/services/teamService'
  import { useRowStaging } from '~/composables/useRowStaging'
  import { useAllStudents } from '~/composables/useDirectory'

  type TeamLike = Partial<TeamRead> & { semesterId: string; meetingDay: TeamRead['meetingDay'] }
  type MemberLike = Partial<MembershipRead> & {
    teamId: string
    studentId: string
    isMentor: boolean
  }

  const props = defineProps<{
    rowId: string
    row: ProjectRead
    card: MergedChild<TeamLike>
    /** The project row itself is marked for deletion. */
    disabled?: boolean
  }>()

  const emit = defineEmits<{
    'add-member': [teamId: string, isMentor: boolean]
    'move-member': [member: MergedChild<MemberLike>]
  }>()

  const { staging, saving } = useRowStaging()
  const { data: allStudents } = useAllStudents()

  const roles = [
    { plural: 'Mentors', singular: 'Mentor', isMentor: true },
    { plural: 'Students', singular: 'Student', isMentor: false },
  ]

  function memberLabel(member: MemberLike) {
    const student = member.Student ?? allStudents.value.find((s) => s.id === member.studentId)
    return student ? studentLabel(student) : 'Unknown student'
  }

  /** Memberships are staged flat on the project row and grouped by team id for display. */
  function teamMembers(isMentor: boolean) {
    const originals = (props.row.Teams ?? []).flatMap(
      (team) => (team.Memberships ?? []) as unknown as MemberLike[]
    )
    return staging
      .mergeChildren<MemberLike>(props.rowId, 'Memberships', originals, (m) => m.id!)
      .filter(
        (member) => member.record.teamId === props.card.id && !!member.record.isMentor === isMentor
      )
  }
</script>

<template>
  <div class="space-y-3">
    <div class="flex gap-1">
      <UButton
        v-if="card.state === 'clean' || card.state === 'edited'"
        label="Delete Team"
        :icon="ACTION_ICONS.delete"
        size="xs"
        color="error"
        variant="ghost"
        :disabled="disabled || saving"
        @click="staging.markChildDeleted(rowId, 'Teams', card.id)"
      />
      <UButton
        v-if="card.state !== 'clean'"
        label="Undo"
        :icon="ACTION_ICONS.undo"
        size="xs"
        color="neutral"
        variant="ghost"
        :disabled="saving"
        @click="staging.undoChild(rowId, 'Teams', card.id)"
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
          :disabled="disabled || card.deleted || saving"
          @click="emit('add-member', card.id, role.isMentor)"
        />
      </div>
      <ul class="space-y-1">
        <li
          v-for="member in teamMembers(role.isMentor)"
          :key="member.id"
          class="flex items-center justify-between rounded border border-gray-200 p-2 text-sm dark:border-gray-800"
          :class="STAGE_TINTS[member.state]"
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
              :disabled="disabled || card.deleted || saving"
              @click="emit('move-member', member)"
            />
            <UButton
              v-if="!member.isNew && !member.deleted"
              label="Remove"
              :icon="ACTION_ICONS.delete"
              size="xs"
              color="error"
              variant="ghost"
              :disabled="disabled || card.deleted || saving"
              @click="staging.markChildDeleted(rowId, 'Memberships', member.id)"
            />
            <UButton
              v-if="member.state !== 'clean'"
              label="Undo"
              :icon="ACTION_ICONS.undo"
              size="xs"
              color="neutral"
              variant="ghost"
              :disabled="saving"
              @click="staging.undoChild(rowId, 'Memberships', member.id)"
            />
          </div>
        </li>
        <li v-if="!teamMembers(role.isMentor).length" class="text-xs text-gray-500">None</li>
      </ul>
    </div>
  </div>
</template>
