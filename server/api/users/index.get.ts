import { prisma } from '#server/utils/prisma'
import { requireAdmin } from '#server/utils/authz'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      emailVerified: true,
      image: true,
      role: true,
    },
  })

  const redacted = users.map((user) => {
    return {
      ...user,
      image: user.image != null,
    }
  })

  return redacted
})
