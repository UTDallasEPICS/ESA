import type { H3Event } from 'h3'
import { auth } from './auth'

// Throws 401/403 and otherwise returns the session for the requesting user,
// who must be signed in with an ADMIN role.
export async function requireAdmin(event: H3Event) {
  const session = await auth.api.getSession({ headers: event.headers })

  if (!session) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  if (session.user.role !== 'ADMIN') {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }

  return session
}
