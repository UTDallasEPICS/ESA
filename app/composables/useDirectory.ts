// The unfiltered lists the Database page searches against. Each shares one Nuxt fetch key, so any
// component may call these without issuing another request — which is what lets the row-expansion
// components resolve names on their own instead of having lists drilled down to them.

import type { PartnerRead } from '#server/services/partnerService'
import type { ProjectRead } from '#server/services/projectService'
import type { StudentRead } from '#server/services/studentService'

export function useAllPartners() {
  return useFetch<PartnerRead[]>('/api/partners', { key: 'partners-all', default: () => [] })
}

export function useAllProjects() {
  return useFetch<ProjectRead[]>('/api/projects', { key: 'projects-all', default: () => [] })
}

export function useAllStudents() {
  return useFetch<StudentRead[]>('/api/students', { key: 'students-all', default: () => [] })
}
