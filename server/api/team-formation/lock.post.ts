/**
 * POST /api/team-formation/lock
 * Manually locks a student into a team ahead of the main solve (e.g. a 3200 student
 * staff has already decided on). generate.post.ts leaves locked memberships alone and
 * only solves for the remaining unlocked students.
 * Body: { teamId: string, studentId: string }
 */

import {prisma} from '#server/utils/prisma'
import membershipService from '#server/services/membershipService'

export default defineEventHandler(async (event) => {
  const {teamId, studentId} = await readBody<{teamId: string; studentId: string}>(event)

  if (!teamId || !studentId) {
    throw createError({statusCode: 400, message: 'teamId and studentId are required.'})
  }

  const team = await prisma.team.findUnique({where: {id: teamId}})
  if (!team) {
    throw createError({statusCode: 404, message: 'Team not found.'})
  }

  // A student can only hold one non-mentor membership per semester — check across all
  // teams in that semester, not just this one, before locking them in.
  const existing = await prisma.membership.findFirst({
    where: {studentId, isMentor: false, Team: {semesterId: team.semesterId}},
  })
  if (existing) {
    if (existing.locked) {
      throw createError({
        statusCode: 400,
        message: 'This student is already locked into a team this semester. Unlock it first.',
      })
    }
    // Not locked — just their placement from a previous Generate Teams run. Locking them
    // into a (possibly different) team now should simply replace that, not block on it.
    await prisma.membership.delete({where: {id: existing.id}})
  }

  return membershipService.createMembership({teamId, studentId, isMentor: false, locked: true})
})
