<script setup lang="ts">
  import ModalFooter from '~/components/modals/ModalFooter.vue'
  import type { ConfirmOptions } from '~/composables/useConfirm'

  const props = defineProps<ConfirmOptions>()
  const emit = defineEmits<{ close: [confirmed: boolean] }>()
</script>

<template>
  <UModal :title="props.title" :description="props.description" @close="emit('close', false)">
    <template #body>
      <ul v-if="props.affected?.length" class="list-inside list-disc space-y-1 text-sm">
        <li v-for="item in props.affected" :key="item.label">
          {{ item.count }} {{ item.label }}{{ item.count === 1 ? '' : 's' }}
        </li>
      </ul>
    </template>

    <template #footer>
      <ModalFooter
        :confirm-label="props.confirmLabel"
        confirm-color="error"
        @cancel="emit('close', false)"
        @confirm="emit('close', true)"
      />
    </template>
  </UModal>
</template>
