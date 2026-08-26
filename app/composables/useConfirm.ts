import ConfirmationModal from '~/components/modals/ConfirmationModal.vue'

export interface ConfirmOptions {
  title: string
  description?: string
  affected?: { label: string; count: number }[]
  confirmLabel?: string
}

let modal: { open: (props: ConfirmOptions) => { result: Promise<boolean> } } | undefined

export function useConfirm() {
  const overlay = useOverlay()
  modal ??= overlay.create(ConfirmationModal)

  return (options: ConfirmOptions) => modal!.open(options).result
}
