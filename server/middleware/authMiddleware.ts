import { auth } from '#server/utils/auth'

// Unauthenticated requests to anything under /api/** get 401, except the public prefixes below.
// Inactive users (active === false) may only reach those same prefixes — everything else 403s. New
// sign-ups start inactive (prisma/schema.prisma User.active) until an admin activates them
// from /users.
//
// /api/auth/** is Better Auth's own handler (sign-in, OTP, get-session) and must stay reachable
// signed out. /api/_nuxt_icon/** is @nuxt/icon's bundle endpoint, which @nuxt/ui hits to render
// icons — gating it would break every icon on the signed-out /auth page.
const PUBLIC_API_PREFIXES = ['/api/auth', '/api/_nuxt_icon']

export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname

  if (!path.startsWith('/api') || PUBLIC_API_PREFIXES.some((p) => path.startsWith(p))) {
    return
  }

  const session = await auth.api.getSession({ headers: event.headers })
  if (!session) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  if (!session.user.active) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Your account is inactive. Contact an admin for approval.',
    })
  }
})
