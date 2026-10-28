/**
 * POST /api/team-formation/lock
 * Places a student into a team, replacing any existing (unlocked) placement they have
 * this semester. Two uses share this endpoint:
 *   - Locking a 3200 student ahead of the main solve (locked: true, the default) — the
 *     solver leaves them alone and only solves for the remaining unlocked students.
 *   - Freely moving a student to a different team after results are already in
 *     (locked: false) — stays open to being changed again by hand or overwritten by
 *     the next Generate Teams run, exactly as flexible as an unassigned student.
 *   - Dragging a student between teams on the Team Board (replaceLocked: true) — the
 *     drag itself is the staff decision, so an existing locked placement is replaced
 *     too instead of requiring an unlock first.
 * Body: { teamId: string, studentId: string, locked?: boolean, replaceLocked?: boolean }
 */

import {prisma} from '#server/utils/prisma'
import membershipService from '#server/services/membershipService'

export default defineEventHandler(async (event) => {
  const {teamId, studentId, locked = true, replaceLocked = false} = await readBody<{
    teamId: string
    studentId: string
    locked?: boolean
    replaceLocked?: boolean
  }>(event)

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
    if (existing.locked && !replaceLocked) {
      throw createError({
        statusCode: 400,
        message: 'This student is already locked into a team this semester. Unlock it first.',
      })
    }
    // Not locked — just their placement from a previous Generate Teams run. Locking them
    // into a (possibly different) team now should simply replace that, not block on it.
    await prisma.membership.delete({where: {id: existing.id}})
  }

  return membershipService.createMembership({teamId, studentId, isMentor: false, locked})
})
