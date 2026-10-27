import type { ProjectMeetingDay } from '@@/prisma/generated/client'
import { prisma } from '#server/utils/prisma'

// Saved copies of a semester/day's team placements. The board is always the
// version being worked on, numbered one past the latest saved copy; saving
// freezes the board as that number. Only non-mentor students are versioned:
// mentors are assigned separately and never move with a version.

export interface TeamVersionRead {
  id: string
  number: number
  note: string
  createdAt: Date
  studentCount: number
  /** True when the board is exactly this version right now. */
  matchesBoard: boolean
}

export interface TeamVersionList {
  versions: TeamVersionRead[]
  /** The number the board is on right now. */
  working: number
}

interface Placement {
  teamId: string
  studentId: string
  locked: boolean
}

const teamIdsFor = async (semesterId: string, meetingDay: ProjectMeetingDay) =>
  (await prisma.team.findMany({ where: { semesterId, meetingDay }, select: { id: true } })).map(
    (t) => t.id
  )

// The board as it is now, in a stable order so two copies can be compared.
const currentPlacements = async (teamIds: string[]): Promise<Placement[]> =>
  prisma.membership.findMany({
    where: { teamId: { in: teamIds }, isMentor: false },
    select: { teamId: true, studentId: true, locked: true },
    orderBy: [{ teamId: 'asc' }, { studentId: 'asc' }],
  })

const listVersions = async (
  semesterId: string,
  meetingDay: ProjectMeetingDay
): Promise<TeamVersionList> => {
  const rows = await prisma.teamVersion.findMany({
    where: { semesterId, meetingDay },
    orderBy: { number: 'desc' },
  })
  const board = JSON.stringify(await currentPlacements(await teamIdsFor(semesterId, meetingDay)))
  return {
    versions: rows.map((v) => ({
      id: v.id,
      number: v.number,
      note: v.note,
      createdAt: v.createdAt,
      studentCount: (JSON.parse(v.memberships) as Placement[]).length,
      matchesBoard: v.memberships === board,
    })),
    working: (rows[0]?.number ?? 0) + 1,
  }
}

// Freezes the board as the working version number. Skips it (returns null) when
// no students are placed, or when the board is exactly the latest saved copy, so
// regenerating twice in a row doesn't stack up identical versions.
const saveVersion = async (
  semesterId: string,
  meetingDay: ProjectMeetingDay,
  note: string
): Promise<TeamVersionRead | null> => {
  const placements = await currentPlacements(await teamIdsFor(semesterId, meetingDay))
  if (!placements.length) return null
  const memberships = JSON.stringify(placements)
  const latest = await prisma.teamVersion.findFirst({
    where: { semesterId, meetingDay },
    orderBy: { number: 'desc' },
  })
  if (latest?.memberships === memberships) return null
  const v = await prisma.teamVersion.create({
    data: { semesterId, meetingDay, number: (latest?.number ?? 0) + 1, note, memberships },
  })
  return {
    id: v.id,
    number: v.number,
    note: v.note,
    createdAt: v.createdAt,
    studentCount: placements.length,
    matchesBoard: true,
  }
}

// Staff can describe a version in their own words ("Mentor approved"); this
// replaces the automatic note such as "Saved" or "Before regenerating".
const describeVersion = async (id: string, note: string): Promise<void> => {
  await prisma.teamVersion.update({ where: { id }, data: { note } })
}

// Puts a saved version back on the board, saving the board first. Teams or
// students deleted since the version was saved are skipped.
const restoreVersion = async (id: string): Promise<void> => {
  const version = await prisma.teamVersion.findUnique({ where: { id } })
  if (!version) throw new Error('Version not found.')
  const { semesterId, meetingDay } = version
  await saveVersion(semesterId, meetingDay, `Before going back to Version ${version.number}`)

  const teamIds = await teamIdsFor(semesterId, meetingDay)
  const placements: Placement[] = JSON.parse(version.memberships)
  const studentIds = new Set(
    (
      await prisma.student.findMany({
        where: { id: { in: placements.map((p) => p.studentId) } },
        select: { id: true },
      })
    ).map((s) => s.id)
  )
  const teams = new Set(teamIds)
  await prisma.$transaction([
    prisma.membership.deleteMany({ where: { teamId: { in: teamIds }, isMentor: false } }),
    prisma.membership.createMany({
      data: placements.filter((p) => teams.has(p.teamId) && studentIds.has(p.studentId)),
    }),
  ])
}

export default { listVersions, saveVersion, restoreVersion, describeVersion }
