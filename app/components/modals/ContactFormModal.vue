<script setup lang="ts">
  import ModalFooter from '~/components/modals/ModalFooter.vue'
  import type { ContactDraft } from '~/utils/recordDrafts'

  const emit = defineEmits<{ close: [contact: ContactDraft | null] }>()

  const draft = reactive({ name: '', email: '', phone: '' })

  function onConfirm() {
    if (!draft.name.trim()) return
    emit('close', {
      name: draft.name.trim(),
      email: draft.email.trim(),
      phone: draft.phone.trim() || undefined,
    })
  }
</script>

<template>
  <UModal title="Add Contact" @close="emit('close', null)">
    <template #body>
      <div class="space-y-4">
        <UFormField label="Name" required>
          <UInput v-model="draft.name" class="w-full" />
        </UFormField>
        <UFormField label="Phone">
          <UInput v-model="draft.phone" class="w-full" />
        </UFormField>
        <UFormField label="Email">
          <UInput v-model="draft.email" class="w-full" />
        </UFormField>
        <ModalFooter
          :disabled="!draft.name.trim()"
          @cancel="emit('close', null)"
          @confirm="onConfirm"
        />
      </div>
    </template>
  </UModal>
</template>
