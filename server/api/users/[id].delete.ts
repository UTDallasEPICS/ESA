import userService from '#server/services/userService'
import { requireAdmin } from '#server/utils/authz'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing id parameter' })
  }

  try {
    await userService.deleteUser(id)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete user.'
    const statusCode = message === 'User not found.' ? 404 : 400
    throw createError({ statusCode, message })
  }
  return null
})
