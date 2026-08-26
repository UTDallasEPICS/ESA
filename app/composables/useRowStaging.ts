// Ambient access to a tab's staging store for everything rendered inside a row expansion.
//
// `staging` and `saving` are the same object for every node in a tab's subtree, so they inject.
// `rowId`, the row record, and the card being rendered vary per node and stay props — injection
// cannot express per-instance values, and a per-row provide would be worse than the prop.

import type { StagedChanges } from '~/composables/useStagedChanges'

export interface RowStagingContext {
  staging: StagedChanges
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
