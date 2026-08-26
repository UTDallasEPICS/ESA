<script setup lang="ts">
  import { ACTION_ICONS } from '~/utils/icons'
  import { STAGE_TINTS } from '~/composables/useStagedChanges'
  import {
    type ChoiceEntry,
    type SemesterCard,
    type StudentRow,
    useSemesterCards,
  } from '~/composables/useSemesterCards'
  import { ENROLLMENT_FIELDS } from '~/utils/options'
  import { projectLabel } from '~/utils/labels'
  import { searchProjects } from '~/utils/search'
  import type { ProjectRead } from '#server/services/projectService'
  import { useRowStaging } from '~/composables/useRowStaging'
  import { useAllProjects } from '~/composables/useDirectory'
  import { useRecordModals } from '~/composables/useRecordModals'
  import { useSemesterLookup } from '~/composables/useSemesters'

  const props = defineProps<{
    rowId: string
    row: StudentRow
    card: SemesterCard
    choices: ChoiceEntry[]
    /** The student row itself is marked for deletion. */
    disabled?: boolean
  }>()

  const { staging, saving } = useRowStaging()
  const { data: allProjects } = useAllProjects()
  const { openProjectPicker } = useRecordModals()
  const { semesterLabel, semesterSortKey } = useSemesterLookup()
  const { teamProject, setTeam, deleteCard, undoCard, moveChoice } = useSemesterCards({
    staging,
    projects: allProjects,
    semesterLabel,
    semesterSortKey,
  })

  // --------------------------------------------------------- enrollment fields

  function enrollmentValue(childId: string, field: string) {
    return staging.children.get(props.rowId, 'Enrollments', childId, field)
  }

  function setEnrollmentValue(childId: string, field: string, value: any) {
    staging.children.set(props.rowId, 'Enrollments', childId, field, value)
  }

  function enrollmentEdited(childId: string, field: string) {
    return staging.children.isEdited(props.rowId, 'Enrollments', childId, field)
  }

  // ---------------------------------------------------------------- team field

  async function searchTeams(query: string) {
    return searchProjects(allProjects.value, query, { semesterId: props.card.semesterId })
  }

  function onSetTeam(project?: ProjectRead) {
    setTeam(props.row, props.rowId, props.card, project)
  }

  // ----------------------------------------------------------- team preferences

  function projectName(projectId: string) {
    return allProjects.value.find((project) => project.id === projectId)?.name ?? 'Unknown Project'
  }

  async function addPreference() {
    // Staged-deleted picks stay excluded: re-creating one in the same batch would collide with the
    // choice that has not been deleted server side yet.
    const taken = new Set(props.choices.map((entry) => entry.projectId))
    const project = await openProjectPicker({
      title: 'Add Team Preference',
      projects: searchProjects(allProjects.value, '', {
        semesterId: props.card.semesterId,
        exclude: taken,
      }),
    })
    if (!project) return
    const rank = Math.max(0, ...props.choices.map((entry) => entry.rank)) + 1
    staging.children.add(props.rowId, 'Choices', {
      semesterId: props.card.semesterId,
      projectId: project.id,
      rank,
      baseRank: rank,
    })
  }
</script>

<template>
  <div class="space-y-3 p-2">
    <div class="flex justify-end gap-1">
      <UButton
        v-if="card.state !== 'clean'"
        label="Undo"
        :icon="ACTION_ICONS.undo"
        size="xs"
        color="neutral"
        variant="ghost"
        :disabled="disabled || saving"
        @click="undoCard(rowId, card)"
      />
      <UButton
        v-if="!card.deleted"
        label="Delete Semester Info"
        :icon="ACTION_ICONS.delete"
        size="xs"
        color="error"
        variant="ghost"
        :disabled="disabled || saving"
        @click="deleteCard(rowId, card)"
      />
    </div>

    <div v-if="card.role === 'Student'" class="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <UFormField v-for="field in ENROLLMENT_FIELDS" :key="field.field" :label="field.label">
        <USelectMenu
          v-if="field.options"
          :model-value="enrollmentValue(card.childId, field.field) ?? undefined"
          :items="field.options"
          value-key="value"
          class="w-full"
          :disabled="disabled || card.deleted || saving"
          :highlight="enrollmentEdited(card.childId, field.field)"
          color="warning"
          @update:model-value="(value: any) => setEnrollmentValue(card.childId, field.field, value)"
        />
        <UInput
          v-else
          :model-value="enrollmentValue(card.childId, field.field) ?? ''"
          class="w-full"
          :disabled="disabled || card.deleted || saving"
          :highlight="enrollmentEdited(card.childId, field.field)"
          color="warning"
          @update:model-value="(value: any) => setEnrollmentValue(card.childId, field.field, value)"
        />
      </UFormField>
    </div>

    <div v-if="card.role === 'Student'" class="space-y-2">
      <UFormField label="Skills">
        <UInputTags
          :model-value="enrollmentValue(card.childId, 'skills') ?? []"
          class="w-full"
          :disabled="disabled || card.deleted || saving"
          :highlight="enrollmentEdited(card.childId, 'skills')"
          color="warning"
          @update:model-value="(value: any) => setEnrollmentValue(card.childId, 'skills', value)"
        />
      </UFormField>
      <UFormField label="Comments">
        <UTextarea
          :model-value="enrollmentValue(card.childId, 'comments') ?? ''"
          :rows="2"
          class="w-full"
          :disabled="disabled || card.deleted || saving"
          :highlight="enrollmentEdited(card.childId, 'comments')"
          color="warning"
          @update:model-value="(value: any) => setEnrollmentValue(card.childId, 'comments', value)"
        />
      </UFormField>
    </div>

    <UFormField label="Team">
      <div class="flex items-center gap-1">
        <RecordSearchInput
          :model-value="teamProject(card.teamId)"
          :search="searchTeams"
          :display-label="projectLabel"
          placeholder="Search by project or partner name…"
          :disabled="disabled || card.deleted || saving"
          :highlight="card.teamChanged"
          color="warning"
          class="flex-1"
          @update:model-value="onSetTeam"
        />
        <UButton
          v-if="card.teamId"
          :icon="ACTION_ICONS.cancel"
          size="xs"
          color="neutral"
          variant="ghost"
          aria-label="Clear team"
          :disabled="disabled || card.deleted || saving"
          @click="onSetTeam(undefined)"
        />
      </div>
    </UFormField>

    <div v-if="card.role === 'Student'" class="space-y-2">
      <div class="flex items-center justify-between">
        <span class="text-xs font-medium text-gray-500">Team Preferences</span>
        <UButton
          label="Add Preference"
          :icon="ACTION_ICONS.add"
          size="xs"
          variant="ghost"
          :disabled="disabled || card.deleted || saving"
          @click="addPreference"
        />
      </div>
      <ul class="space-y-1">
        <li
          v-for="(entry, index) in choices"
          :key="entry.id"
          class="flex items-center justify-between rounded border border-gray-200 p-2 text-sm dark:border-gray-800"
          :class="STAGE_TINTS[entry.state]"
        >
          <span>#{{ index + 1 }} {{ projectName(entry.projectId) }}</span>
          <div class="flex items-center gap-1">
            <UButton
              :icon="ACTION_ICONS.moveUp"
              size="xs"
              color="neutral"
              variant="ghost"
              aria-label="Move up"
              :disabled="index === 0 || entry.deleted || disabled || card.deleted || saving"
              @click="moveChoice(rowId, choices, index, -1)"
            />
            <UButton
              :icon="ACTION_ICONS.moveDown"
              size="xs"
              color="neutral"
              variant="ghost"
              aria-label="Move down"
              :disabled="
                index === choices.length - 1 || entry.deleted || disabled || card.deleted || saving
              "
              @click="moveChoice(rowId, choices, index, 1)"
            />
            <UButton
              v-if="entry.state === 'clean' || entry.state === 'edited'"
              label="Remove"
              :icon="ACTION_ICONS.delete"
              size="xs"
              color="error"
              variant="ghost"
              :disabled="disabled || card.deleted || saving"
              @click="staging.children.markDeleted(rowId, 'Choices', entry.id)"
            />
            <UButton
              v-if="entry.state !== 'clean'"
              label="Undo"
              :icon="ACTION_ICONS.undo"
              size="xs"
              color="neutral"
              variant="ghost"
              :disabled="disabled || card.deleted || saving"
              @click="staging.children.undo(rowId, 'Choices', entry.id)"
            />
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>
