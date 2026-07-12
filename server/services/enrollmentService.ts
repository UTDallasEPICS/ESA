import type {Gender, Year, Class, ProjectMeetingDay} from "@@/prisma/generated/client";
import {prisma} from "#server/utils/prisma";

export interface EnrollmentRead {
  id: string;
  studentId: string;
  semesterId: string;
  gender: Gender;
  major: string;
  year: Year;
  class: Class;
  meetingDay: ProjectMeetingDay;
}

export interface EnrollmentCreate {
  studentId: string;
  semesterId: string;
  gender: Gender;
  major: string;
  year: Year;
  class: Class;
  meetingDay: ProjectMeetingDay;
}

export interface EnrollmentUpdate {
  semesterId?: string;
  gender?: Gender;
  major?: string;
  year?: Year;
  class?: Class;
  meetingDay?: ProjectMeetingDay;
}

const getEnrollmentById = async (id: string): Promise<EnrollmentRead | null> => {
  const enrollment = await prisma.enrollment.findUnique({
    where: {id},
  })
  return enrollment;
}

const createEnrollment = async (data: EnrollmentCreate): Promise<EnrollmentRead> => {
  const enrollment = await prisma.enrollment.create({
    data
  })
  return enrollment;
}

const updateEnrollment = async (id: string, data: EnrollmentUpdate): Promise<EnrollmentRead> => {
  const enrollment = await prisma.enrollment.update({
    where: {id},
    data,
  });
  return enrollment;
}

const deleteEnrollment = async (id: string): Promise<void> => {
  await prisma.enrollment.delete({where: {id}});
}

const enrollmentService = {
  getEnrollmentById,
  createEnrollment,
  updateEnrollment,
  deleteEnrollment,
};

export default enrollmentService;
