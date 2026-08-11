// Parsing/validation for the UTDesign/EPICS student bid CSV, mirroring the row shape
// expected by server/api/team-formation/bids.post.ts.

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.some((v) => v !== '')) rows.push(row)
      row = []
    } else {
      field += char
    }
  }
  if (field !== '' || row.length) {
    row.push(field)
    if (row.some((v) => v !== '')) rows.push(row)
  }

  if (!rows.length) return []
  const header = rows[0]!.map((h) => h.trim())
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {}
    header.forEach((h, i) => {
      obj[h] = (r[i] ?? '').trim()
    })
    return obj
  })
}

const NAME_KEYS = ['Student Name', 'Name', 'Full Name', 'Student', 'student name', 'name']
const NETID_KEYS = ['SSO ID', 'ssoid', 'netID', 'netid', 'id']
const CLASSIFICATION_KEYS = ['Classification', 'classification']
const ENROLLMENT_KEYS = ['Enrollment', 'enrollment']
const MAJOR_KEYS = ['School and Major', 'school and major', 'major']
const GENDER_KEYS = ['Gender', 'gender']

const VALID_CLASSIFICATIONS = new Set(['freshman', 'sophomore', 'junior', 'senior'])
const VALID_GENDERS = new Set(['male', 'female', 'non-binary', 'prefer not to say'])

function readFirst(row: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key]
    if (value) return value
  }
  return ''
}

export interface BidRowError {
  row: number
  message: string
}

export interface BidValidationResult {
  errors: BidRowError[]
  missingColumns: string[]
  rowCount: number
}

const REQUIRED_COLUMN_GROUPS: { label: string; keys: string[] }[] = [
  { label: 'Student Name', keys: NAME_KEYS },
  { label: 'SSO ID', keys: NETID_KEYS },
  { label: 'Classification', keys: CLASSIFICATION_KEYS },
  { label: 'Enrollment', keys: ENROLLMENT_KEYS },
  { label: 'School and Major', keys: MAJOR_KEYS },
  { label: 'Gender', keys: GENDER_KEYS },
]

export function validateBidRows(rows: Record<string, string>[]): BidValidationResult {
  if (!rows.length) {
    return {
      errors: [{ row: 0, message: 'File contains no data rows.' }],
      missingColumns: [],
      rowCount: 0,
    }
  }

  const header = new Set(Object.keys(rows[0]!))
  const missingColumns = REQUIRED_COLUMN_GROUPS.filter(
    (group) => !group.keys.some((k) => header.has(k))
  ).map((group) => group.label)

  if (missingColumns.length) {
    return { errors: [], missingColumns, rowCount: rows.length }
  }

  const errors: BidRowError[] = []
  const seenNetIds = new Set<string>()

  rows.forEach((row, idx) => {
    const rowNum = idx + 2 // account for header row + 1-index
    const name = readFirst(row, NAME_KEYS)
    const netID = readFirst(row, NETID_KEYS)
    const classification = readFirst(row, CLASSIFICATION_KEYS)
    const enrollment = readFirst(row, ENROLLMENT_KEYS)
    const major = readFirst(row, MAJOR_KEYS)
    const gender = readFirst(row, GENDER_KEYS)

    if (!name) errors.push({ row: rowNum, message: 'Missing Student Name.' })
    // if (!netID) {
    //   errors.push({ row: rowNum, message: 'Missing SSO ID.' })
    // } else if (seenNetIds.has(netID)) {
    //   errors.push({ row: rowNum, message: `Duplicate SSO ID "${netID}".` })
    // } else {
    //   seenNetIds.add(netID)
    // }
    // if (!classification) {
    //   errors.push({ row: rowNum, message: 'Missing Classification.' })
    // } else if (!VALID_CLASSIFICATIONS.has(classification.trim().toLowerCase())) {
    //   errors.push({ row: rowNum, message: `Unrecognized Classification "${classification}".` })
    // }
    // if (!enrollment) {
    //   errors.push({ row: rowNum, message: 'Missing Enrollment.' })
    // } else if (!/(2200|3200)/.test(enrollment)) {
    //   errors.push({
    //     row: rowNum,
    //     message: `Unrecognized Enrollment "${enrollment}" (expected 2200 or 3200).`,
    //   })
    // }
    // if (!major) errors.push({ row: rowNum, message: 'Missing School and Major.' })
    // if (!gender) {
    //   errors.push({ row: rowNum, message: 'Missing Gender.' })
    // } else if (!VALID_GENDERS.has(gender.trim().toLowerCase())) {
    //   errors.push({ row: rowNum, message: `Unrecognized Gender "${gender}".` })
    // }
  })

  return { errors, missingColumns: [], rowCount: rows.length }
}
