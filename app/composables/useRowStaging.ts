// Ambient access to a tab's staging store for everything rendered inside a row expansion.
//
// `staging` and `saving` are the same object for every node in a tab's subtree, so they inject.
// `rowId`, the row record, and the card being rendered vary per node and stay props — injection
// cannot express per-instance values, and a per-row provide would be worse than the prop.

import type { StagedChanges } from '~/composables/useStagedChanges'

/**
 * Row-expansion components only ever edit a row's own fields or its nested children — never the
 * row-lifecycle group (`rows`), which is DataTable.vue's own machinery. Narrowing the injected type
 * to this subset keeps that distinction visible at every call site that injects it.
 */
export type RowFieldStaging = Pick<StagedChanges, 'fields' | 'children'>

export interface RowStagingContext {
  staging: RowFieldStaging
  saving: Readonly<Ref<boolean>>
}

export const ROW_STAGING_KEY: InjectionKey<RowStagingContext> = Symbol('row-staging')

export function provideRowStaging(context: RowStagingContext) {
  provide(ROW_STAGING_KEY, context)
}

export function useRowStaging(): RowStagingContext {
  const context = inject(ROW_STAGING_KEY)
  if (!context) throw new Error('useRowStaging() needs provideRowStaging() on an ancestor')
  return context
}
