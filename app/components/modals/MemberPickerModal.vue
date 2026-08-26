<script setup lang="ts">
  import ModalFooter from '~/components/modals/ModalFooter.vue'
  import type { StudentRead } from '#server/services/studentService'
  import { studentLabel } from '~/utils/labels'
  import { searchStudents } from '~/utils/search'

  const props = defineProps<{
    title: string
    /** Already narrowed by the caller to students not on the team (§3.1.5). */
    students: StudentRead[]
  }>()

  const emit = defineEmits<{ close: [student: StudentRead | null] }>()

  const picked = ref<StudentRead | undefined>()

  async function search(query: string) {
    return searchStudents(props.students, query)
  }
</script>

<template>
  <UModal :title="props.title" @close="emit('close', null)">
    <template #body>
      <div class="space-y-4">
        <RecordSearchInput
          v-model="picked"
          :search="search"
          :display-label="studentLabel"
          placeholder="Search by name or netID…"
        />
        <ModalFooter
          :disabled="!picked"
          @cancel="emit('close', null)"
          @confirm="emit('close', picked ?? null)"
        />
      </div>
    </template>
  </UModal>
</template>
