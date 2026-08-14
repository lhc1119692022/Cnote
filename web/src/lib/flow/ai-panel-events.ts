export const AI_PANEL_SEND_EVENT = 'cnote:ai-panel-send'

export function requestAIMessageSend(nodeId: string) {
  window.dispatchEvent(new CustomEvent(AI_PANEL_SEND_EVENT, { detail: { nodeId } }))
}
