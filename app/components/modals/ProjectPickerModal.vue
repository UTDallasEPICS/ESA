<script setup lang="ts">
  import ModalFooter from '~/components/modals/ModalFooter.vue'
  import type { ProjectRead } from '#server/services/projectService'
  import { projectLabel } from '~/utils/labels'
  import { searchProjects } from '~/utils/search'

  const props = defineProps<{
    title: string
    /** Already narrowed by the caller to the semester's projects, minus any already taken. */
    projects: ProjectRead[]
  }>()

  const emit = defineEmits<{ close: [project: ProjectRead | null] }>()

  const picked = ref<ProjectRead | undefined>()

  async function search(query: string) {
    return searchProjects(props.projects, query)
  }
</script>

<template>
  <UModal :title="props.title" @close="emit('close', null)">
    <template #body>
      <div class="space-y-4">
        <RecordSearchInput
          v-model="picked"
          :search="search"
          :display-label="projectLabel"
          placeholder="Search by project or partner name…"
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
