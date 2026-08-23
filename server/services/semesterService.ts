import type { Season } from '@@/prisma/generated/client'
import { prisma } from '#server/utils/prisma'

export interface SemesterRead {
  id: string
  year: number
  season: Season
  teamCount: number
  enrollmentCount: number
  choiceCount: number
}

export interface SemesterCreate {
  year: number
  season: Season
}

export interface SemesterUpdate {
  year?: number
  season?: Season
}

const SEMESTER_COUNT_INCLUDE = {
  _count: { select: { Teams: true, Enrollments: true, Choices: true } },
} as const

const withCounts = (semester: {
  id: string
  year: number
  season: Season
  _count: { Teams: number; Enrollments: number; Choices: number }
}): SemesterRead => {
  const { _count, ...rest } = semester
  return {
    ...rest,
    teamCount: _count.Teams,
    enrollmentCount: _count.Enrollments,
    choiceCount: _count.Choices,
  }
}

const getAllSemesters = async (): Promise<SemesterRead[]> => {
  const semesters = await prisma.semester.findMany({
    orderBy: [{ year: 'desc' }, { season: 'desc' }],
    include: SEMESTER_COUNT_INCLUDE,
  })
  return semesters.map(withCounts)
}

const getRecentSemester = async (): Promise<SemesterRead | null> => {
  const semester = await prisma.semester.findFirst({
    orderBy: [{ year: 'desc' }, { season: 'desc' }],
    include: SEMESTER_COUNT_INCLUDE,
  })
  return semester ? withCounts(semester) : null
}

const getSemesterById = async (id: string): Promise<SemesterRead | null> => {
  const semester = await prisma.semester.findUnique({
    where: { id: id },
    include: SEMESTER_COUNT_INCLUDE,
  })
  return semester ? withCounts(semester) : null
}

const createSemester = async (data: SemesterCreate): Promise<SemesterRead> => {
  const semester = await prisma.semester.create({
    data,
  })
  return { ...semester, teamCount: 0, enrollmentCount: 0, choiceCount: 0 }
}

const updateSemester = async (id: string, data: SemesterUpdate): Promise<SemesterRead> => {
  const semester = await prisma.semester.update({
    where: { id },
    data,
    include: SEMESTER_COUNT_INCLUDE,
  })
  return withCounts(semester)
}

const deleteSemester = async (id: string): Promise<void> => {
  const semester = await prisma.semester.findUnique({
    where: { id },
    include: SEMESTER_COUNT_INCLUDE,
  })
  if (!semester) {
    throw new Error('Semester not found.')
  }
  const { Teams, Enrollments, Choices } = semester._count
  if (Teams > 0 || Enrollments > 0 || Choices > 0) {
    const parts = [
      Teams > 0 ? `${Teams} team(s)` : null,
      Enrollments > 0 ? `${Enrollments} enrollment(s)` : null,
      Choices > 0 ? `${Choices} choice(s)` : null,
    ].filter((p): p is string => p !== null)
    throw new Error(
      `Cannot delete semester: ${parts.join(', ')} still reference it. Remove them first.`
    )
  }
  await prisma.semester.delete({ where: { id } })
}

const semesterService = {
  getRecentSemester,
  getAllSemesters,
  getSemesterById,
  createSemester,
  updateSemester,
  deleteSemester,
}

export default semesterService
