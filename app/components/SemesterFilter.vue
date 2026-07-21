<script setup lang="ts">
  import CreateSemesterModal from '~/components/CreateSemesterModal.vue'
  import { ACTION_ICONS } from '~/utils/icons'
  import type { SemesterRead } from '#server/services/semesterService'

  const modelValue = defineModel<string | undefined>()

  const { semesters, createSemester } = useSemesters()

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

  const overlay = useOverlay()
  const createModal = overlay.create(CreateSemesterModal)

  async function openCreateModal() {
    const semester = await createModal.open().result
    if (semester) {
      await createSemester(semester)
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
    <UButton
      :icon="ACTION_ICONS.add"
      label="Add Semester"
      color="neutral"
      variant="soft"
      @click="openCreateModal"
    />
  </div>
</template>
