// Awaited openers for the Database page's minor-record modals, following useConfirm.ts: one lazily
// created overlay instance per modal, opened with its options and resolved with a draft.
//
// Every opener normalizes to `null`. useOverlay resolves `undefined` when a modal is dismissed by
// ESC or an outside click rather than through its own Cancel button, and a caller testing the
// result must not have to know the difference.

import ContactFormModal from '~/components/modals/ContactFormModal.vue'
import TeamFormModal from '~/components/modals/TeamFormModal.vue'
import MemberPickerModal from '~/components/modals/MemberPickerModal.vue'
import MoveMemberModal from '~/components/modals/MoveMemberModal.vue'
import ProjectPickerModal from '~/components/modals/ProjectPickerModal.vue'
import SemesterInfoModal from '~/components/modals/SemesterInfoModal.vue'
import type { ProjectRead } from '#server/services/projectService'
import type { StudentRead } from '#server/services/studentService'
import type { SelectOption } from '~/utils/options'
import type { ContactDraft, SemesterInfoDraft, TeamDraft } from '~/utils/recordDrafts'

export function useRecordModals() {
  const overlay = useOverlay()

  const contactModal = overlay.create(ContactFormModal)
  const teamModal = overlay.create(TeamFormModal)
  const memberModal = overlay.create(MemberPickerModal)
  const moveModal = overlay.create(MoveMemberModal)
  const projectModal = overlay.create(ProjectPickerModal)
  const semesterInfoModal = overlay.create(SemesterInfoModal)

  async function openContactModal() {
    return ((await contactModal.open().result) ?? null) as ContactDraft | null
  }

  async function openTeamModal(props: { semesters: SelectOption[]; defaultSemesterId?: string }) {
    return ((await teamModal.open(props).result) ?? null) as TeamDraft | null
  }

  async function openMemberModal(props: { title: string; students: StudentRead[] }) {
    return ((await memberModal.open(props).result) ?? null) as StudentRead | null
  }

  async function openMoveModal(props: { teams: SelectOption[] }) {
    return ((await moveModal.open(props).result) ?? null) as string | null
  }

  async function openProjectPicker(props: { title: string; projects: ProjectRead[] }) {
    return ((await projectModal.open(props).result) ?? null) as ProjectRead | null
  }

  async function openSemesterInfoModal(props: {
    isMentor: boolean
    semesters: SelectOption[]
    taken: { STUDENT: string[]; MENTOR: string[] }
    projects: ProjectRead[]
  }) {
    return ((await semesterInfoModal.open(props).result) ?? null) as SemesterInfoDraft | null
  }

  return {
    openContactModal,
    openTeamModal,
    openMemberModal,
    openMoveModal,
    openProjectPicker,
    openSemesterInfoModal,
  }
}
