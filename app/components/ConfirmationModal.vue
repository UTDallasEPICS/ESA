<script setup lang="ts">
  import { ACTION_ICONS } from '~/utils/icons'
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
      <div class="flex w-full justify-end gap-2">
        <UButton
          label="Cancel"
          :icon="ACTION_ICONS.cancel"
          color="neutral"
          variant="soft"
          @click="emit('close', false)"
        />
        <UButton
          :label="props.confirmLabel ?? 'Confirm'"
          :icon="ACTION_ICONS.confirm"
          color="error"
          @click="emit('close', true)"
        />
      </div>
    </template>
  </UModal>
</template>
