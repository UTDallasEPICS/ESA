<script setup lang="ts">
  import CreateSemesterModal from '~/components/modals/CreateSemesterModal.vue'
  import { ACTION_ICONS } from '~/utils/icons'
  import { errorMessage } from '~/utils/errors'
  import { formatSemester } from '~/utils/labels'
  import { useSemesterLookup } from '~/composables/useSemesters'

  // Fully controlled rather than `defineModel`: the Database page may refuse a change when a tab
  // holds staged work, and a local model value would leave the dropdown showing a semester the page
  // never adopted. Every change leaves through the emit and comes back as a prop, or not at all.
  const props = defineProps<{ modelValue?: string }>()
  const emit = defineEmits<{ 'update:modelValue': [value: string | undefined] }>()

  const { semesters, createSemester, deleteSemester } = useSemesters()
  const { semesterOptions } = useSemesterLookup()

  // If the selected semester gets deleted elsewhere (e.g. another mounted
  // SemesterFilter instance), drop the now-dangling selection here too.
  watch(semesters, (list) => {
    if (props.modelValue && !list.some((s) => s.id === props.modelValue)) {
      emit('update:modelValue', undefined)
    }
  })

  const selectedSemester = computed(() => semesters.value.find((s) => s.id === props.modelValue))

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
      title: `Delete ${formatSemester(semester)}?`,
      description: 'This cannot be undone.',
    })
    if (!ok) return

    try {
      await deleteSemester(semester.id)
      emit('update:modelValue', undefined)
    } catch (e: any) {
      toast.add({
        title: 'Could not delete semester',
        description: errorMessage(e, 'Unknown error.'),
        color: 'error',
      })
    }
  }
</script>

<template>
  <div class="flex items-center gap-2">
    <USelectMenu
      :model-value="props.modelValue"
      :items="semesterOptions"
      value-key="value"
      placeholder="All Semesters"
      class="w-48"
      @update:model-value="(value: any) => emit('update:modelValue', value)"
    />
    <UButton
      v-if="props.modelValue"
      :icon="ACTION_ICONS.cancel"
      color="neutral"
      variant="ghost"
      aria-label="Clear semester filter"
      @click="emit('update:modelValue', undefined)"
    />
    <UButton
      :icon="ACTION_ICONS.delete"
      label="Delete Semester"
      color="error"
      variant="soft"
      aria-label="Delete semester"
      :disabled="!props.modelValue"
      @click="onDeleteClick"
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
