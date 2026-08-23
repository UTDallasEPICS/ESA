import type { SemesterCreate, SemesterRead } from '#server/services/semesterService'

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
