<script setup lang="ts">
  import { ACTION_ICONS } from '~/utils/icons'
  import { STAGE_TINTS, type MergedChild } from '~/composables/useStagedChanges'
  import type { ContactRead } from '#server/services/contactService'
  import type { PartnerRead } from '#server/services/partnerService'
  import { useRowStaging } from '~/composables/useRowStaging'

  /** A merged contact plus whether it is the partner's primary once staging is applied. */
  interface ContactCard extends MergedChild<ContactRead> {
    isPrimary: boolean
  }

  type ContactField = 'name' | 'email' | 'phone'

  const CONTACT_FIELDS = [
    { key: 'name', label: 'Name' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
  ] as const

  const props = defineProps<{
    rowId: string
    row: PartnerRead
    /** The partner row itself is marked for deletion, so its contacts are read-only. */
    disabled?: boolean
  }>()

  const emit = defineEmits<{ add: [] }>()

  const { staging, saving } = useRowStaging()

  function contactValue(contactId: string, field: ContactField) {
    return staging.getChildValue(props.rowId, 'Contacts', contactId, field) ?? ''
  }

  function setContact(contactId: string, field: ContactField, value: any) {
    staging.setChildValue(props.rowId, 'Contacts', contactId, field, value ?? '')
  }

  function contactEdited(contactId: string, field: ContactField) {
    return staging.isChildFieldEdited(props.rowId, 'Contacts', contactId, field)
  }

  /** Fetched contacts with staged edits applied, plus staged-new ones, flagged with the primary. */
  const cards = computed<ContactCard[]>(() => {
    const merged = staging.mergeChildren(
      props.rowId,
      'Contacts',
      props.row.Contacts ?? [],
      (c) => c.id
    )
    const live = merged.filter((card) => !card.deleted)
    const primaryId = (live.find((card) => card.record?.isPrimary) ?? live[0])?.id
    return merged.map((card) => ({ ...card, isPrimary: card.id === primaryId }))
  })

  /** Promotes one contact and clears the flag on the previous primary, both staged locally. */
  function makePrimary(id: string) {
    const current = cards.value.find((card) => card.isPrimary)
    if (current && current.id !== id) {
      staging.setChildValue(props.rowId, 'Contacts', current.id, 'isPrimary', false)
    }
    staging.setChildValue(props.rowId, 'Contacts', id, 'isPrimary', true)
  }
</script>

<template>
  <div class="space-y-2">
    <div class="flex items-center justify-between">
      <h3 class="font-semibold">Contacts</h3>
      <UButton
        label="Add Contact"
        :icon="ACTION_ICONS.add"
        size="xs"
        variant="soft"
        :disabled="disabled || saving"
        @click="emit('add')"
      />
    </div>

    <p v-if="!cards.length" class="text-sm text-gray-500">No contacts yet.</p>

    <ul class="space-y-2">
      <li
        v-for="contact in cards"
        :key="contact.id"
        class="rounded border border-gray-200 p-2 dark:border-gray-800"
        :class="STAGE_TINTS[contact.state]"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-3">
            <UFormField
              v-for="field in CONTACT_FIELDS"
              :key="field.key"
              :label="field.label"
              size="xs"
            >
              <UInput
                :model-value="contactValue(contact.id, field.key)"
                variant="ghost"
                size="xs"
                placeholder="—"
                class="w-full"
                color="warning"
                :highlight="contactEdited(contact.id, field.key)"
                :disabled="disabled || contact.deleted || saving"
                @update:model-value="(value: any) => setContact(contact.id, field.key, value)"
              />
            </UFormField>
          </div>

          <div class="flex shrink-0 flex-wrap items-center justify-end gap-1">
            <UBadge v-if="contact.isPrimary" size="xs" variant="subtle">Primary</UBadge>
            <UButton
              v-if="!contact.isPrimary && !contact.deleted"
              label="Make Primary"
              :icon="ACTION_ICONS.primary"
              size="xs"
              color="neutral"
              variant="ghost"
              :disabled="disabled || saving"
              @click="makePrimary(contact.id)"
            />
            <UButton
              v-if="contact.state === 'clean' || contact.state === 'edited'"
              label="Delete"
              :icon="ACTION_ICONS.delete"
              size="xs"
              color="error"
              variant="ghost"
              :disabled="disabled || saving"
              @click="staging.markChildDeleted(rowId, 'Contacts', contact.id)"
            />
            <UButton
              v-if="contact.state !== 'clean'"
              label="Undo"
              :icon="ACTION_ICONS.undo"
              size="xs"
              color="neutral"
              variant="ghost"
              :disabled="disabled || saving"
              @click="staging.undoChild(rowId, 'Contacts', contact.id)"
            />
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>
