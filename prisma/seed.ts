import { PrismaClient } from './generated/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import 'dotenv/config'

const connectionString = `${process.env.DATABASE_URL}`

const adapter = new PrismaBetterSqlite3({ url: connectionString })
const prisma = new PrismaClient({ adapter })

const SEED_YEARS = [2024, 2025, 2026]
const SEED_SEASONS = ['SPRING', 'SUMMER', 'FALL']

import partnersData from './seeddata/partners.json'
import projectsData from './seeddata/projects.json'
import studentsData from './seeddata/students.json'

const seedSemesters = async () => {
  for (const year of SEED_YEARS) {
    for (const season of SEED_SEASONS) {
      await prisma.semester.create({ data: { year, season } })
    }
  }
}

const seedStudents = async () => {
  const semesters = await prisma.semester.findMany({
    orderBy: [{ year: 'desc' }, { season: 'desc' }],
  })
  const spring2026 = semesters.find((s) => s.year === 2026 && s.season === 'SPRING')
  if (!spring2026) {
    throw new Error('Spring 2026 semester was not seeded')
  }

  for (const {
    choiceProjectIds,
    gender,
    major,
    year,
    class: studentClass,
    meetingDay,
    skills,
    comments,
    ...rest
  } of studentsData) {
    await prisma.student.create({
      data: {
        ...rest,
        // @ts-ignore
        Enrollments: {
          create: [
            {
              semesterId: spring2026.id,
              gender,
              major,
              year,
              class: studentClass,
              meetingDay,
              skills,
              comments,
            },
          ],
        },
        Choices: {
          create: choiceProjectIds.map((projectId, i) => ({
            rank: i + 1,
            projectId,
            semesterId: spring2026.id,
          })),
        },
      },
    })
  }
}

const seedTeams = async () => {
  const semesters = await prisma.semester.findMany({
    orderBy: [{ year: 'desc' }, { season: 'desc' }],
  })
  const spring2026 = semesters.find((s) => s.year === 2026 && s.season === 'SPRING')
  if (!spring2026) {
    throw new Error('Spring 2026 semester was not seeded')
  }

  for (const project of projectsData) {
    const meetingDayCounts: Record<'WEDNESDAY' | 'THURSDAY', number> = {
      WEDNESDAY: 0,
      THURSDAY: 0,
    }
    for (const student of studentsData) {
      if (student.choiceProjectIds.includes(project.id)) {
        meetingDayCounts[student.meetingDay as 'WEDNESDAY' | 'THURSDAY']++
      }
    }

    // Only projects that were actually bid on get a team — the meeting day
    // is whichever day most of its bidders are enrolled on.
    if (meetingDayCounts.WEDNESDAY === 0 && meetingDayCounts.THURSDAY === 0) continue
    const meetingDay =
      meetingDayCounts.THURSDAY >= meetingDayCounts.WEDNESDAY ? 'THURSDAY' : 'WEDNESDAY'

    await prisma.team.create({
      data: {
        projectId: project.id,
        semesterId: spring2026.id,
        meetingDay,
      },
    })
  }
}

const seedPartners = async () => {
  await Promise.all(
    partnersData.map((p) => {
      const { Contacts, ...rest } = p
      return prisma.partner.create({
        data: {
          ...rest,
          Contacts: Contacts?.length
            ? { create: Contacts.map((contact, index) => ({ ...contact, isPrimary: index === 0 })) }
            : undefined,
        },
      })
    })
  )
}

const seedProjects = async () => {
  await prisma.project.createMany({ data: projectsData })
}

const seedAdmins = async () => {
  await prisma.user.createMany({
    data: [
      {
        id: 'admin-001',
        email: 'sxt230118@utdallas.edu',
        name: 'Snigdha Tadi',
        emailVerified: true,
        role: 'USER',
      },
      {
        id: 'admin-002',
        email: 'trp210003@utdallas.edu',
        name: 'Teerth Patel',
        emailVerified: true,
        role: 'ADMIN',
        active: true,
      },
      {
        id: 'admin-003',
        email: 'bxt230017@utdallas.edu',
        name: 'Bhuvi Thiriveedhi',
        emailVerified: true,
        role: 'USER',
      },
    ],
  })
}

const seedTeambuilder = async () => {
  await seedPartners()
  await seedProjects()
  await seedSemesters()
  await seedStudents()
  await seedTeams()
  await seedAdmins()
}

async function main() {
  console.log('Start seeding...')

  await seedTeambuilder()

  console.log('Seeding finished.')
}
// You can seed other models in your db as well depending on project needs

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
