<script setup lang="ts">
  import type { DataTableColumn } from '~/components/DataTable.vue'
  import { ACTION_ICONS } from '~/utils/icons'
  import type { PartnerRead } from '#server/services/partnerService'
  import type { ContactCreate } from '#server/services/contactService'

  const props = defineProps<{ semesterId?: string }>()

  interface PartnerRow extends PartnerRead {
    primaryEmail: string
    primaryPhone: string
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
      return { ...partner, primaryEmail: primary?.email ?? '', primaryPhone: primary?.phone ?? '' }
    })
  )

  const columns: DataTableColumn<PartnerRow>[] = [
    {
      id: 'name',
      header: 'Name',
      accessorKey: 'name',
      sortable: true,
      filter: { type: 'search' },
      clickable: true,
      editable: { type: 'text' },
    },
    { id: 'primaryEmail', header: 'Email', accessorKey: 'primaryEmail', sortable: true },
    { id: 'primaryPhone', header: 'Phone', accessorKey: 'primaryPhone' },
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
      Object.entries(edits).map(([id, changes]) =>
        $fetch(`/api/partners/${id}`, { method: 'PUT', body: changes })
      )
    )
    await refresh()
  }

  // Item / creation panel
  const panelOpen = ref(false)
  const panelMode = ref<'view' | 'create'>('create')
  const selected = ref<PartnerRow | null>(null)
  const nameDraft = ref('')

  function openCreatePanel() {
    panelMode.value = 'create'
    selected.value = null
    nameDraft.value = ''
    panelOpen.value = true
  }

  function onRowClick(row: PartnerRow) {
    panelMode.value = 'view'
    selected.value = row
    nameDraft.value = row.name
    panelOpen.value = true
  }

  const panelProjects = computed(() => {
    if (!selected.value) return []
    return selected.value.Projects.filter(
      (project) =>
        !props.semesterId || project.Teams.some((team) => team.semesterId === props.semesterId)
    )
  })

  async function onPanelConfirm() {
    if (panelMode.value === 'create') {
      await $fetch('/api/partners', { method: 'POST', body: { name: nameDraft.value } })
    } else if (selected.value) {
      await $fetch(`/api/partners/${selected.value.id}`, {
        method: 'PUT',
        body: { name: nameDraft.value },
      })
    }
    panelOpen.value = false
    await refresh()
  }

  async function onPanelDelete() {
    if (!selected.value) return
    const ok = await confirm({
      title: `Delete ${selected.value.name}?`,
      description: 'This will also delete all associated contacts and projects.',
      affected: [
        { label: 'Contact', count: selected.value.Contacts.length },
        { label: 'Project', count: selected.value.Projects.length },
      ],
    })
    if (!ok) return
    await $fetch(`/api/partners/${selected.value.id}`, { method: 'DELETE' })
    panelOpen.value = false
    await refresh()
  }

  // Contact creation modal
  const contactModalOpen = ref(false)
  const contactDraft = reactive({ name: '', email: '', phone: '' })

  function openContactModal() {
    contactDraft.name = ''
    contactDraft.email = ''
    contactDraft.phone = ''
    contactModalOpen.value = true
  }

  async function submitContact() {
    if (!selected.value) return
    const body: ContactCreate = {
      partnerId: selected.value.id,
      name: contactDraft.name,
      email: contactDraft.email,
      phone: contactDraft.phone || undefined,
    }
    await $fetch('/api/contacts', { method: 'POST', body })
    contactModalOpen.value = false
    await refresh()
    selected.value = rows.value.find((p) => p.id === selected.value?.id) ?? null
  }

  async function deleteContact(contactId: string) {
    await $fetch(`/api/contacts/${contactId}`, { method: 'DELETE' })
    await refresh()
    selected.value = rows.value.find((p) => p.id === selected.value?.id) ?? null
  }
</script>

<template>
  <div>
    <DataTable
      :data="rows"
      :columns="columns"
      :row-key="(row) => row.id"
      :loading="status === 'pending'"
      @add="openCreatePanel"
      @delete-request="onDeleteRequest"
      @save-edits="onSaveEdits"
      @row-click="onRowClick"
    />

    <RecordPanel
      v-model:open="panelOpen"
      :title="panelMode === 'create' ? 'New Partner' : selected?.name ?? 'Partner'"
      :mode="panelMode"
      @confirm="onPanelConfirm"
      @delete="onPanelDelete"
    >
      <div class="space-y-6">
        <UFormField label="Name">
          <UInput v-model="nameDraft" class="w-full" />
        </UFormField>

        <div v-if="panelMode === 'view'" class="space-y-2">
          <div class="flex items-center justify-between">
            <h3 class="font-semibold">Contacts</h3>
            <UButton :icon="ACTION_ICONS.add" size="xs" variant="soft" @click="openContactModal" />
          </div>
          <ul class="space-y-1">
            <li
              v-for="contact in selected?.Contacts"
              :key="contact.id"
              class="flex items-center justify-between rounded border border-gray-200 p-2 text-sm dark:border-gray-800"
            >
              <div>
                <span class="font-medium">{{ contact.name }}</span>
                <UBadge v-if="contact.isPrimary" size="xs" class="ml-2">Primary</UBadge>
                <div class="text-gray-500">{{ contact.email }} {{ contact.phone }}</div>
              </div>
              <UButton
                :icon="ACTION_ICONS.delete"
                size="xs"
                color="error"
                variant="ghost"
                @click="deleteContact(contact.id)"
              />
            </li>
          </ul>
        </div>

        <div v-if="panelMode === 'view'" class="space-y-2">
          <h3 class="font-semibold">Projects</h3>
          <ul class="space-y-1">
            <li
              v-for="project in panelProjects"
              :key="project.id"
              class="rounded border border-gray-200 p-2 text-sm dark:border-gray-800"
            >
              {{ project.name }}
            </li>
          </ul>
        </div>
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
