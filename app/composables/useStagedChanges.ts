// Per-table staging store for the editing model in docs/UIDesign-v1.1.md §2.3.1.
//
// Every creation, edit, and deletion made in a DataTable — including the ones made inside a row's
// expansion — is held here until Confirm. Nothing in this file talks to the network: the owning tab
// reads `payload()` on Confirm and turns it into API calls itself.

export type StageState = 'new' | 'deleted' | 'edited' | 'clean'

/** A staged change to a minor record nested under a major record (Team, Contact, Choice, …). */
export interface ChildStage {
  id: string
  isNew: boolean
  deleted: boolean
  /** Edited fields for an existing child; the whole draft for a staged-new one. */
  fields: Record<string, any>
  /**
   * The fetched record this child edits, cached by `registerChildren` so callers never have to
   * look it up and pass it to every get/set call themselves. Unset for a staged-new child, which
   * has no server-side counterpart to compare against.
   */
  original?: Record<string, any>
}

interface RowStage {
  isNew: boolean
  deleted: boolean
  /** Edited fields for an existing row; the whole draft for a staged-new one. */
  fields: Record<string, any>
  children: Record<string, Record<string, ChildStage>>
  /** The fetched record this row edits, cached by `registerRow`. Unset for a staged-new row. */
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
  const newRowIds = ref<string[]>([])
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

  // ---------------------------------------------------------------- rows

  /** Stage a new row from a blank draft. Returns its temporary id. */
  function addRow(draft: Record<string, any>): string {
    const id = nextId('row')
    stages[id] = { isNew: true, deleted: false, fields: { ...draft }, children: {} }
    newRowIds.value = [...newRowIds.value, id]
    return id
  }

  /** Discard a staged-new row entirely (marking a green row for deletion drops it rather than
   *  colouring it red — there is nothing on the server yet to delete). */
  function dropRow(id: string) {
    delete stages[id]
    newRowIds.value = newRowIds.value.filter((rowId) => rowId !== id)
  }

  /** Mark each id for deletion. Staged-new rows are dropped instead, since there is nothing to
   *  delete server-side; use `undoRow` to unmark an existing row. */
  function markDeleted(ids: string[]) {
    for (const id of ids) {
      if (isNewId(id)) {
        dropRow(id)
        continue
      }
      stageFor(id).deleted = true
    }
  }

  /**
   * Undoes whatever is staged on a row: a staged-new row is dropped, an edited row's fields revert
   * to clean, and a deletion mark is lifted. Any staged changes to the row's children are left
   * alone — they carry their own individual undo.
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
  }

  function isDeleted(id: string) {
    return !!stages[id]?.deleted
  }

  function rowState(id: string): StageState {
    const stage = stages[id]
    if (!stage) return 'clean'
    if (stage.deleted) return 'deleted'
    if (stage.isNew) return 'new'
    return hasRowChanges(stage) ? 'edited' : 'clean'
  }

  /**
   * Caches the fetched record behind an existing row, so `getValue`/`setValue` never need it
   * passed in again. Called by DataTable for every row on every render of `data` — cheap, and it
   * keeps the cache current across a refetch.
   */
  function registerRow(id: string, record: Record<string, any>) {
    if (isNewId(id)) return
    stageFor(id).original = record
  }

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

  /** The full draft object behind a staged-new row. */
  function draftRow(id: string): Record<string, any> | undefined {
    const stage = stages[id]
    return stage?.isNew ? stage.fields : undefined
  }

  /** A fetched row with its staged edits applied, for display, sorting, and filtering. */
  function mergeRow<T extends Record<string, any>>(id: string, record: T): T {
    const stage = stages[id]
    if (!stage || stage.isNew || !Object.keys(stage.fields).length) return record
    return { ...record, ...stage.fields }
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
   *  delete server-side; use `undoChild` to unmark it. */
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
   * Caches the fetched records behind an existing row's children, so `getChildValue`/
   * `setChildValue` never need one passed in again. Keyed the same way `mergeChildren` is; call it
   * with every item in the collection whenever the owning tab's fetch changes.
   */
  function registerChildren<C extends Record<string, any>>(
    rowId: string,
    collection: string,
    records: C[],
    key: (record: C) => string
  ) {
    if (isNewId(rowId)) return
    const bucket = childrenFor(rowId, collection)
    for (const record of records) {
      const id = key(record)
      const existing = bucket[id]
      if (existing) existing.original = record
      else bucket[id] = { id, isNew: false, deleted: false, fields: {}, original: record }
    }
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
   * Fetched children with staged edits applied, followed by staged-new ones. Deleted children stay
   * in the list so the UI can keep them in view, tinted red.
   */
  function mergeChildren<C extends Record<string, any>>(
    rowId: string,
    collection: string,
    originals: C[],
    key: (child: C) => string
  ): MergedChild<C>[] {
    const bucket = stages[rowId]?.children[collection] ?? {}
    const merged: MergedChild<C>[] = originals.map((record) => {
      const id = key(record)
      const stage = bucket[id]
      return {
        id,
        record: stage && !stage.isNew ? { ...record, ...stage.fields } : record,
        state: childState(rowId, collection, id),
        isNew: false,
        deleted: !!stage?.deleted,
      }
    })
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

  function reset() {
    for (const id of Object.keys(stages)) delete stages[id]
    newRowIds.value = []
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
    for (const id of newRowIds.value) {
      const stage = stages[id]
      if (stage?.isNew) created.push(toRecord(id, stage))
    }
    for (const [id, stage] of Object.entries(stages)) {
      if (stage.isNew) continue
      if (stage.deleted) deleted.push(id)
      else if (hasRowChanges(stage)) updated.push(toRecord(id, stage))
    }
    return { created, updated, deleted }
  }

  return {
    newRowIds,
    addRow,
    markDeleted,
    undoRow,
    isDeleted,
    rowState,
    registerRow,
    getValue,
    setValue,
    isFieldEdited,
    draftRow,
    mergeRow,
    addChild,
    markChildDeleted,
    undoChild,
    registerChildren,
    getChildValue,
    setChildValue,
    isChildFieldEdited,
    mergeChildren,
    isDirty,
    reset,
    payload,
  }
}

export type StagedChanges = ReturnType<typeof useStagedChanges>
