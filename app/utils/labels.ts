// Display-formatting helpers shared by the Database tabs and Team Formation.

/** `WEDNESDAY` -> `Wednesday`. Enum spellings are SCREAMING_CASE with no underscores. */
export function titleCase(value: string) {
  return value[0] + value.slice(1).toLowerCase()
}

/** `1 partner` / `3 partners`, for confirmation titles. */
export function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

export function formatSemester(semester: { season: string; year: number }) {
  return `${titleCase(semester.season)} ${semester.year}`
}

/** Orders semesters chronologically within a year. */
export function semesterOrder(semester: { season: string; year: number }) {
  const order = { SPRING: 0, SUMMER: 1, FALL: 2 } as const
  return semester.year * 10 + (order[semester.season as keyof typeof order] ?? 0)
}

export function studentLabel(student: { firstName: string; lastName: string; netID: string }) {
  return `${student.firstName} ${student.lastName} (${student.netID})`
}

export function projectLabel(project: { name: string; Partner: { name: string } }) {
  return `${project.name} (${project.Partner.name})`
}
