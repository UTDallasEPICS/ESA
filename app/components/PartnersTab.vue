<script setup lang="ts">
  import type { DataTableColumn } from '~/components/DataTable.vue'
  import { ACTION_ICONS } from '~/utils/icons'
  import type {
    MergedChild,
    StagedPayload,
    StagedRecord,
    StageState,
  } from '~/composables/useStagedChanges'
  import type { PartnerCreate, PartnerRead, PartnerUpdate } from '#server/services/partnerService'
  import type { ContactCreate, ContactRead } from '#server/services/contactService'

  const props = defineProps<{ semesterId?: string }>()
  const emit = defineEmits<{ 'restore-semester': [previous: string | undefined] }>()

  interface PartnerRow extends PartnerRead {
    primaryName: string
    primaryEmail: string
    primaryPhone: string
  }

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

  // Green / blue / red tints, matching the row highlights in DataTable (§2.3.1).
  const CARD_TINTS: Record<StageState, string> = {
    new: 'bg-success-50 dark:bg-success-950/50',
    edited: 'bg-info-50 dark:bg-info-950/50',
    deleted: 'bg-error-50 dark:bg-error-950/50',
    clean: '',
  }

  const staging = useStagedChanges()
  const confirm = useConfirm()
  const toast = useToast()
  const saving = ref(false)

  const {
    data: partners,
    refresh,
    status,
  } = useFetch<PartnerRead[]>('/api/partners', {
    query: computed(() => ({ semesterId: props.semesterId })),
    default: () => [],
  })

  // Rows are partners flattened with their primary contact, so the three contact columns can
  // display, sort, and filter on plain strings while their edits are routed to the contact (§3.3.1).
  const rows = computed<PartnerRow[]>(() =>
    partners.value.map((partner) => {
      const primary = partner.Contacts.find((c) => c.isPrimary) ?? partner.Contacts[0]
      return {
        ...partner,
        primaryName: primary?.name ?? '',
        primaryEmail: primary?.email ?? '',
        primaryPhone: primary?.phone ?? '',
      }
    })
  )

  /**
   * The contact a proxy column edits: the partner's primary, else its first contact, else a
   * synthetic `new:` id so that typing into the column stages a contact creation instead.
   */
  function contactTargetId(row: PartnerRow) {
    const primary = row.Contacts?.find((c) => c.isPrimary) ?? row.Contacts?.[0]
    return primary?.id ?? `new:Contacts:primary:${row.id}`
  }

  function contactColumn(
    id: string,
    header: string,
    accessorKey: 'primaryName' | 'primaryEmail' | 'primaryPhone',
    field: ContactField
  ): DataTableColumn<PartnerRow> {
    return {
      id,
      header,
      accessorKey,
      sortable: true,
      filter: { type: 'search' },
      editable: {
        type: 'text',
        child: (row) => ({ collection: 'Contacts', id: contactTargetId(row), field }),
      },
    }
  }

  const columns: DataTableColumn<PartnerRow>[] = [
    {
      id: 'name',
      header: 'Name',
      accessorKey: 'name',
      sortable: true,
      filter: { type: 'search' },
      editable: { type: 'text' },
      required: true,
    },
    contactColumn('primaryName', 'Contact', 'primaryName', 'name'),
    contactColumn('primaryEmail', 'Email', 'primaryEmail', 'email'),
    contactColumn('primaryPhone', 'Phone', 'primaryPhone', 'phone'),
  ]

  function newRow() {
    return { id: '', name: '', Contacts: [], Projects: [] }
  }

  // ------------------------------------------------------------- expansion

  /** The fetched value behind a contact field, normalized so clearing an input clears the edit. */
  function originalValue(row: PartnerRow, contactId: string, field: ContactField) {
    return row.Contacts?.find((c) => c.id === contactId)?.[field] ?? ''
  }

  function contactValue(rowId: string, row: PartnerRow, id: string, field: ContactField) {
    const original = originalValue(row, id, field)
    return staging.getChildValue(rowId, 'Contacts', id, field, original) ?? ''
  }

  function setContact(rowId: string, row: PartnerRow, id: string, field: ContactField, value: any) {
    const original = originalValue(row, id, field)
    staging.setChildValue(rowId, 'Contacts', id, field, value ?? '', original)
  }

  function contactEdited(rowId: string, id: string, field: ContactField) {
    return staging.isChildFieldEdited(rowId, 'Contacts', id, field)
  }

  /** Fetched contacts with staged edits applied, plus staged-new ones, flagged with the primary. */
  function contactCards(rowId: string, row: PartnerRow): ContactCard[] {
    const merged = staging.mergeChildren(rowId, 'Contacts', row.Contacts ?? [], (c) => c.id)
    const live = merged.filter((card) => !card.deleted)
    const primaryId = (live.find((card) => card.record?.isPrimary) ?? live[0])?.id
    return merged.map((card) => ({ ...card, isPrimary: card.id === primaryId }))
  }

  function wasPrimary(row: PartnerRow, contactId: string) {
    return !!row.Contacts?.find((c) => c.id === contactId)?.isPrimary
  }

  /** Promotes one contact and clears the flag on the previous primary, both staged locally. */
  function makePrimary(rowId: string, row: PartnerRow, cards: ContactCard[], id: string) {
    const current = cards.find((card) => card.isPrimary)
    if (current && current.id !== id) {
      const original = wasPrimary(row, current.id)
      staging.setChildValue(rowId, 'Contacts', current.id, 'isPrimary', false, original)
    }
    staging.setChildValue(rowId, 'Contacts', id, 'isPrimary', true, wasPrimary(row, id))
  }

  function projectsFor(row: PartnerRow) {
    return (row.Projects ?? []).filter(
      (project) =>
        !props.semesterId || project.Teams.some((team) => team.semesterId === props.semesterId)
    )
  }

  // ------------------------------------------------- contact creation modal

  const contactModalOpen = ref(false)
  const contactModalRowId = ref<string | null>(null)
  const contactDraft = reactive({ name: '', email: '', phone: '' })

  function openContactModal(rowId: string) {
    contactModalRowId.value = rowId
    contactDraft.name = ''
    contactDraft.email = ''
    contactDraft.phone = ''
    contactModalOpen.value = true
  }

  /** Stages the contact under its partner row; the POST happens on the table's Confirm (§3.3.3). */
  function stageContact() {
    const rowId = contactModalRowId.value
    if (!rowId || !contactDraft.name.trim()) return
    staging.addChild(rowId, 'Contacts', {
      name: contactDraft.name.trim(),
      email: contactDraft.email.trim(),
      phone: contactDraft.phone.trim() || undefined,
    })
    contactModalOpen.value = false
  }

  // ------------------------------------------------------------------ save

  function contactBody(fields: Record<string, any>) {
    return {
      name: String(fields.name ?? ''),
      email: String(fields.email ?? ''),
      phone: fields.phone ? String(fields.phone) : undefined,
    }
  }

  async function createPartner(record: StagedRecord) {
    const contacts = (record.children.Contacts ?? [])
      .filter((child) => child.isNew && !child.deleted)
      .map((child) => ({ ...contactBody(child.fields), isPrimary: !!child.fields.isPrimary }))
      .filter((contact) => contact.name || contact.email || contact.phone)
    // createPartner flags the first nested contact primary, so a staged primary has to lead.
    contacts.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))

    const body: PartnerCreate = {
      name: String(record.fields.name ?? ''),
      Contacts: contacts.length ? (contacts as Omit<ContactCreate, 'partnerId'>[]) : undefined,
    }
    await $fetch('/api/partners', { method: 'POST', body })
  }

  async function updatePartner(record: StagedRecord) {
    if (Object.keys(record.fields).length) {
      const body: PartnerUpdate = { name: record.fields.name }
      await $fetch(`/api/partners/${record.id}`, { method: 'PUT', body })
    }

    const contacts = record.children.Contacts ?? []
    for (const child of contacts.filter((c) => c.isNew && !c.deleted)) {
      const body = { partnerId: record.id, ...contactBody(child.fields) }
      await $fetch('/api/contacts', { method: 'POST', body })
    }
    for (const child of contacts.filter((c) => !c.isNew && !c.deleted)) {
      if (!Object.keys(child.fields).length) continue
      await $fetch(`/api/contacts/${child.id}`, { method: 'PUT', body: child.fields })
    }
    for (const child of contacts.filter((c) => !c.isNew && c.deleted)) {
      await $fetch(`/api/contacts/${child.id}`, { method: 'DELETE' })
    }
  }

  async function onSave(payload: StagedPayload) {
    if (payload.deleted.length) {
      const affected = rows.value.filter((row) => payload.deleted.includes(row.id))
      const ok = await confirm({
        title: `Delete ${payload.deleted.length} partner${payload.deleted.length === 1 ? '' : 's'}?`,
        description: 'This will also delete all associated contacts and projects.',
        affected: [
          { label: 'Contact', count: affected.reduce((n, p) => n + p.Contacts.length, 0) },
          { label: 'Project', count: affected.reduce((n, p) => n + p.Projects.length, 0) },
        ],
      })
      if (!ok) return
    }

    saving.value = true
    try {
      for (const record of payload.created) await createPartner(record)
      for (const record of payload.updated) await updatePartner(record)
      for (const id of payload.deleted) {
        await $fetch(`/api/partners/${id}`, { method: 'DELETE' })
      }
      staging.reset()
      await refresh()
    } catch (error: any) {
      toast.add({
        title: 'Save failed',
        description: error?.data?.message ?? error?.message ?? 'Unknown error',
        color: 'error',
      })
    } finally {
      saving.value = false
    }
  }

  // Changing the semester filter refetches the list, which would silently orphan staged work.
  let restoring = false
  watch(
    () => props.semesterId,
    async (_next, previous) => {
      if (restoring) {
        restoring = false
        return
      }
      if (!staging.isDirty.value) return
      const ok = await confirm({
        title: 'Discard staged changes?',
        description: 'Changing the semester filter will discard everything you have staged here.',
        confirmLabel: 'Discard',
      })
      if (ok) staging.reset()
      else {
        restoring = true
        emit('restore-semester', previous)
      }
    }
  )
</script>

<template>
  <div>
    <DataTable
      :data="rows"
      :columns="columns"
      :row-key="(row) => row.id"
      :staging="staging"
      :loading="status === 'pending'"
      :saving="saving"
      expandable
      :new-row="newRow"
      @save="onSave"
    >
      <template #expanded="{ row, rowId, deleted }">
        <div class="space-y-4 p-3">
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <h3 class="font-semibold">Contacts</h3>
              <UButton
                label="Add Contact"
                :icon="ACTION_ICONS.add"
                size="xs"
                variant="soft"
                :disabled="deleted || saving"
                @click="openContactModal(rowId)"
              />
            </div>

            <p v-if="!contactCards(rowId, row).length" class="text-sm text-gray-500">
              No contacts yet.
            </p>

            <ul class="space-y-2">
              <li
                v-for="contact in contactCards(rowId, row)"
                :key="contact.id"
                class="rounded border border-gray-200 p-2 dark:border-gray-800"
                :class="CARD_TINTS[contact.state]"
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
                        :model-value="contactValue(rowId, row, contact.id, field.key)"
                        variant="ghost"
                        size="xs"
                        placeholder="—"
                        class="w-full"
                        color="warning"
                        :highlight="contactEdited(rowId, contact.id, field.key)"
                        :disabled="deleted || contact.deleted || saving"
                        @update:model-value="
                          (value: any) => setContact(rowId, row, contact.id, field.key, value)
                        "
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
                      :disabled="deleted || saving"
                      @click="makePrimary(rowId, row, contactCards(rowId, row), contact.id)"
                    />
                    <UButton
                      v-if="contact.state === 'clean' || contact.state === 'edited'"
                      label="Delete"
                      :icon="ACTION_ICONS.delete"
                      size="xs"
                      color="error"
                      variant="ghost"
                      :disabled="deleted || saving"
                      @click="staging.toggleChildDeleted(rowId, 'Contacts', contact.id)"
                    />
                    <UButton
                      v-if="contact.state === 'new' || contact.state === 'deleted'"
                      label="Undo"
                      :icon="ACTION_ICONS.undo"
                      size="xs"
                      color="neutral"
                      variant="ghost"
                      :disabled="deleted || saving"
                      @click="staging.dropChild(rowId, 'Contacts', contact.id)"
                    />
                  </div>
                </div>
              </li>
            </ul>
          </div>

          <div class="space-y-2">
            <h3 class="font-semibold">Projects</h3>
            <p v-if="!projectsFor(row).length" class="text-sm text-gray-500">No projects.</p>
            <ul class="space-y-1">
              <li
                v-for="project in projectsFor(row)"
                :key="project.id"
                class="rounded border border-gray-200 p-2 text-sm dark:border-gray-800"
              >
                {{ project.name }}
              </li>
            </ul>
          </div>
        </div>
      </template>
    </DataTable>

    <UModal v-model:open="contactModalOpen" title="Add Contact">
      <template #body>
        <div class="space-y-4">
          <UFormField label="Name" required>
            <UInput v-model="contactDraft.name" class="w-full" />
          </UFormField>
          <UFormField label="Phone">
            <UInput v-model="contactDraft.phone" class="w-full" />
          </UFormField>
          <UFormField label="Email">
            <UInput v-model="contactDraft.email" class="w-full" />
          </UFormField>
          <div class="flex justify-end gap-2">
            <UButton
              label="Cancel"
              :icon="ACTION_ICONS.cancel"
              color="neutral"
              variant="soft"
              @click="contactModalOpen = false"
            />
            <UButton
              label="Confirm"
              :icon="ACTION_ICONS.confirm"
              :disabled="!contactDraft.name.trim()"
              @click="stageContact"
            />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
