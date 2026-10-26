/**
 * POST /api/team-formation/versions
 * Saves the board as the version being worked on, so staff can come back to it.
 * Returns null when there is nothing new to save.
 * Body: { semesterId: string, meetingDay: 'WEDNESDAY' | 'THURSDAY' }
 */

import { ProjectMeetingDay } from '@@/prisma/generated/client'
import teamVersionService from '#server/services/teamVersionService'

export default defineEventHandler(async (event) => {
  const { semesterId, meetingDay } = await readBody<{ semesterId: string; meetingDay: string }>(
    event
  )
  if (!semesterId) {
    throw createError({ statusCode: 400, message: 'semesterId is required.' })
  }
  if (meetingDay !== ProjectMeetingDay.WEDNESDAY && meetingDay !== ProjectMeetingDay.THURSDAY) {
    throw createError({ statusCode: 400, message: 'Expected a meeting day (Wednesday/Thursday)' })
  }
  return teamVersionService.saveVersion(semesterId, meetingDay, 'Saved')
})
