<script setup lang="ts">
  import type { DataTableColumn } from '~/components/DataTable.vue'
  import { groupChildren, type StagedRecord } from '~/composables/useStagedChanges'
  import { textColumn } from '~/utils/columns'
  import type { PartnerCreate, PartnerRead, PartnerUpdate } from '#server/services/partnerService'
  import type { ContactCreate } from '#server/services/contactService'
  import { useSemesterFilter } from '~/composables/useSemesterFilter'
  import { useRecordModals } from '~/composables/useRecordModals'
  import { useStagedSave } from '~/composables/useStagedSave'
  import { provideRowStaging } from '~/composables/useRowStaging'

  interface PartnerRow extends PartnerRead {
    primaryName: string
    primaryEmail: string
    primaryPhone: string
  }

  type ContactField = 'name' | 'email' | 'phone'

  const { semesterId, guard } = useSemesterFilter()
  const { openContactModal } = useRecordModals()

  const staging = useStagedChanges()
  guard(staging)

  const {
    data: partners,
    refresh,
    status,
  } = useFetch<PartnerRead[]>('/api/partners', {
    key: 'partners',
    query: computed(() => ({ semesterId: semesterId.value })),
    default: () => [],
  })

  // Registers every partner's contacts, so contactValue/setContact (and the proxy columns' get/set
  // calls) never have to look up the fetched original themselves.
  watch(
    partners,
    (list) => {
      for (const partner of list) {
        staging.registerChildren(partner.id, 'Contacts', partner.Contacts ?? [], (c) => c.id)
      }
    },
    { immediate: true }
  )

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
    return textColumn<PartnerRow>(accessorKey, header, {
      id,
      editable: {
        type: 'text',
        child: (row) => ({ collection: 'Contacts', id: contactTargetId(row), field }),
      },
    })
  }

  const columns: DataTableColumn<PartnerRow>[] = [
    textColumn<PartnerRow>('name', 'Name', { required: true }),
    contactColumn('primaryName', 'Contact', 'primaryName', 'name'),
    contactColumn('primaryEmail', 'Email', 'primaryEmail', 'email'),
    contactColumn('primaryPhone', 'Phone', 'primaryPhone', 'phone'),
  ]

  function newRow() {
    return { id: '', name: '', Contacts: [], Projects: [] }
  }

  function projectsFor(row: PartnerRow) {
    return (row.Projects ?? []).filter(
      (project) =>
        !semesterId.value || project.Teams.some((team) => team.semesterId === semesterId.value)
    )
  }

  /** Stages the contact under its partner row; the POST happens on the table's Confirm (§3.3.3). */
  async function addContact(rowId: string) {
    const draft = await openContactModal()
    if (draft) staging.addChild(rowId, 'Contacts', draft)
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
    const contacts = groupChildren(record.children.Contacts)
      .added.map((child) => ({ ...contactBody(child.fields), isPrimary: !!child.fields.isPrimary }))
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

    const { added, edited, deleted } = groupChildren(record.children.Contacts)
    for (const child of added) {
      await $fetch('/api/contacts', {
        method: 'POST',
        body: { partnerId: record.id, ...contactBody(child.fields) },
      })
    }
    for (const child of edited) {
      await $fetch(`/api/contacts/${child.id}`, { method: 'PUT', body: child.fields })
    }
    for (const child of deleted) {
      await $fetch(`/api/contacts/${child.id}`, { method: 'DELETE' })
    }
  }

  async function deletePartner(id: string) {
    await $fetch(`/api/partners/${id}`, { method: 'DELETE' })
  }

  const { saving, onSave } = useStagedSave({
    staging,
    entity: 'partner',
    cascade: 'This will also delete all associated contacts and projects.',
    affected: (ids) => {
      const selected = rows.value.filter((row) => ids.includes(row.id))
      return [
        { label: 'Contact', count: selected.reduce((n, p) => n + p.Contacts.length, 0) },
        { label: 'Project', count: selected.reduce((n, p) => n + p.Projects.length, 0) },
      ]
    },
    refresh,
    create: createPartner,
    update: updatePartner,
    delete: deletePartner,
  })

  provideRowStaging({ staging, saving })
</script>

<template>
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
        <PartnerContactList
          :row-id="rowId"
          :row="row"
          :disabled="deleted"
          @add="addContact(rowId)"
        />

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
</template>
