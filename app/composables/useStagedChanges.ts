// Per-table staging store for the editing model in docs/design/ui.md §2.3.1.
//
// Every creation, edit, and deletion made in a DataTable — including the ones made inside a row's
// expansion — is held here until Confirm. Nothing in this file talks to the network: the owning tab
// reads `payload()` on Confirm and turns it into API calls itself.
//
// The returned API is grouped by audience rather than flat: `rows` is DataTable's own row-lifecycle
// machinery (nothing outside DataTable.vue calls it); `fields` reads/writes a row's own fields, used
// by DataTable's generic columns and by expansion components editing untabled fields; `children`
// stages nested minor records (Team, Contact, Choice, …) and is the one broadly shared across tabs
// and row-expansion components. `isDirty`/`reset`/`payload` stay top-level because
// `useSemesterFilter.ts`'s `SemesterGuard` expects `{isDirty, reset}` directly on the object passed
// to `guard()`.

export type StageState = 'new' | 'deleted' | 'edited' | 'clean'

/** A staged change to a minor record nested under a row (Team, Contact, Choice, …). */
export interface ChildStage {
  id: string
  isNew: boolean
  deleted: boolean
  /** Edited fields for an existing child; the whole draft for a staged-new one. */
  fields: Record<string, any>
  /**
   * The fetched record this child edits, cached by `children.register` so callers never have to
   * look it up and pass it to every get/set/merge call themselves. Unset for a staged-new child,
   * which has no server-side counterpart to compare against.
   */
  original?: Record<string, any>
}

interface RowStage {
  isNew: boolean
  deleted: boolean
  /** Edited fields for an existing row; the whole draft for a staged-new one. */
  fields: Record<string, any>
  children: Record<string, Record<string, ChildStage>>
  /** The fetched record this row edits, cached by `rows.register`. Unset for a staged-new row. */
  original?: Record<string, any>
}

export interface StagedRecord {
  id: string
  fields: Record<string, any>
  children: Record<string, ChildStage[]>
}

export interface StagedPayload {
  /** Rows added with the Add button, each with any minor records drafted in its expansion. */
  created: StagedRecord[]
  /** Existing rows with edited fields and/or nested changes. */
  updated: StagedRecord[]
  /** Ids of existing rows marked for deletion. */
  deleted: string[]
}

/** An existing or staged-new child merged into one object for rendering. */
export interface MergedChild<C> {
  id: string
  record: C
  state: StageState
  isNew: boolean
  deleted: boolean
}

/** Green / blue / red row and card tints for each stage state (§2.3.1). */
export const STAGE_TINTS: Record<StageState, string> = {
  new: 'bg-success-50 dark:bg-success-950/50',
  edited: 'bg-info-50 dark:bg-info-950/50',
  deleted: 'bg-error-50 dark:bg-error-950/50',
  clean: '',
}

const NEW_PREFIX = 'new:'

function isNewId(id: string) {
  return id.startsWith(NEW_PREFIX)
}

export interface ChildGroups {
  added: ChildStage[]
  edited: ChildStage[]
  deleted: ChildStage[]
}

function isChildDirty(child: ChildStage) {
  return child.isNew || child.deleted || Object.keys(child.fields).length > 0
}

/**
 * Splits a collection's staged children into the three things a save has to do with them. `edited`
 * excludes children whose fields ended up unchanged, so a caller can skip an empty PUT. Callers
 * still choose their own ordering — enrollments and memberships must delete before they create.
 */
export function groupChildren(children?: ChildStage[]): ChildGroups {
  const groups: ChildGroups = { added: [], edited: [], deleted: [] }
  for (const child of children ?? []) {
    if (child.deleted) {
      if (!child.isNew) groups.deleted.push(child)
    } else if (child.isNew) {
      groups.added.push(child)
    } else if (Object.keys(child.fields).length) {
      groups.edited.push(child)
    }
  }
  return groups
}

export function useStagedChanges() {
  const stages = reactive<Record<string, RowStage>>({})
  let counter = 0

  function nextId(kind: string) {
    return `${NEW_PREFIX}${kind}:${++counter}`
  }

  function stageFor(id: string): RowStage {
    return (stages[id] ??= { isNew: isNewId(id), deleted: false, fields: {}, children: {} })
  }

  /**
   * null, undefined, and '' are treated as the same "blank" for revert purposes — a cleared text
   * input models absence as '', a nullable fetched field models it as null, and a field reverted to
   * either should stop reading as edited.
   */
  function isBlank(value: any) {
    return value == null || value === ''
  }

  function isReverted(value: any, original: any) {
    return value === original || (isBlank(value) && isBlank(original))
  }

  function hasRowChanges(stage: RowStage) {
    if (stage.isNew || stage.deleted) return true
    if (Object.keys(stage.fields).length) return true
    for (const bucket of Object.values(stage.children)) {
      for (const child of Object.values(bucket)) {
        if (isChildDirty(child)) return true
      }
    }
    return false
  }

  /**
   * Clears whatever is staged on an existing row's children in place: a staged-new child is
   * dropped, an edited or deleted one reverts to clean, keeping its cached original.
   */
  function clearChildren(stage: RowStage) {
    for (const bucket of Object.values(stage.children)) {
      for (const childId of Object.keys(bucket)) {
        const child = bucket[childId]!
        if (child.isNew) delete bucket[childId]
        else {
          child.deleted = false
          child.fields = {}
        }
      }
    }
  }

  // ---------------------------------------------------------------- rows
  // DataTable.vue's own row-lifecycle machinery — nothing outside it calls this group.

  /** Stage a new row from a blank draft. Returns its temporary id. */
  function addRow(draft: Record<string, any>): string {
    const id = nextId('row')
    stages[id] = { isNew: true, deleted: false, fields: { ...draft }, children: {} }
    return id
  }

  /** Discard a staged-new row entirely (marking a green row for deletion drops it rather than
   *  colouring it red — there is nothing on the server yet to delete). */
  function dropRow(id: string) {
    delete stages[id]
  }

  /** Mark each id for deletion. Staged-new rows are dropped instead, since there is nothing to
   *  delete server-side; use `undo` to unmark an existing row. */
  function markRowsDeleted(ids: string[]) {
    for (const id of ids) {
      if (isNewId(id)) {
        dropRow(id)
        continue
      }
      stageFor(id).deleted = true
    }
  }

  /**
   * Undoes whatever is staged on a row and its children: a staged-new row is dropped, an edited
   * row's fields revert to clean, a deletion mark is lifted, and any staged child changes (e.g. a
   * Student's Enrollments/Choices/Memberships) are cleared too — a row can be "edited" purely from
   * child changes, so undoing the row must undo them for the row to actually turn clean.
   */
  function undoRow(id: string) {
    const stage = stages[id]
    if (!stage) return
    if (stage.isNew) {
      dropRow(id)
      return
    }
    stage.deleted = false
    stage.fields = {}
    clearChildren(stage)
  }

  function rowState(id: string): StageState {
    const stage = stages[id]
    if (!stage) return 'clean'
    if (stage.deleted) return 'deleted'
    if (stage.isNew) return 'new'
    return hasRowChanges(stage) ? 'edited' : 'clean'
  }

  /**
   * Caches the fetched record behind an existing row, so `fields.get`/`fields.set`/`rows.merge`
   * never need it passed in again. Called by DataTable for every row on every render of `data` —
   * cheap, and it keeps the cache current across a refetch.
   */
  function registerRow(id: string, record: Record<string, any>) {
    if (isNewId(id)) return
    stageFor(id).original = record
  }

  /**
   * A fetched row with its staged edits applied, for display, sorting, and filtering. Reads the
   * record cached by `rows.register` rather than taking one as an argument, so callers don't have
   * to keep re-threading the same object through — `register` runs immediately on every change to
   * the owning fetch, ahead of any render that could call `merge`, so the cache is always current.
   */
  function mergeRow<T extends Record<string, any>>(id: string): T {
    const stage = stages[id]
    if (!stage) throw new Error(`rows.merge: row "${id}" was never registered`)
    if (stage.isNew) return stage.fields as T
    if (!Object.keys(stage.fields).length) return stage.original as T
    return { ...stage.original, ...stage.fields } as T
  }

  /** Every staged-new row's temporary id and draft, in the order they were added. */
  function drafts(): { id: string; fields: Record<string, any> }[] {
    const result: { id: string; fields: Record<string, any> }[] = []
    for (const [id, stage] of Object.entries(stages)) {
      if (stage.isNew) result.push({ id, fields: stage.fields })
    }
    return result
  }

  // ------------------------------------------------------------- fields
  // A row's own fields — used by DataTable's generic columns and by expansion components editing
  // fields that aren't rendered as a column (e.g. a Project's description).

  /** The staged value for a field, falling back to the row's registered original. */
  function getValue(id: string, field: string) {
    const stage = stages[id]
    if (!stage) return undefined
    if (stage.isNew) return stage.fields[field]
    return field in stage.fields ? stage.fields[field] : stage.original?.[field]
  }

  /** Stage a field edit. Setting a value back to the registered original clears the edit. */
  function setValue(id: string, field: string, value: any) {
    const stage = stageFor(id)
    if (stage.isNew) {
      stage.fields[field] = value
      return
    }
    const original = stage.original?.[field]
    if (isReverted(value, original)) {
      delete stage.fields[field]
    } else {
      stage.fields[field] = value
    }
  }

  function isFieldEdited(id: string, field: string) {
    const stage = stages[id]
    return !!stage && !stage.isNew && field in stage.fields
  }

  // ------------------------------------------------------------ children

  function childrenFor(rowId: string, collection: string): Record<string, ChildStage> {
    const stage = stageFor(rowId)
    return (stage.children[collection] ??= {})
  }

  function childStage(rowId: string, collection: string, childId: string): ChildStage | undefined {
    return stages[rowId]?.children[collection]?.[childId]
  }

  /** Stage a new minor record under a row. Returns its temporary id. */
  function addChild(rowId: string, collection: string, draft: Record<string, any>): string {
    const id = nextId(collection)
    childrenFor(rowId, collection)[id] = { id, isNew: true, deleted: false, fields: { ...draft } }
    return id
  }

  /** Mark an existing child for deletion, or drop a staged-new one, since there is nothing to
   *  delete server-side; use `undo` to unmark it. */
  function markChildDeleted(rowId: string, collection: string, childId: string) {
    const bucket = childrenFor(rowId, collection)
    const existing = bucket[childId]
    if (existing?.isNew) {
      delete bucket[childId]
      return
    }
    if (existing) {
      existing.deleted = true
      return
    }
    bucket[childId] = { id: childId, isNew: false, deleted: true, fields: {} }
  }

  /**
   * Undoes whatever is staged on a minor record — the Undo button on a green, blue, or red card. A
   * staged-new child is discarded entirely; an existing one reverts to clean, keeping its cached
   * original.
   */
  function undoChild(rowId: string, collection: string, childId: string) {
    const bucket = childrenFor(rowId, collection)
    const existing = bucket[childId]
    if (existing?.isNew) {
      delete bucket[childId]
    } else if (existing) {
      existing.deleted = false
      existing.fields = {}
    }
  }

  /**
   * Caches the fetched records behind an existing row's children, so `children.get`/`children.set`/
   * `children.merge` never need one passed in again. Rebuilds the bucket in `records`' order on
   * every call — reusing each already-known child's `ChildStage` by id rather than replacing it, so
   * staged edits survive — which keeps `children.merge`'s output in the current server order even
   * across a reorder-and-refresh, instead of freezing at whatever order a child was first seen in.
   * Any still-staged-new child (not yet saved, so absent from `records`) is carried over to the end
   * in its prior relative order.
   */
  function registerChildren<C extends Record<string, any>>(
    rowId: string,
    collection: string,
    records: C[],
    key: (record: C) => string
  ) {
    if (isNewId(rowId)) return
    const stage = stageFor(rowId)
    const oldBucket = stage.children[collection] ?? {}
    const newBucket: Record<string, ChildStage> = {}
    for (const record of records) {
      const id = key(record)
      const existing = oldBucket[id]
      if (existing) {
        existing.original = record
        newBucket[id] = existing
      } else {
        newBucket[id] = { id, isNew: false, deleted: false, fields: {}, original: record }
      }
    }
    for (const [id, childStage] of Object.entries(oldBucket)) {
      if (childStage.isNew) newBucket[id] = childStage
    }
    stage.children[collection] = newBucket
  }

  function getChildValue(rowId: string, collection: string, childId: string, field: string) {
    const stage = childStage(rowId, collection, childId)
    if (!stage) return undefined
    if (stage.isNew) return stage.fields[field]
    return field in stage.fields ? stage.fields[field] : stage.original?.[field]
  }

  /**
   * Stage an edit on a minor record. A `childId` with the `new:` prefix that has no stage yet is
   * created as a staged addition, which is how a Partner with no contact yet gets one from an
   * inline contact-proxy column.
   */
  function setChildValue(
    rowId: string,
    collection: string,
    childId: string,
    field: string,
    value: any
  ) {
    const bucket = childrenFor(rowId, collection)
    const stage = (bucket[childId] ??= {
      id: childId,
      isNew: isNewId(childId),
      deleted: false,
      fields: {},
    })
    if (stage.isNew) {
      stage.fields[field] = value
      return
    }
    const original = stage.original?.[field]
    if (isReverted(value, original)) {
      delete stage.fields[field]
    } else {
      stage.fields[field] = value
    }
  }

  function isChildFieldEdited(rowId: string, collection: string, childId: string, field: string) {
    const stage = childStage(rowId, collection, childId)
    return !!stage && !stage.isNew && field in stage.fields
  }

  function childState(rowId: string, collection: string, childId: string): StageState {
    const stage = childStage(rowId, collection, childId)
    if (!stage) return 'clean'
    if (stage.deleted) return 'deleted'
    if (stage.isNew) return 'new'
    return Object.keys(stage.fields).length ? 'edited' : 'clean'
  }

  /**
   * Fetched children with staged edits applied, followed by staged-new ones, in the order cached by
   * `children.register`. Deleted children stay in the list so the UI can keep them in view, tinted
   * red. Reads entirely off the registered cache rather than taking the original list again — a
   * bucket only ever exists once `register` has populated it, so an empty/missing bucket here just
   * means the row genuinely has no children in this collection yet, not a registration bug.
   */
  function mergeChildren<C extends Record<string, any> = Record<string, any>>(
    rowId: string,
    collection: string
  ): MergedChild<C>[] {
    const bucket = stages[rowId]?.children[collection] ?? {}
    const merged: MergedChild<C>[] = []
    for (const stage of Object.values(bucket)) {
      if (stage.isNew) continue
      merged.push({
        id: stage.id,
        record: (Object.keys(stage.fields).length
          ? { ...stage.original, ...stage.fields }
          : stage.original) as C,
        state: childState(rowId, collection, stage.id),
        isNew: false,
        deleted: stage.deleted,
      })
    }
    for (const stage of Object.values(bucket)) {
      if (!stage.isNew) continue
      merged.push({
        id: stage.id,
        record: stage.fields as C,
        state: 'new',
        isNew: true,
        deleted: false,
      })
    }
    return merged
  }

  // -------------------------------------------------------------- global

  const isDirty = computed(() => Object.values(stages).some(hasRowChanges))

  /**
   * Discards every staged change (Cancel). A staged-new row is dropped entirely; an existing row's
   * edits, deletion mark, and staged children are cleared, but its registered `original` — and its
   * children's — stays cached, since nothing refetches on Cancel and dropping the cache would leave
   * every field reading as undefined until the next refresh.
   */
  function reset() {
    for (const id of Object.keys(stages)) {
      const stage = stages[id]!
      if (stage.isNew) {
        delete stages[id]
        continue
      }
      stage.deleted = false
      stage.fields = {}
      clearChildren(stage)
    }
  }

  function toRecord(id: string, stage: RowStage): StagedRecord {
    const children: Record<string, ChildStage[]> = {}
    for (const [collection, bucket] of Object.entries(stage.children)) {
      const list = Object.values(bucket).filter(isChildDirty)
      if (list.length) children[collection] = list
    }
    return { id, fields: { ...stage.fields }, children }
  }

  function payload(): StagedPayload {
    const created: StagedRecord[] = []
    const updated: StagedRecord[] = []
    const deleted: string[] = []
    for (const [id, stage] of Object.entries(stages)) {
      if (stage.isNew) created.push(toRecord(id, stage))
      else if (stage.deleted) deleted.push(id)
      else if (hasRowChanges(stage)) updated.push(toRecord(id, stage))
    }
    return { created, updated, deleted }
  }

  return {
    isDirty,
    reset,
    payload,
    rows: {
      add: addRow,
      markDeleted: markRowsDeleted,
      undo: undoRow,
      state: rowState,
      register: registerRow,
      merge: mergeRow,
      drafts,
    },
    fields: {
      get: getValue,
      set: setValue,
      isEdited: isFieldEdited,
    },
    children: {
      add: addChild,
      markDeleted: markChildDeleted,
      undo: undoChild,
      register: registerChildren,
      get: getChildValue,
      set: setChildValue,
      isEdited: isChildFieldEdited,
      merge: mergeChildren,
    },
  }
}

export type StagedChanges = ReturnType<typeof useStagedChanges>
