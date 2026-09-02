import type { Role } from '@@/prisma/generated/client'
import { prisma } from '#server/utils/prisma'

export interface UserRead {
  id: string
  email: string
  name: string
  emailVerified: boolean
  image: boolean
  role: Role
  active: boolean
}

export interface UserUpdate {
  active?: boolean
  role?: Role
}

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  emailVerified: true,
  image: true,
  role: true,
  active: true,
} as const

function toUserRead(user: {
  id: string
  email: string
  name: string
  emailVerified: boolean
  image: string | null
  role: Role
  active: boolean
}): UserRead {
  return { ...user, image: user.image != null }
}

const getAllUsers = async (): Promise<UserRead[]> => {
  const users = await prisma.user.findMany({ select: USER_SELECT })
  return users.map(toUserRead)
}

// Enforces: an admin can't deactivate their own account, a role change only applies to an
// active user, and an admin can't demote themselves unless another admin exists.
const updateUser = async (id: string, requesterId: string, data: UserUpdate): Promise<UserRead> => {
  const target = await prisma.user.findUnique({ where: { id } })
  if (!target) {
    throw new Error('User not found.')
  }

  if (data.active === false && id === requesterId) {
    throw new Error('You cannot deactivate your own account.')
  }

  if (data.role !== undefined) {
    const willBeActive = data.active ?? target.active
    if (!willBeActive) {
      throw new Error('Only active users can have their role changed.')
    }
    if (data.role === 'USER' && id === requesterId) {
      const otherAdmins = await prisma.user.count({ where: { role: 'ADMIN', id: { not: id } } })
      if (otherAdmins === 0) {
        throw new Error('You cannot demote yourself while you are the only admin.')
      }
    }
  }

  const updated = await prisma.user.update({ where: { id }, data, select: USER_SELECT })
  return toUserRead(updated)
}

// Only inactive users may be deleted, so an admin never deletes a live account by mistake.
const deleteUser = async (id: string): Promise<void> => {
  const target = await prisma.user.findUnique({ where: { id } })
  if (!target) {
    throw new Error('User not found.')
  }
  if (target.active) {
    throw new Error('Only inactive users can be deleted.')
  }
  await prisma.user.delete({ where: { id } })
}

const userService = {
  getAllUsers,
  updateUser,
  deleteUser,
}

export default userService
