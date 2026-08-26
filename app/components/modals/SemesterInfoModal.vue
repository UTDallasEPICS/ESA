<script setup lang="ts">
  import ModalFooter from '~/components/modals/ModalFooter.vue'
  import type { ProjectRead } from '#server/services/projectService'
  import { projectLabel } from '~/utils/labels'
  import { searchProjects } from '~/utils/search'
  import {
    CLASS_OPTIONS,
    GENDER_OPTIONS,
    MEETING_DAY_OPTIONS,
    YEAR_OPTIONS,
    type SelectOption,
  } from '~/utils/options'
  import type { SemesterInfoDraft } from '~/utils/recordDrafts'

  const props = defineProps<{
    /** Whether this student can hold a Mentor card at all; gates the Role radio. */
    isMentor: boolean
    semesters: SelectOption[]
    /** Semesters that already carry a card of each role — a student may hold one of each. */
    taken: { STUDENT: string[]; MENTOR: string[] }
    /** Every project; narrowed to the chosen semester as the user picks one. */
    projects: ProjectRead[]
  }>()

  const emit = defineEmits<{ close: [draft: SemesterInfoDraft | null] }>()

  const draft = reactive<SemesterInfoDraft>({
    semesterId: '',
    role: 'STUDENT',
    meetingDay: 'WEDNESDAY',
    major: '',
    year: 'FRESHMAN',
    class: 'EPCS_2200',
    gender: 'OTHER',
  })

  const takenForRole = computed(() => new Set(props.taken[draft.role]))

  const semesterItems = computed(() =>
    props.semesters.map((semester) => ({
      ...semester,
      disabled: takenForRole.value.has(semester.value),
    }))
  )

  const valid = computed(() => !!draft.semesterId && !takenForRole.value.has(draft.semesterId))

  // A project is only assignable in the semester it has a team for, so the pick cannot outlive it.
  watch(
    () => draft.semesterId,
    () => {
      draft.project = undefined
    }
  )

  async function search(query: string) {
    if (!draft.semesterId) return []
    return searchProjects(props.projects, query, { semesterId: draft.semesterId })
  }

  function onConfirm() {
    if (!valid.value) return
    emit('close', { ...draft })
  }
</script>

<template>
  <UModal title="Add Semester Info" @close="emit('close', null)">
    <template #body>
      <div class="space-y-4">
        <UFormField label="Semester">
          <USelectMenu
            v-model="draft.semesterId"
            :items="semesterItems"
            value-key="value"
            class="w-full"
          />
        </UFormField>
        <UFormField label="Meeting Day">
          <USelectMenu
            v-model="draft.meetingDay"
            :items="MEETING_DAY_OPTIONS"
            value-key="value"
            class="w-full"
          />
        </UFormField>
        <UFormField v-if="props.isMentor" label="Role">
          <URadioGroup
            v-model="draft.role"
            orientation="horizontal"
            :items="[
              { label: 'Student', value: 'STUDENT' },
              { label: 'Mentor', value: 'MENTOR' },
            ]"
          />
        </UFormField>

        <template v-if="draft.role === 'STUDENT'">
          <UFormField label="Major">
            <UInput v-model="draft.major" class="w-full" />
          </UFormField>
          <UFormField label="Year">
            <USelectMenu
              v-model="draft.year"
              :items="YEAR_OPTIONS"
              value-key="value"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Class">
            <USelectMenu
              v-model="draft.class"
              :items="CLASS_OPTIONS"
              value-key="value"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Gender">
            <USelectMenu
              v-model="draft.gender"
              :items="GENDER_OPTIONS"
              value-key="value"
              class="w-full"
            />
          </UFormField>
        </template>

        <UFormField label="Team" hint="Optional">
          <RecordSearchInput
            v-model="draft.project"
            :search="search"
            :display-label="projectLabel"
            placeholder="Search by project or partner name…"
          />
        </UFormField>

        <ModalFooter :disabled="!valid" @cancel="emit('close', null)" @confirm="onConfirm" />
      </div>
    </template>
  </UModal>
</template>
