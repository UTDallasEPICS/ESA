/** The message buried in a `$fetch` rejection, falling back when the server sent nothing useful. */
export function errorMessage(error: any, fallback = 'Something went wrong.') {
  return error?.data?.message ?? error?.message ?? fallback
}
