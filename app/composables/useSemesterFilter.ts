// The semester filter, gated rather than restored (§2.3.2).
//
// A tab holding staged changes has to be asked before the filter moves, because the move refetches
// its list and would orphan that work. The obvious shape — let the filter change, then put it back
// if the user declines — refetches twice and flashes the wrong dataset behind the dialog, because
// each tab's `useFetch` query is reactive to the id. So the id moves only after the answer.

/** What `request` has to ask before moving the filter. `StagedChanges` satisfies this as-is. */
export interface SemesterGuard {
  isDirty: Readonly<Ref<boolean>>
  reset: () => void
}

export interface SemesterFilterContext {
  /** The committed id. Only `request` moves it. */
  semesterId: Readonly<Ref<string | undefined>>
  /** Ask to move the filter. Resolves false when a dirty guard declined and the id never moved. */
  request: (next: string | undefined) => Promise<boolean>
  /**
   * Ask before any other destructive navigation — switching tabs unmounts the panel and takes its
   * staged changes with it. Resolves true (having reset the dirty stores) when it is safe to go on.
   */
  confirmDiscard: (description: string) => Promise<boolean>
  /** Register a store to be asked. Deregisters itself when the owning scope is disposed. */
  guard: (guard: SemesterGuard) => void
}

export const SEMESTER_FILTER_KEY: InjectionKey<SemesterFilterContext> = Symbol('semester-filter')

export function provideSemesterFilter(): SemesterFilterContext {
  const { semesters } = useSemesters()
  const semesterId = ref<string | undefined>(semesters.value[0]?.id)
  const guards = new Set<SemesterGuard>()
  const confirm = useConfirm()

  // "All semesters" is `undefined`, and so is "no default applied yet" — the two are
  // indistinguishable by looking at `semesterId` alone. So whether the user has made their own
  // choice is tracked separately here, rather than inferred from `semesterId.value === undefined`,
  // otherwise a deliberate "All semesters" selection would get overwritten the next time this
  // watcher runs (e.g. after a `semesters` refetch elsewhere).
  let userHasChosen = false

  // `useFetch('/api/semesters', ...)` above isn't awaited, so on a client-side navigation
  // `semesters.value` above can still be the empty `default` when this runs. Once the fetch
  // resolves, fill in the default then — but only if nothing has claimed `semesterId` since.
  watch(semesters, (list) => {
    if (!userHasChosen && semesterId.value === undefined && list.length) {
      semesterId.value = list[0]!.id
    }
  })

  function guard(entry: SemesterGuard) {
    guards.add(entry)
    onScopeDispose(() => guards.delete(entry))
  }

  async function confirmDiscard(description: string) {
    const dirty = [...guards].filter((entry) => entry.isDirty.value)
    if (dirty.length) {
      const ok = await confirm({
        title: 'Discard staged changes?',
        description,
        confirmLabel: 'Discard',
      })
      if (!ok) return false
    }
    for (const entry of dirty) entry.reset()
    return true
  }

  async function request(next: string | undefined) {
    if (next === semesterId.value) return true
    const ok = await confirmDiscard(
      'Changing the semester filter will discard everything you have staged.'
    )
    if (!ok) return false
    userHasChosen = true
    semesterId.value = next
    return true
  }

  const context: SemesterFilterContext = {
    semesterId: readonly(semesterId),
    request,
    confirmDiscard,
    guard,
  }
  provide(SEMESTER_FILTER_KEY, context)
  return context
}

export function useSemesterFilter(): SemesterFilterContext {
  const context = inject(SEMESTER_FILTER_KEY)
  if (!context) throw new Error('useSemesterFilter() needs provideSemesterFilter() on an ancestor')
  return context
}
