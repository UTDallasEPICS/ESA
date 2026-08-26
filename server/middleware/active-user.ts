import { auth } from '#server/utils/auth'

// Inactive users (active === false) may only reach /api/auth/** — everything else 403s. New
// sign-ups start inactive (prisma/schema.prisma User.active) until an admin activates them
// from /users.
export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname

  if (!path.startsWith('/api') || path.startsWith('/api/auth')) {
    return
  }

  const session = await auth.api.getSession({ headers: event.headers })
  if (session && !session.user.active) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Your account is inactive. Contact an admin for approval.',
    })
  }
})
