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
  const recentSemester = semesters.value[0]
  const semesterId = ref<string | undefined>(recentSemester?.id)
  const guards = new Set<SemesterGuard>()
  const confirm = useConfirm()

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
