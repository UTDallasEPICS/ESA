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
      // shove other choices up or down to make room for the new rank
      let rankFilter
      let rankOperation
      if (existingChoice.rank < data.rank!) {
        rankFilter = { gt: existingChoice.rank, lte: data.rank }
        rankOperation = { decrement: 1 }
      } else {
        rankFilter = { lt: existingChoice.rank, gte: data.rank }
        rankOperation = { increment: 1 }
      }
      await tx.choice.updateMany({
        where: {
          studentId: existingChoice.studentId,
          semesterId: existingChoice.semesterId,
          rank: rankFilter,
        },
        data: { rank: rankOperation },
      })
      return await tx.choice.update({ where: { id }, data })
    }
  })
}

const deleteChoice = async (id: string): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    const existingChoice = await tx.choice.findUniqueOrThrow({ where: { id } })
    await tx.choice.updateMany({
      where: {
        studentId: existingChoice.studentId,
        semesterId: existingChoice.semesterId,
        rank: { gt: existingChoice.rank },
      },
      data: { rank: { decrement: 1 } },
    })
    await tx.choice.delete({ where: { id } })
  })
}

const choiceService = {
  getChoiceById,
  createChoice,
  updateChoice,
  deleteChoice,
}

export default choiceService
