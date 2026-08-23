import semesterService from '#server/services/semesterService'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing id parameter' })
  }

  try {
    await semesterService.deleteSemester(id)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete semester.'
    const statusCode = message === 'Semester not found.' ? 404 : 400
    throw createError({ statusCode, message })
  }
  return null
})
