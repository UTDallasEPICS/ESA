<script setup lang="ts" generic="T extends Record<string, any>">
  import { h, resolveComponent } from 'vue'
  import type { Row, SortingState, ColumnFiltersState } from '@tanstack/vue-table'
  import type { TableColumn } from '@nuxt/ui'
  import { ACTION_ICONS } from '~/utils/icons'

  export interface DataTableFilter {
    type: 'search' | 'multiselect'
    options?: { label: string; value: string }[]
  }

  export interface DataTableEditable {
    type: 'text' | 'select'
    options?: { label: string; value: string }[]
  }

  export interface DataTableColumn<T> {
    id: string
    header: string
    accessorKey: keyof T & string
    format?: (value: any, row: T) => string
    clickable?: boolean
    sortable?: boolean
    filter?: DataTableFilter
    editable?: DataTableEditable
  }

  const props = defineProps<{
    data: T[]
    columns: DataTableColumn<T>[]
    rowKey: (row: T) => string
    loading?: boolean
  }>()

  const emit = defineEmits<{
    add: []
    'delete-request': [ids: string[]]
    'row-click': [row: T]
    'save-edits': [edits: Record<string, Record<string, any>>]
  }>()

  const sorting = ref<SortingState>([])
  const columnFilters = ref<ColumnFiltersState>([])
  const rowSelection = ref<Record<string, boolean>>({})
  const pagination = ref({ pageIndex: 0, pageSize: 10 })

  const page = computed({
    get: () => pagination.value.pageIndex + 1,
    set: (p: number) => {
      pagination.value.pageIndex = p - 1
    },
  })

  watch(
    () => pagination.value.pageSize,
    () => {
      pagination.value.pageIndex = 0
    }
  )

  const editingCells = ref(new Set<string>())
  const pendingEdits = ref<Record<string, Record<string, any>>>({})
  const hasPendingEdits = computed(() => Object.keys(pendingEdits.value).length > 0)

  function sortStateFor(colId: string): 'unset' | 'asc' | 'desc' {
    const entry = sorting.value.find((s) => s.id === colId)
    if (!entry) return 'unset'
    return entry.desc ? 'desc' : 'asc'
  }

  function cycleSort(colId: string) {
    const state = sortStateFor(colId)
    if (state === 'unset') sorting.value = [{ id: colId, desc: false }]
    else if (state === 'asc') sorting.value = [{ id: colId, desc: true }]
    else sorting.value = []
  }

  function filterValueFor(colId: string) {
    return columnFilters.value.find((f) => f.id === colId)?.value
  }

  function setFilterValue(colId: string, value: any) {
    const rest = columnFilters.value.filter((f) => f.id !== colId)
    const isEmpty = value === undefined || value === '' || (Array.isArray(value) && !value.length)
    columnFilters.value = isEmpty ? rest : [...rest, { id: colId, value }]
  }

  function renderHeader(col: DataTableColumn<T>) {
    const children = [h('span', { class: 'font-medium' }, col.header)]

    if (col.sortable) {
      const state = sortStateFor(col.id)
      const icon =
        state === 'asc'
          ? 'i-heroicons-arrow-up'
          : state === 'desc'
            ? 'i-heroicons-arrow-down'
            : 'i-heroicons-arrows-up-down'
      children.push(
        h(resolveComponent('UButton'), {
          icon,
          size: 'xs',
          color: 'neutral',
          variant: 'ghost',
          'aria-label': `Sort by ${col.header}`,
          onClick: () => cycleSort(col.id),
        })
      )
    }

    if (col.filter) {
      const value = filterValueFor(col.id)
      if (col.filter.type === 'search') {
        children.push(
          h(resolveComponent('UInput'), {
            modelValue: value ?? '',
            size: 'xs',
            placeholder: 'Filter…',
            class: 'w-28',
            'onUpdate:modelValue': (v: string) => setFilterValue(col.id, v),
          })
        )
      } else {
        children.push(
          h(resolveComponent('USelectMenu'), {
            modelValue: value ?? [],
            items: col.filter.options ?? [],
            valueKey: 'value',
            multiple: true,
            size: 'xs',
            placeholder: 'Filter…',
            class: 'w-28',
            'onUpdate:modelValue': (v: string[]) => setFilterValue(col.id, v),
          })
        )
      }
      if (value !== undefined && value !== '' && !(Array.isArray(value) && !value.length)) {
        children.push(
          h(resolveComponent('UButton'), {
            icon: ACTION_ICONS.cancel,
            size: 'xs',
            color: 'neutral',
            variant: 'ghost',
            'aria-label': `Clear ${col.header} filter`,
            onClick: () => setFilterValue(col.id, undefined),
          })
        )
      }
    }

    return h('div', { class: 'flex flex-col gap-1 py-1' }, children)
  }

  function renderCell(col: DataTableColumn<T>, row: Row<T>) {
    const key = `${row.id}::${col.id}`
    const rawValue = row.original[col.accessorKey]

    if (col.editable && editingCells.value.has(key)) {
      const rowEdits = (pendingEdits.value[row.id] ??= {})
      const currentValue = col.accessorKey in rowEdits ? rowEdits[col.accessorKey] : rawValue

      if (col.editable.type === 'select') {
        return h(resolveComponent('USelectMenu'), {
          modelValue: currentValue,
          items: col.editable.options ?? [],
          valueKey: 'value',
          class: 'w-full',
          'onUpdate:modelValue': (v: any) => {
            rowEdits[col.accessorKey] = v
          },
        })
      }
      return h(resolveComponent('UInput'), {
        modelValue: currentValue,
        class: 'w-full',
        'onUpdate:modelValue': (v: any) => {
          rowEdits[col.accessorKey] = v
        },
      })
    }

    const display = col.format ? col.format(rawValue, row.original) : String(rawValue ?? '')

    if (col.clickable) {
      return h(
        'button',
        {
          type: 'button',
          class: 'text-primary-500 text-left hover:underline',
          onClick: () => emit('row-click', row.original),
        },
        display || '—'
      )
    }

    if (col.editable) {
      return h(
        'button',
        {
          type: 'button',
          class: 'w-full cursor-text text-left',
          onClick: () => {
            editingCells.value.add(key)
            pendingEdits.value[row.id] ??= {}
          },
        },
        display || '—'
      )
    }

    return h('span', display || '—')
  }

  const tableColumns = computed<TableColumn<T>[]>(() => [
    {
      id: 'select',
      header: ({ table }) =>
        h(resolveComponent('UCheckbox'), {
          modelValue: table.getIsAllRowsSelected()
            ? true
            : table.getIsSomeRowsSelected()
              ? 'indeterminate'
              : false,
          'aria-label': 'Select all rows',
          'onUpdate:modelValue': (v: boolean) => table.toggleAllRowsSelected(!!v),
        }),
      cell: ({ row }) =>
        h(resolveComponent('UCheckbox'), {
          modelValue: row.getIsSelected(),
          'aria-label': 'Select row',
          'onUpdate:modelValue': (v: boolean) => row.toggleSelected(!!v),
        }),
    },
    ...props.columns.map(
      (col): TableColumn<T> => ({
        id: col.id,
        accessorKey: col.accessorKey,
        enableSorting: !!col.sortable,
        filterFn:
          col.filter?.type === 'multiselect'
            ? (row, id, filterValue: string[]) =>
                !filterValue?.length || filterValue.includes(String(row.getValue(id)))
            : col.filter?.type === 'search'
              ? (row, id, filterValue: string) =>
                  !filterValue ||
                  String(row.getValue(id) ?? '')
                    .toLowerCase()
                    .includes(String(filterValue).toLowerCase())
              : undefined,
        header: () => renderHeader(col),
        cell: ({ row }) => renderCell(col, row),
      })
    ),
  ])

  const selectedRowIds = computed(() =>
    Object.keys(rowSelection.value).filter((id) => rowSelection.value[id])
  )

  function onAdd() {
    emit('add')
  }

  function onDeleteClick() {
    const ids = selectedRowIds.value.map((idx) => props.rowKey(props.data[Number(idx)]))
    emit('delete-request', ids)
    rowSelection.value = {}
  }

  function onConfirmEdits() {
    const edits: Record<string, Record<string, any>> = {}
    for (const [idx, changes] of Object.entries(pendingEdits.value)) {
      const id = props.rowKey(props.data[Number(idx)])
      edits[id] = changes
    }
    emit('save-edits', edits)
    editingCells.value = new Set()
    pendingEdits.value = {}
  }

  function onCancelEdits() {
    editingCells.value = new Set()
    pendingEdits.value = {}
  }
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center gap-2">
      <UButton :icon="ACTION_ICONS.add" label="Add" color="neutral" variant="soft" @click="onAdd" />
      <UButton
        :icon="ACTION_ICONS.delete"
        label="Delete"
        color="error"
        variant="soft"
        :disabled="!selectedRowIds.length"
        @click="onDeleteClick"
      />
      <template v-if="hasPendingEdits">
        <UButton
          :icon="ACTION_ICONS.confirm"
          label="Confirm"
          color="primary"
          @click="onConfirmEdits"
        />
        <UButton
          :icon="ACTION_ICONS.cancel"
          label="Cancel"
          color="neutral"
          variant="soft"
          @click="onCancelEdits"
        />
      </template>
    </div>

    <UTable
      v-model:sorting="sorting"
      v-model:column-filters="columnFilters"
      v-model:row-selection="rowSelection"
      v-model:pagination="pagination"
      :data="data"
      :columns="tableColumns"
      :loading="loading"
      sticky
      class="max-h-[32rem]"
    />

    <div class="flex items-center justify-between">
      <USelectMenu v-model="pagination.pageSize" :items="[10, 25, 50]" class="w-24" />
      <UPagination
        v-model:page="page"
        :total="data.length"
        :items-per-page="pagination.pageSize"
        first-icon="i-heroicons-chevron-double-left"
        prev-icon="i-heroicons-chevron-left"
        next-icon="i-heroicons-chevron-right"
        last-icon="i-heroicons-chevron-double-right"
      />
    </div>
  </div>
</template>
