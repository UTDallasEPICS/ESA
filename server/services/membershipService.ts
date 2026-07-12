import {prisma} from "#server/utils/prisma";

export interface MembershipRead {
  id: string;
  teamId: string;
  studentId: string;
  isMentor: boolean;
}

export interface MembershipCreate {
  teamId: string;
  studentId: string;
  isMentor?: boolean;
}

const getMembershipById = async (id: string): Promise<MembershipRead | null> => {
  const membership = await prisma.membership.findUnique({
    where: {id},
  })
  return membership;
}

const createMembership = async (data: MembershipCreate): Promise<MembershipRead> => {
  const membership = await prisma.membership.create({
    data
  })
  return membership;
}

const deleteMembership = async (id: string): Promise<void> => {
  await prisma.membership.delete({where: {id}});
}

const membershipService = {
  getMembershipById,
  createMembership,
  deleteMembership,
};

export default membershipService;
