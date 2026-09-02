import userService from '#server/services/userService'
import { requireAdmin } from '#server/utils/authz'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing id parameter' })
  }

  const body = await readBody<{ active?: boolean; role?: 'USER' | 'ADMIN' }>(event)

  try {
    return await userService.updateUser(id, session.user.id, {
      active: body.active,
      role: body.role,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update user.'
    const statusCode = message === 'User not found.' ? 404 : 400
    throw createError({ statusCode, message })
  }
})
