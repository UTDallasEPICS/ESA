/**
 * DELETE /api/team-formation/lock
 * Unlocks a manually-locked membership, returning the student to the unassigned pool.
 * Body: { membershipId: string }
 */

import {prisma} from '#server/utils/prisma'
import membershipService from '#server/services/membershipService'

export default defineEventHandler(async (event) => {
  const {membershipId} = await readBody<{membershipId: string}>(event)

  if (!membershipId) {
    throw createError({statusCode: 400, message: 'membershipId is required.'})
  }

  const membership = await prisma.membership.findUnique({where: {id: membershipId}})
  if (!membership) {
    throw createError({statusCode: 404, message: 'Membership not found.'})
  }
  // Only ever unlock memberships created through this manual flow — never let this
  // endpoint delete a membership the solver itself produced.
  if (!membership.locked) {
    throw createError({statusCode: 400, message: 'Only manually-locked memberships can be unlocked here.'})
  }

  await membershipService.deleteMembership(membershipId)
  return {success: true}
})
