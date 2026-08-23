import { prisma } from '#server/utils/prisma'

export interface ChoiceRead {
  id: string
  rank: number
  studentId: string
  projectId: string
  semesterId: string
}

export interface ChoiceCreate {
  rank: number
  studentId: string
  projectId: string
  semesterId: string
}

export interface ChoiceUpdate {
  rank?: number
  semesterId?: string
}

const getChoiceById = async (id: string): Promise<ChoiceRead | null> => {
  const choice = await prisma.choice.findUnique({
    where: { id },
  })
  return choice
}

const createChoice = async (data: ChoiceCreate): Promise<ChoiceRead> => {
  const choice = await prisma.choice.create({
    data,
  })
  return choice
}

const updateChoice = async (id: string, data: ChoiceUpdate): Promise<ChoiceRead> => {
  if (data.rank == null) {
    const choice = await prisma.choice.update({
      where: { id },
      data,
    })
    return choice
  }
  return await prisma.$transaction(async (tx) => {
    const existingChoice = await tx.choice.findUniqueOrThrow({ where: { id } })
    if (existingChoice.rank === data.rank) {
      return await tx.choice.update({
        where: { id },
        data,
      })
    } else {
      // Shove other choices up or down to make room for the new rank. Rank has a unique
      // constraint per student+semester, so the siblings must be shifted one at a time, each
      // moving into a slot already vacated by the previous step — a single updateMany would
      // try to write into a slot still occupied by an unmoved row and violate the constraint.
      const movingDown = existingChoice.rank < data.rank!
      const rankFilter = movingDown
        ? { gt: existingChoice.rank, lte: data.rank! }
        : { lt: existingChoice.rank, gte: data.rank! }

      const siblings = await tx.choice.findMany({
        where: {
          studentId: existingChoice.studentId,
          semesterId: existingChoice.semesterId,
          rank: rankFilter,
        },
        orderBy: { rank: movingDown ? 'asc' : 'desc' },
      })

      // Vacate the moving choice's slot first so the shift below never collides with it.
      await tx.choice.update({ where: { id }, data: { rank: -1 } })
      for (const sibling of siblings) {
        await tx.choice.update({
          where: { id: sibling.id },
          data: { rank: sibling.rank + (movingDown ? -1 : 1) },
        })
      }
      return await tx.choice.update({ where: { id }, data })
    }
  })
}

const deleteChoice = async (id: string): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    const existingChoice = await tx.choice.findUniqueOrThrow({ where: { id } })
    // Delete first to vacate this rank, then shift the remaining choices down one at a time
    // (lowest rank first) so each moves into a slot already freed by the previous step.
    await tx.choice.delete({ where: { id } })
    const siblings = await tx.choice.findMany({
      where: {
        studentId: existingChoice.studentId,
        semesterId: existingChoice.semesterId,
        rank: { gt: existingChoice.rank },
      },
      orderBy: { rank: 'asc' },
    })
    for (const sibling of siblings) {
      await tx.choice.update({ where: { id: sibling.id }, data: { rank: sibling.rank - 1 } })
    }
  })
}

const choiceService = {
  getChoiceById,
  createChoice,
  updateChoice,
  deleteChoice,
}

export default choiceService
