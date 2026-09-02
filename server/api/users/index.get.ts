import userService from '#server/services/userService'
import { requireAdmin } from '#server/utils/authz'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return await userService.getAllUsers()
})
