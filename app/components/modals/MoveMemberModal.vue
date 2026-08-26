<script setup lang="ts">
  import ModalFooter from '~/components/modals/ModalFooter.vue'
  import type { SelectOption } from '~/utils/options'

  const props = defineProps<{
    /** The project's other teams; empty when there is nowhere to move to. */
    teams: SelectOption[]
  }>()

  const emit = defineEmits<{ close: [teamId: string | null] }>()

  const destination = ref<string | undefined>()
</script>

<template>
  <UModal title="Move Student" @close="emit('close', null)">
    <template #body>
      <div class="space-y-4">
        <UFormField label="Destination Team">
          <USelectMenu
            v-model="destination"
            :items="props.teams"
            value-key="value"
            placeholder="Select a team…"
            class="w-full"
          />
        </UFormField>
        <p v-if="!props.teams.length" class="text-sm text-gray-500">
          This project has no other team to move to.
        </p>
        <ModalFooter
          :disabled="!destination"
          @cancel="emit('close', null)"
          @confirm="emit('close', destination ?? null)"
        />
      </div>
    </template>
  </UModal>
</template>
