<script setup lang="ts">
  import type { DataTableColumn } from '~/components/DataTable.vue'
  import { ACTION_ICONS } from '~/utils/icons'
  import type { PartnerRead } from '#server/services/partnerService'
  import type { ContactCreate, ContactRead } from '#server/services/contactService'

  const props = defineProps<{ semesterId?: string }>()

  interface PartnerRow extends PartnerRead {
    primaryEmail: string
    primaryPhone: string
    primaryName: string
  }

  const {
    data: partners,
    refresh,
    status,
  } = useFetch<PartnerRead[]>('/api/partners', {
    query: computed(() => ({ semesterId: props.semesterId })),
    default: () => [],
  })

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

  const columns: DataTableColumn<PartnerRow>[] = [
    {
      id: 'name',
      header: 'Name',
      accessorKey: 'name',
      sortable: true,
      filter: { type: 'search' },
      editable: { type: 'text' },
    },
    {
      id: 'primaryName',
      header: 'Contact',
      accessorKey: 'primaryName',
      sortable: true,
      filter: { type: 'search' },
      editable: { type: 'text' },
    },
    {
      id: 'primaryEmail',
      header: 'Email',
      accessorKey: 'primaryEmail',
      sortable: true,
      filter: { type: 'search' },
      editable: { type: 'text' },
    },
    {
      id: 'primaryPhone',
      header: 'Phone',
      accessorKey: 'primaryPhone',
      sortable: true,
      filter: { type: 'search' },
      editable: { type: 'text' },
    },
  ]

  const confirm = useConfirm()

  async function onDeleteRequest(ids: string[]) {
    const selected = rows.value.filter((p) => ids.includes(p.id))
    const ok = await confirm({
      title: `Delete ${ids.length} partner${ids.length === 1 ? '' : 's'}?`,
      description: 'This will also delete all associated contacts and projects.',
      affected: [
        { label: 'Contact', count: selected.reduce((n, p) => n + p.Contacts.length, 0) },
        { label: 'Project', count: selected.reduce((n, p) => n + p.Projects.length, 0) },
      ],
    })
    if (!ok) return
    await Promise.all(ids.map((id) => $fetch(`/api/partners/${id}`, { method: 'DELETE' })))
    await refresh()
  }

  async function onSaveEdits(edits: Record<string, Record<string, any>>) {
    await Promise.all(
      Object.entries(edits).map(async ([id, changes]) => {
        const { primaryEmail, primaryPhone, primaryName, ...partnerChanges } = changes
        const tasks: Promise<any>[] = []
        if (Object.keys(partnerChanges).length) {
          tasks.push($fetch(`/api/partners/${id}`, { method: 'PUT', body: partnerChanges }))
        }
        if (primaryName !== undefined || primaryEmail !== undefined || primaryPhone !== undefined) {
          const partner = partners.value.find((p) => p.id === id)
          const contact = partner?.Contacts.find((c) => c.isPrimary) ?? partner?.Contacts[0]
          const body = {
            name: primaryName,
            email: primaryEmail,
            phone: primaryPhone,
          }
          if (contact) {
            tasks.push($fetch(`/api/contacts/${contact.id}`, { method: 'PUT', body }))
          } else {
            tasks.push($fetch(`/api/contacts/`, { method: 'POST', body }))
          }
        }
        await Promise.all(tasks)
      })
    )
    await refresh()
  }

  // Creation panel
  const panelOpen = ref(false)
  const nameDraft = ref('')

  function openCreatePanel() {
    nameDraft.value = ''
    panelOpen.value = true
  }

  async function onPanelConfirm() {
    await $fetch('/api/partners', { method: 'POST', body: { name: nameDraft.value } })
    panelOpen.value = false
    await refresh()
  }

  function panelProjects(partner: PartnerRow) {
    return partner.Projects.filter(
      (project) =>
        !props.semesterId || project.Teams.some((team) => team.semesterId === props.semesterId)
    )
  }

  // Contact creation modal
  const contactModalOpen = ref(false)
  const contactModalPartnerId = ref<string | null>(null)
  const contactDraft = reactive({ name: '', email: '', phone: '' })

  function openContactModal(partner: PartnerRow) {
    contactModalPartnerId.value = partner.id
    contactDraft.name = ''
    contactDraft.email = ''
    contactDraft.phone = ''
    contactModalOpen.value = true
  }

  async function submitContact() {
    if (!contactModalPartnerId.value) return
    const body: ContactCreate = {
      partnerId: contactModalPartnerId.value,
      name: contactDraft.name,
      email: contactDraft.email,
      phone: contactDraft.phone || undefined,
    }
    await $fetch('/api/contacts', { method: 'POST', body })
    contactModalOpen.value = false
    await refresh()
  }

  async function deleteContact(contactId: string) {
    await $fetch(`/api/contacts/${contactId}`, { method: 'DELETE' })
    await refresh()
  }

  async function makeContactPrimary(contactId: string) {
    await $fetch(`/api/contacts/${contactId}`, { method: 'PUT', body: { isPrimary: true } })
    await refresh()
  }

  // Inline contact editing
  const editingContactId = ref<string | null>(null)
  const contactEditDraft = reactive({ name: '', email: '', phone: '' })

  function startEditContact(contact: ContactRead) {
    editingContactId.value = contact.id
    contactEditDraft.name = contact.name
    contactEditDraft.email = contact.email
    contactEditDraft.phone = contact.phone ?? ''
  }

  function cancelEditContact() {
    editingContactId.value = null
  }

  async function saveContactEdit(contactId: string) {
    await $fetch(`/api/contacts/${contactId}`, {
      method: 'PUT',
      body: {
        name: contactEditDraft.name,
        email: contactEditDraft.email,
        phone: contactEditDraft.phone || undefined,
      },
    })
    editingContactId.value = null
    await refresh()
  }
</script>

<template>
  <div>
    <DataTable
      :data="rows"
      :columns="columns"
      :row-key="(row) => row.id"
      :loading="status === 'pending'"
      expandable
      @add="openCreatePanel"
      @delete-request="onDeleteRequest"
      @save-edits="onSaveEdits"
    >
      <template #expanded="{ row }">
        <div class="space-y-4 p-3">
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <h3 class="font-semibold">Contacts</h3>
              <UButton
                label="Add Contact"
                :icon="ACTION_ICONS.add"
                size="xs"
                variant="soft"
                @click="openContactModal(row)"
              />
            </div>
            <ul class="space-y-1">
              <li
                v-for="contact in row.Contacts"
                :key="contact.id"
                class="rounded border border-gray-200 p-2 text-sm dark:border-gray-800"
              >
                <div v-if="editingContactId === contact.id" class="space-y-2">
                  <div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <UInput v-model="contactEditDraft.name" placeholder="Name" size="xs" />
                    <UInput v-model="contactEditDraft.email" placeholder="Email" size="xs" />
                    <UInput v-model="contactEditDraft.phone" placeholder="Phone" size="xs" />
                  </div>
                  <div class="flex justify-end gap-1">
                    <UButton
                      label="Cancel"
                      :icon="ACTION_ICONS.cancel"
                      size="xs"
                      color="neutral"
                      variant="soft"
                      @click="cancelEditContact"
                    />
                    <UButton
                      label="Save"
                      :icon="ACTION_ICONS.confirm"
                      size="xs"
                      @click="saveContactEdit(contact.id)"
                    />
                  </div>
                </div>
                <div v-else class="flex items-center justify-between">
                  <div>
                    <span class="font-medium">{{ contact.name }}</span>
                    <UBadge v-if="contact.isPrimary" size="xs" class="ml-2">Primary</UBadge>
                    <div class="text-gray-500">{{ contact.email || '—' }}</div>
                    <div class="text-gray-500">{{ contact.phone || '—' }}</div>
                  </div>
                  <div class="flex items-center gap-1">
                    <UButton
                      label="Edit"
                      icon="i-heroicons-pencil"
                      size="xs"
                      color="neutral"
                      variant="ghost"
                      @click="startEditContact(contact)"
                    />
                    <UButton
                      v-if="!contact.isPrimary"
                      label="Make Primary"
                      icon="i-heroicons-star"
                      size="xs"
                      color="neutral"
                      variant="ghost"
                      @click="makeContactPrimary(contact.id)"
                    />
                    <UButton
                      label="Delete"
                      :icon="ACTION_ICONS.delete"
                      size="xs"
                      color="error"
                      variant="ghost"
                      @click="deleteContact(contact.id)"
                    />
                  </div>
                </div>
              </li>
            </ul>
          </div>

          <div class="space-y-2">
            <h3 class="font-semibold">Projects</h3>
            <ul class="space-y-1">
              <li
                v-for="project in panelProjects(row)"
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

    <RecordPanel v-model:open="panelOpen" title="New Partner" @confirm="onPanelConfirm">
      <div class="space-y-6">
        <UFormField label="Name">
          <UInput v-model="nameDraft" class="w-full" />
        </UFormField>
      </div>
    </RecordPanel>

    <UModal v-model:open="contactModalOpen" title="Add Contact">
      <template #body>
        <div class="space-y-4">
          <UFormField label="Name">
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
            <UButton label="Confirm" :icon="ACTION_ICONS.confirm" @click="submitContact" />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
