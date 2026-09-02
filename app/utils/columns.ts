// Builders for the two DataTable column shapes that repeat across every tab. Anything with a less
// common mix of options stays a plain literal — a builder with an option per field would read worse
// than the object it replaces.

import type { DataTableColumn } from '~/components/DataTable.vue'
import type { SelectOption } from '~/utils/options'

/** Sortable, search-filtered, inline text-editable — the default for a plain string field. */
export function textColumn<T extends Record<string, any>>(
  accessorKey: keyof T & string,
  header: string,
  extra?: Partial<DataTableColumn<T>>
): DataTableColumn<T> {
  return {
    id: accessorKey,
    header,
    accessorKey,
    sortable: true,
    filter: { type: 'search' },
    editable: { type: 'text' },
    ...extra,
  }
}

/** Multiselect-filtered and select-editable over one set of enum options. */
export function enumColumn<T extends Record<string, any>>(
  accessorKey: keyof T & string,
  header: string,
  options: SelectOption<any>[],
  extra?: Partial<DataTableColumn<T>>
): DataTableColumn<T> {
  return {
    id: accessorKey,
    header,
    accessorKey,
    filter: { type: 'multiselect', options: options as { label: string; value: string }[] },
    editable: { type: 'select', options },
    ...extra,
  }
}
