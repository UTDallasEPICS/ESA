<script setup lang="ts" generic="T extends Record<string, any>">
  import { h, resolveComponent } from 'vue'
  import type { Row } from '@tanstack/vue-table'
  import type { TableColumn } from '@nuxt/ui'
  import RecordSearchInput from '~/components/RecordSearchInput.vue'
  import { ACTION_ICONS } from '~/utils/icons'
  import type { StagedChanges, StagedPayload } from '~/composables/useStagedChanges'

  export interface DataTableFilter {
    type: 'search' | 'multiselect'
    options?: { label: string; value: string }[]
  }

  /** Locates the minor record a column edits, when it is a proxy onto one (§3.1.1, §3.2.1). */
  export interface DataTableChildTarget {
    collection: string
    id: string
    field: string
  }

  export interface DataTableEditable<T> {
    type: 'text' | 'select' | 'switch' | 'record-search'
    options?: { label: string; value: any }[]
    /** record-search only. */
    search?: (query: string) => Promise<any[]>
    displayLabel?: (item: any) => string
    toValue?: (item: any) => any
    fromValue?: (value: any, row: T) => any
    /**
     * When set, the column edits a nested minor record rather than the row itself, and shares one
     * staged edit with the matching field in the row's expansion. Returning undefined for a row
     * means there is nothing to edit there yet, and the cell renders read-only.
     */
    child?: (row: T) => DataTableChildTarget | undefined
  }

  export interface DataTableColumn<T> {
    id: string
    header: string
    accessorKey: keyof T & string
    format?: (value: any, row: T) => string
    sortable?: boolean
    filter?: DataTableFilter
    editable?: DataTableEditable<T>
    /** Blocks Confirm while blank on a staged row. */
    required?: boolean
  }

  export interface DataTableRow<T> {
    id: string
    record: T
    state: StageState
    isNew: boolean
    deleted: boolean
  }

  const UButton = resolveComponent('UButton')
  const UInput = resolveComponent('UInput')
  const USelectMenu = resolveComponent('USelectMenu')
  const USwitch = resolveComponent('USwitch')
  const UCheckbox = resolveComponent('UCheckbox')

  const props = defineProps<{
    data: T[]
    columns: DataTableColumn<T>[]
    rowKey: (row: T) => string
    staging: StagedChanges
    loading?: boolean
    expandable?: boolean
    saving?: boolean
    /** Blank draft used by Add. Without it the Add button is not rendered. */
    newRow?: () => Record<string, any>
  }>()

  const emit = defineEmits<{
    save: [payload: StagedPayload]
    cancel: []
  }>()

  // Registers every row's fetched record with the staging store, so fields.get/fields.set never
  // need one passed in — a watcher rather than a computed, since registering is a write and Vue
  // computeds must stay pure.
  watch(
    () => props.data,
    (rows) => {
      for (const row of rows) props.staging.rows.register(props.rowKey(row), row)
    },
    { immediate: true }
  )

  const sort = ref<{ id: string; desc: boolean } | null>(null)
  const filters = ref<Record<string, any>>({})
  const selected = ref<Set<string>>(new Set())
  const expanded = ref<Record<string, boolean>>({})
  const pageIndex = ref(0)
  const pageSize = ref(10)

  const columnById = computed(() => new Map(props.columns.map((col) => [col.id, col])))

  // ------------------------------------------------------------ row values

  /** The value a column shows for a row, reading through whichever stage owns it. */
  function valueFor(col: DataTableColumn<T>, row: DataTableRow<T>) {
    const target = col.editable?.child?.(row.record)
    if (target) {
      return props.staging.children.get(row.id, target.collection, target.id, target.field)
    }
    return props.staging.fields.get(row.id, col.accessorKey)
  }

  function setValueFor(col: DataTableColumn<T>, row: DataTableRow<T>, value: any) {
    const target = col.editable?.child?.(row.record)
    if (target) {
      props.staging.children.set(row.id, target.collection, target.id, target.field, value)
      return
    }
    props.staging.fields.set(row.id, col.accessorKey, value)
  }

  function isEditedFor(col: DataTableColumn<T>, row: DataTableRow<T>) {
    const target = col.editable?.child?.(row.record)
    if (target) {
      return props.staging.children.isEdited(row.id, target.collection, target.id, target.field)
    }
    return props.staging.fields.isEdited(row.id, col.accessorKey)
  }

  /** A column is editable on a row unless it proxies a minor record that does not exist yet. */
  function isEditableOn(col: DataTableColumn<T>, row: DataTableRow<T>) {
    if (!col.editable) return false
    if (col.editable.child) return !!col.editable.child(row.record)
    return true
  }

  // ---------------------------------------------------------------- rows

  const draftRows = computed<DataTableRow<T>[]>(() =>
    props.staging.rows.drafts().map(({ id, fields }) => ({
      id,
      record: fields as T,
      state: 'new' as StageState,
      isNew: true,
      deleted: false,
    }))
  )

  const existingRows = computed<DataTableRow<T>[]>(() =>
    props.data.map((record) => {
      const id = props.rowKey(record)
      const state = props.staging.rows.state(id)
      return {
        id,
        record: props.staging.rows.merge<T>(id),
        state,
        isNew: false,
        deleted: state === 'deleted',
      }
    })
  )

  /**
   * What the user actually reads in the cell — the key a search filter and a sort must work on, so
   * that a column storing an id but displaying a name (Partner) searches and sorts by the name.
   * Multiselect filters deliberately keep the raw value, since their options carry raw enum values.
   */
  function displayValueFor(col: DataTableColumn<T>, row: DataTableRow<T>) {
    const value = valueFor(col, row)
    return col.format ? col.format(value, row.record) : value
  }

  const filteredRows = computed(() => {
    const active = Object.entries(filters.value).filter(([, value]) => !isEmptyFilter(value))
    if (!active.length) return existingRows.value
    return existingRows.value.filter((row) =>
      active.every(([colId, value]) => {
        const col = columnById.value.get(colId)
        if (!col) return true
        if (col.filter?.type === 'multiselect') {
          return (value as string[]).includes(String(valueFor(col, row)))
        }
        return String(displayValueFor(col, row) ?? '')
          .toLowerCase()
          .includes(String(value).toLowerCase())
      })
    )
  })

  const sortedRows = computed(() => {
    const state = sort.value
    if (!state) return filteredRows.value
    const col = columnById.value.get(state.id)
    if (!col) return filteredRows.value
    return [...filteredRows.value].sort((a, b) => {
      const av = displayValueFor(col, a)
      const bv = displayValueFor(col, b)
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      const result =
        typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' })
      return state.desc ? -result : result
    })
  })

  const pageCount = computed(() => Math.max(1, Math.ceil(sortedRows.value.length / pageSize.value)))

  const pagedRows = computed(() => {
    const start = pageIndex.value * pageSize.value
    return sortedRows.value.slice(start, start + pageSize.value)
  })

  // Staged additions are pinned to the top of the first page, exempt from sorting and filtering,
  // so a half-filled row can never drop out of view (§2.3.1).
  const visibleRows = computed(() =>
    pageIndex.value === 0 ? [...draftRows.value, ...pagedRows.value] : pagedRows.value
  )

  watch([filteredRows, pageSize], () => {
    if (pageIndex.value > pageCount.value - 1) pageIndex.value = 0
  })

  // ------------------------------------------------------------- toolbar

  const stagedRows = computed(() => [
    ...draftRows.value,
    ...existingRows.value.filter((row) => row.state !== 'clean'),
  ])

  const invalidRowIds = computed(() => {
    const ids = new Set<string>()
    for (const row of stagedRows.value) {
      if (row.deleted) continue
      for (const col of props.columns) {
        if (!col.required || !isEditableOn(col, row)) continue
        const value = valueFor(col, row)
        if (value === undefined || value === null || value === '') ids.add(row.id)
      }
    }
    return ids
  })

  const isDirty = computed(() => props.staging.isDirty.value)
  const hasInvalid = computed(() => invalidRowIds.value.size > 0)

  // Undo is only enabled once the selection actually contains something to undo — a selected but
  // untouched row contributes nothing.
  const hasUndoableSelection = computed(() =>
    [...selected.value].some((id) => props.staging.rows.state(id) !== 'clean')
  )

  function onAdd() {
    if (!props.newRow) return
    const id = props.staging.rows.add(props.newRow())
    pageIndex.value = 0
    if (props.expandable) expanded.value = { ...expanded.value, [id]: true }
  }

  function onDelete() {
    props.staging.rows.markDeleted([...selected.value])
    selected.value = new Set()
  }

  function onUndo() {
    for (const id of selected.value) props.staging.rows.undo(id)
    selected.value = new Set()
  }

  function onConfirm() {
    emit('save', props.staging.payload())
  }

  function onCancel() {
    props.staging.reset()
    selected.value = new Set()
    emit('cancel')
  }

  // ------------------------------------------------------------ rendering

  function isEmptyFilter(value: any) {
    return value === undefined || value === '' || (Array.isArray(value) && !value.length)
  }

  function setFilter(colId: string, value: any) {
    filters.value = { ...filters.value, [colId]: value }
    pageIndex.value = 0
  }

  function cycleSort(colId: string) {
    const state = sort.value
    if (!state || state.id !== colId) sort.value = { id: colId, desc: false }
    else if (!state.desc) sort.value = { id: colId, desc: true }
    else sort.value = null
  }

  function sortIcon(colId: string) {
    const state = sort.value
    if (!state || state.id !== colId) return ACTION_ICONS.sortUnset
    return state.desc ? ACTION_ICONS.sortDesc : ACTION_ICONS.sortAsc
  }

  function renderHeader(col: DataTableColumn<T>) {
    const labelAndSortControl = [h('span', { class: 'font-medium' }, col.header)]
    if (col.sortable) {
      labelAndSortControl.push(
        h(UButton, {
          icon: sortIcon(col.id),
          size: 'xs',
          color: 'neutral',
          variant: 'ghost',
          'aria-label': `Sort by ${col.header}`,
          onClick: () => cycleSort(col.id),
        })
      )
    }

    const children = [
      h('span', { class: 'flex flex-row justify-between gap-1' }, labelAndSortControl),
    ]

    if (col.filter) {
      const value = filters.value[col.id]
      children.push(
        col.filter.type === 'search'
          ? h(UInput, {
              modelValue: value ?? '',
              size: 'xs',
              placeholder: 'Filter…',
              class: 'w-28',
              'onUpdate:modelValue': (v: string) => setFilter(col.id, v),
            })
          : h(USelectMenu, {
              modelValue: value ?? [],
              items: col.filter.options ?? [],
              valueKey: 'value',
              multiple: true,
              size: 'xs',
              placeholder: 'Filter…',
              class: 'w-28',
              'onUpdate:modelValue': (v: string[]) => setFilter(col.id, v),
            })
      )
      if (!isEmptyFilter(value)) {
        children.push(
          h(UButton, {
            icon: ACTION_ICONS.cancel,
            size: 'xs',
            color: 'neutral',
            variant: 'ghost',
            'aria-label': `Clear ${col.header} filter`,
            onClick: () => setFilter(col.id, undefined),
          })
        )
      }
    }

    return h('div', { class: 'flex flex-col items-start gap-1 py-1' }, children)
  }

  function renderCell(col: DataTableColumn<T>, row: DataTableRow<T>) {
    const value = valueFor(col, row)

    if (!isEditableOn(col, row)) {
      const display = col.format ? col.format(value, row.record) : String(value ?? '')
      return h('span', display || '—')
    }

    const editable = col.editable!
    const edited = isEditedFor(col, row)
    const invalid =
      !!col.required &&
      (value === undefined || value === null || value === '') &&
      row.state !== 'clean'
    const disabled = row.deleted || props.saving
    const onUpdate = (v: any) => setValueFor(col, row, v)

    // A staged new row is already tinted green, so only existing rows get the per-field outline.
    const highlight = invalid || (edited && !row.isNew)
    const color = invalid ? 'error' : 'warning'

    if (editable.type === 'switch') {
      return h(USwitch, {
        modelValue: !!value,
        color: 'info',
        disabled,
        ui: highlight ? { base: `ring-2 ring-${color}` } : undefined,
        'onUpdate:modelValue': onUpdate,
      })
    }

    if (editable.type === 'select') {
      return h(USelectMenu, {
        modelValue: value ?? undefined,
        items: editable.options ?? [],
        valueKey: 'value',
        class: 'w-full',
        disabled,
        highlight,
        color,
        'onUpdate:modelValue': onUpdate,
      })
    }

    if (editable.type === 'record-search') {
      return h(RecordSearchInput, {
        modelValue: editable.fromValue?.(value, row.record),
        search: editable.search ?? (async () => []),
        displayLabel: editable.displayLabel ?? ((item: any) => String(item?.name ?? '')),
        placeholder: 'Search…',
        disabled,
        highlight,
        color,
        class: 'w-full',
        'onUpdate:modelValue': (item: any) =>
          onUpdate(item ? (editable.toValue?.(item) ?? item) : undefined),
      })
    }

    return h(UInput, {
      modelValue: value ?? '',
      class: 'w-full',
      variant: 'ghost',
      disabled,
      highlight,
      color,
      'onUpdate:modelValue': onUpdate,
    })
  }

  const allSelected = computed(
    () =>
      filteredRows.value.length > 0 && filteredRows.value.every((row) => selected.value.has(row.id))
  )
  const someSelected = computed(() => selected.value.size > 0 && !allSelected.value)

  function toggleAll() {
    selected.value = allSelected.value
      ? new Set()
      : new Set(filteredRows.value.map((row) => row.id))
  }

  function toggleRow(id: string, on: boolean) {
    const next = new Set(selected.value)
    if (on) next.add(id)
    else next.delete(id)
    selected.value = next
  }

  const tableColumns = computed<TableColumn<DataTableRow<T>>[]>(() => [
    ...(props.expandable
      ? [
          {
            id: 'expand',
            header: '',
            cell: ({ row }: { row: Row<DataTableRow<T>> }) =>
              h(UButton, {
                icon: row.getIsExpanded() ? ACTION_ICONS.collapse : ACTION_ICONS.expand,
                size: 'xs',
                color: 'neutral',
                variant: 'ghost',
                'aria-label': row.getIsExpanded() ? 'Collapse row' : 'Expand row',
                onClick: () => row.toggleExpanded(),
              }),
          } satisfies TableColumn<DataTableRow<T>>,
        ]
      : []),
    {
      id: 'select',
      header: () =>
        h(UCheckbox, {
          modelValue: allSelected.value ? true : someSelected.value ? 'indeterminate' : false,
          'aria-label': 'Select all rows',
          'onUpdate:modelValue': () => toggleAll(),
        }),
      // Staged-new rows are selectable too: Delete drops them from the store outright (§2.3.1).
      cell: ({ row }: { row: Row<DataTableRow<T>> }) =>
        h(UCheckbox, {
          modelValue: selected.value.has(row.original.id),
          'aria-label': 'Select row',
          'onUpdate:modelValue': (v: boolean) => toggleRow(row.original.id, v),
        }),
    },
    ...props.columns.map(
      (col): TableColumn<DataTableRow<T>> => ({
        id: col.id,
        header: () => renderHeader(col),
        cell: ({ row }: { row: Row<DataTableRow<T>> }) => renderCell(col, row.original),
      })
    ),
  ])

  const tableMeta = computed(() => ({
    class: { tr: (row: Row<DataTableRow<T>>) => STAGE_TINTS[row.original.state] },
  }))
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center gap-2">
      <UButton
        v-if="newRow"
        :icon="ACTION_ICONS.add"
        label="Add"
        color="neutral"
        variant="soft"
        :disabled="saving"
        @click="onAdd"
      />
      <UButton
        :icon="ACTION_ICONS.delete"
        label="Delete"
        color="error"
        variant="soft"
        :disabled="!selected.size || saving"
        @click="onDelete"
      />
      <UButton
        :icon="ACTION_ICONS.undo"
        label="Undo"
        color="neutral"
        variant="soft"
        :disabled="!hasUndoableSelection || saving"
        @click="onUndo"
      />
      <UButton
        :icon="ACTION_ICONS.confirm"
        label="Confirm"
        color="primary"
        :loading="saving"
        :disabled="!isDirty || hasInvalid || saving"
        @click="onConfirm"
      />
      <UButton
        :icon="ACTION_ICONS.cancel"
        label="Cancel"
        color="neutral"
        variant="soft"
        :disabled="!isDirty || saving"
        @click="onCancel"
      />
      <span v-if="isDirty && hasInvalid" class="text-error-500 text-xs">
        Fill in every required field to confirm.
      </span>
    </div>

    <UTable
      sticky
      class="max-h-[70vh]"
      v-model:expanded="expanded"
      :data="visibleRows"
      :columns="tableColumns"
      :loading="loading"
      :meta="tableMeta"
      :get-row-id="(row: DataTableRow<T>) => row.id"
    >
      <template v-if="expandable" #expanded="{ row }">
        <slot
          name="expanded"
          :row="row.original.record"
          :row-id="row.original.id"
          :state="row.original.state"
          :is-new="row.original.isNew"
          :deleted="row.original.deleted"
        />
      </template>
    </UTable>

    <div class="flex items-center justify-between">
      <USelectMenu v-model="pageSize" :items="[10, 25, 50]" class="w-24" />
      <UPagination
        :page="pageIndex + 1"
        :total="sortedRows.length"
        :items-per-page="pageSize"
        first-icon="i-heroicons-chevron-double-left"
        prev-icon="i-heroicons-chevron-left"
        next-icon="i-heroicons-chevron-right"
        last-icon="i-heroicons-chevron-double-right"
        @update:page="(p: number) => (pageIndex = p - 1)"
      />
    </div>
  </div>
</template>
