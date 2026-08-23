<script setup lang="ts">
  import { ACTION_ICONS } from '~/utils/icons'

  const props = defineProps<{
    title: string
  }>()

  const open = defineModel<boolean>('open', { default: false })

  const emit = defineEmits<{
    confirm: []
    cancel: []
  }>()

  function onCancel() {
    emit('cancel')
    open.value = false
  }
</script>

<template>
  <USlideover v-model:open="open" :title="props.title" :close="false">
    <template #header>
      <div class="flex w-full items-center justify-between">
        <h2 class="text-lg font-semibold">{{ props.title }}</h2>
        <div class="flex gap-2">
          <UButton
            label="Cancel"
            :icon="ACTION_ICONS.cancel"
            color="neutral"
            variant="soft"
            @click="onCancel"
          />
          <UButton
            label="Confirm"
            :icon="ACTION_ICONS.confirm"
            color="primary"
            @click="emit('confirm')"
          />
        </div>
      </div>
    </template>

    <template #body>
      <slot />
    </template>
  </USlideover>
</template>
