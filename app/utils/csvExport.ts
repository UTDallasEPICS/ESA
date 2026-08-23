function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export function rowsToCsv(rows: string[][]): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\n')
}

export function downloadCsv(filename: string, rows: string[][]): void {
  const blob = new Blob([rowsToCsv(rows)], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
