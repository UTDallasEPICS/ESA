// The envelope every tab's Confirm shares: the delete confirmation, the saving flag, the outer
// create -> update -> delete ordering, the reset-and-refresh, and one error toast.
//
// It deliberately does not try to generalize the requests themselves. What each tab does with a
// StagedRecord is irreducibly different — Projects has to remap team ids it just created, Students
// has to delete before it creates and append-then-move its choices — but all of that is intra-record
// domain logic that belongs in the tab, passed in as `create` / `update` / `remove`.

import { errorMessage } from '~/utils/errors'
import { plural } from '~/utils/labels'

export interface StagedSaveOptions {
  staging: StagedChanges
  /** Lowercase singular for the delete confirmation title, e.g. `partner`. */
  entity: string
  /** The cascade sentence shown under that title. */
  cascade: string
  /** Cascade counts for the rows about to be deleted; the tab reads its own fetched list. */
  affected?: (ids: string[]) => { label: string; count: number }[]
  refresh: () => Promise<unknown>
  create: (record: StagedRecord) => Promise<void>
  update: (record: StagedRecord) => Promise<void>
  delete: (id: string) => Promise<void>
}

export function useStagedSave(options: StagedSaveOptions) {
  const confirm = useConfirm()
  const toast = useToast()
  const saving = ref(false)

  async function onSave(payload: StagedPayload) {
    if (payload.deleted.length) {
      const ok = await confirm({
        title: `Delete ${plural(payload.deleted.length, options.entity)}?`,
        description: options.cascade,
        affected: options.affected?.(payload.deleted),
        confirmLabel: 'Delete',
      })
      if (!ok) return
    }

    saving.value = true
    try {
      for (const record of payload.created) await options.create(record)
      for (const record of payload.updated) await options.update(record)
      for (const id of payload.deleted) await options.delete(id)
      options.staging.reset()
      await options.refresh()
    } catch (error: any) {
      toast.add({
        title: 'Save failed',
        description: errorMessage(error),
        color: 'error',
      })
    } finally {
      saving.value = false
    }
  }

  return { saving, onSave }
}
