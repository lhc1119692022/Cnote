import { create } from 'zustand'

interface MessageRequest {
  message: string
  confirm: boolean
  resolve: (accepted: boolean) => void
}

export const useAppDialogStore = create<{ requests: MessageRequest[] }>(() => ({ requests: [] }))

export function askConfirmation(message: string): Promise<boolean> {
  return new Promise(resolve => useAppDialogStore.setState(state => ({ requests: [...state.requests, { message, confirm: true, resolve }] })))
}

export function showMessage(message: string): void {
  useAppDialogStore.setState(state => ({ requests: [...state.requests, { message, confirm: false, resolve: () => undefined }] }))
}

export function answerAppDialog(accepted: boolean): void {
  const request = useAppDialogStore.getState().requests[0]
  if (!request) return
  useAppDialogStore.setState(state => ({ requests: state.requests.slice(1) }))
  request.resolve(accepted)
}
