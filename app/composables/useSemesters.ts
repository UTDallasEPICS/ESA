import type { SemesterCreate, SemesterRead } from '#server/services/semesterService'
import { formatSemester, semesterOrder } from '~/utils/labels'
import { dayLabel, type SelectOption } from '~/utils/options'

export function useSemesters() {
  const { data, refresh, status } = useFetch<SemesterRead[]>('/api/semesters', {
    key: 'semesters',
    default: () => [],
  })

  async function createSemester(input: SemesterCreate) {
    await $fetch('/api/semesters', { method: 'POST', body: input })
    await refresh()
  }

  async function deleteSemester(id: string) {
    await $fetch(`/api/semesters/${id}`, { method: 'DELETE' })
    await refresh()
  }

  return { semesters: data, status, refresh, createSemester, deleteSemester }
}

/**
 * Semester display helpers keyed by id, for the many places that hold a `semesterId` and need to
 * render or order it. Shares the `semesters` fetch key, so this costs no extra request.
 */
export function useSemesterLookup() {
  const { semesters } = useSemesters()

  function find(id?: string | null) {
    return id ? semesters.value.find((semester) => semester.id === id) : undefined
  }

  function semesterLabel(id?: string | null) {
    const semester = find(id)
    return semester ? formatSemester(semester) : 'Unknown Semester'
  }

  function semesterSortKey(id?: string | null) {
    const semester = find(id)
    return semester ? semesterOrder(semester) : 0
  }

  const semesterOptions = computed<SelectOption[]>(() =>
    semesters.value.map((semester) => ({ label: formatSemester(semester), value: semester.id }))
  )

  /** `Fall 2025 — Wednesday`, the heading a Team card carries. */
  function teamLabel(team: { semesterId: string; meetingDay?: string | null }) {
    return `${semesterLabel(team.semesterId)} — ${dayLabel(team.meetingDay)}`
  }

  return { semesters, semesterLabel, semesterSortKey, semesterOptions, teamLabel }
}
