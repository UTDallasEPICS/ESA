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
}

interface RowStage {
  isNew: boolean
  deleted: boolean
  /** Edited fields for an existing row; the whole draft for a staged-new one. */
  fields: Record<string, any>
  children: Record<string, Record<string, ChildStage>>
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

const NEW_PREFIX = 'new:'

export function isNewId(id: string) {
  return id.startsWith(NEW_PREFIX)
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

  /** Drop a row's stage once it holds nothing, so the toolbar can hide Confirm/Cancel again. */
  function prune(id: string) {
    const stage = stages[id]
    if (!stage || stage.isNew || stage.deleted) return
    if (Object.keys(stage.fields).length) return
    for (const collection of Object.values(stage.children)) {
      if (Object.keys(collection).length) return
    }
    delete stages[id]
  }

  // ---------------------------------------------------------------- rows

  /** Stage a new row from a blank draft. Returns its temporary id. */
  function addRow(draft: Record<string, any>): string {
    const id = nextId('row')
    stages[id] = { isNew: true, deleted: false, fields: { ...draft }, children: {} }
    newRowIds.value = [...newRowIds.value, id]
    return id
  }

  /** Discard a staged-new row entirely (Delete on a green row drops it rather than marking it). */
  function dropRow(id: string) {
    delete stages[id]
    newRowIds.value = newRowIds.value.filter((rowId) => rowId !== id)
  }

  /** Toggle the deletion mark on each id. Staged-new rows are dropped instead. */
  function toggleDeleted(ids: string[]) {
    for (const id of ids) {
      if (isNewId(id)) {
        dropRow(id)
        continue
      }
      const stage = stageFor(id)
      stage.deleted = !stage.deleted
      prune(id)
    }
  }

  function isNew(id: string) {
    return !!stages[id]?.isNew
  }

  function isDeleted(id: string) {
    return !!stages[id]?.deleted
  }

  function rowState(id: string): StageState {
    const stage = stages[id]
    if (!stage) return 'clean'
    if (stage.deleted) return 'deleted'
    if (stage.isNew) return 'new'
    return 'edited'
  }

  /** The staged value for a field, falling back to the fetched record's value. */
  function getValue(id: string, field: string, original?: any) {
    const stage = stages[id]
    if (!stage) return original
    if (stage.isNew) return stage.fields[field]
    return field in stage.fields ? stage.fields[field] : original
  }

  /** Stage a field edit. Setting a value back to `original` clears the edit. */
  function setValue(id: string, field: string, value: any, original?: any) {
    const stage = stageFor(id)
    if (stage.isNew) {
      stage.fields[field] = value
      return
    }
    if (value === original || (value == null && original == null)) {
      delete stage.fields[field]
      prune(id)
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

  /** Mark an existing child deleted, or drop a staged-new one. Toggles. */
  function toggleChildDeleted(rowId: string, collection: string, childId: string) {
    const bucket = childrenFor(rowId, collection)
    const existing = bucket[childId]
    if (existing?.isNew) {
      delete bucket[childId]
      prune(rowId)
      return
    }
    if (existing) {
      existing.deleted = !existing.deleted
      if (!existing.deleted && !Object.keys(existing.fields).length) delete bucket[childId]
      prune(rowId)
      return
    }
    bucket[childId] = { id: childId, isNew: false, deleted: true, fields: {} }
  }

  /** Drop a staged child change outright — the Undo button on a green or red card. */
  function dropChild(rowId: string, collection: string, childId: string) {
    delete childrenFor(rowId, collection)[childId]
    prune(rowId)
  }

  function getChildValue(
    rowId: string,
    collection: string,
    childId: string,
    field: string,
    original?: any
  ) {
    const stage = childStage(rowId, collection, childId)
    if (!stage) return original
    if (stage.isNew) return stage.fields[field]
    return field in stage.fields ? stage.fields[field] : original
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
    value: any,
    original?: any
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
    if (value === original || (value == null && original == null)) {
      delete stage.fields[field]
      if (!stage.deleted && !Object.keys(stage.fields).length) delete bucket[childId]
      prune(rowId)
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

  const isDirty = computed(() => Object.keys(stages).length > 0)

  function reset() {
    for (const id of Object.keys(stages)) delete stages[id]
    newRowIds.value = []
  }

  function toRecord(id: string, stage: RowStage): StagedRecord {
    const children: Record<string, ChildStage[]> = {}
    for (const [collection, bucket] of Object.entries(stage.children)) {
      const list = Object.values(bucket)
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
      else updated.push(toRecord(id, stage))
    }
    return { created, updated, deleted }
  }

  return {
    stages,
    newRowIds,
    addRow,
    dropRow,
    toggleDeleted,
    isNew,
    isDeleted,
    rowState,
    getValue,
    setValue,
    isFieldEdited,
    draftRow,
    mergeRow,
    addChild,
    toggleChildDeleted,
    dropChild,
    getChildValue,
    setChildValue,
    isChildFieldEdited,
    childState,
    childStage,
    mergeChildren,
    isDirty,
    reset,
    payload,
  }
}

export type StagedChanges = ReturnType<typeof useStagedChanges>
