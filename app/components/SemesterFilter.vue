<script setup lang="ts">
  import CreateSemesterModal from '~/components/CreateSemesterModal.vue'
  import { ACTION_ICONS } from '~/utils/icons'
  import type { SemesterRead } from '#server/services/semesterService'

  const modelValue = defineModel<string | undefined>()

  const { semesters, createSemester, deleteSemester } = useSemesters()

  const options = computed(() =>
    semesters.value.map((semester) => ({
      label: semesterLabel(semester),
      value: semester.id,
    }))
  )

  function semesterLabel(semester: SemesterRead) {
    const season = semester.season[0] + semester.season.slice(1).toLowerCase()
    return `${season} ${semester.year}`
  }

  // If the selected semester gets deleted elsewhere (e.g. another mounted
  // SemesterFilter instance), drop the now-dangling selection here too.
  watch(semesters, (list) => {
    if (modelValue.value && !list.some((s) => s.id === modelValue.value)) {
      modelValue.value = undefined
    }
  })

  const selectedSemester = computed(() => semesters.value.find((s) => s.id === modelValue.value))

  const selectedSemesterHasRecords = computed(() => {
    const s = selectedSemester.value
    return !!s && (s.teamCount > 0 || s.enrollmentCount > 0 || s.choiceCount > 0)
  })

  const overlay = useOverlay()
  const createModal = overlay.create(CreateSemesterModal)

  async function openCreateModal() {
    const semester = await createModal.open().result
    if (semester) {
      await createSemester(semester)
    }
  }

  const confirm = useConfirm()
  const toast = useToast()

  async function onDeleteClick() {
    const semester = selectedSemester.value
    if (!semester) return

    const ok = await confirm({
      title: `Delete ${semesterLabel(semester)}?`,
      description: 'This cannot be undone.',
    })
    if (!ok) return

    try {
      await deleteSemester(semester.id)
      modelValue.value = undefined
    } catch (e: any) {
      toast.add({
        title: 'Could not delete semester',
        description: e?.data?.message ?? e?.message ?? 'Unknown error.',
        color: 'error',
      })
    }
  }
</script>

<template>
  <div class="flex items-center gap-2">
    <USelectMenu
      v-model="modelValue"
      :items="options"
      value-key="value"
      placeholder="All Semesters"
      class="w-48"
    />
    <UButton
      v-if="modelValue"
      :icon="ACTION_ICONS.cancel"
      color="neutral"
      variant="ghost"
      aria-label="Clear semester filter"
      @click="modelValue = undefined"
    />
    <UTooltip
      v-if="modelValue"
      :text="
        selectedSemesterHasRecords
          ? 'This semester has teams, enrollments, or choices — remove those first.'
          : 'Delete this semester'
      "
    >
      <UButton
        :icon="ACTION_ICONS.delete"
        label="Delete Semester"
        color="error"
        variant="soft"
        :disabled="selectedSemesterHasRecords"
        aria-label="Delete semester"
        @click="onDeleteClick"
      />
    </UTooltip>
    <UButton
      :icon="ACTION_ICONS.add"
      label="Add Semester"
      color="neutral"
      variant="soft"
      @click="openCreateModal"
    />
  </div>
</template>
