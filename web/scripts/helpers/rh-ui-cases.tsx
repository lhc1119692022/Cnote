import React from 'react'
import { createRoot } from 'react-dom/client'
import { CanvasProvider } from '../../src/canvas/components/CanvasProvider'
import { NodeHoverToolbar } from '../../src/canvas/components/NodeHoverToolbar'
import { RHNodePanel } from '../../src/components/runninghub/RHNodePanel'
import { RunningHubWorkflowsDialog } from '../../src/components/runninghub/RunningHubWorkflowsDialog'
import { useGraphStore } from '../../src/stores/graph-store'
import { useGenerationStore } from '../../src/stores/use-generation-store'
import { useRunningHubStore } from '../../src/stores/use-runninghub-store'
import { analyzeWorkflow } from '../../src/lib/runninghub/workflow'
import type { RequestNodeSpec } from '../../src/domain'
import '../../src/index.css'

export async function runRHUiCases() {
  const wait = () => new Promise(resolve => setTimeout(resolve, 100))
  const assert = (condition: unknown, label: string) => { if (!condition) throw new Error(label) }
  const button = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  await Promise.all([useGenerationStore.persist.rehydrate(), useRunningHubStore.persist.rehydrate()])
  const workflow = { id: 'sample', channelId: 'rh-test', workflowId: '123', name: '深度视频', revision: 1, ...analyzeWorkflow({ '21': { class_type: 'VHS_LoadVideo', inputs: { video: 'test.mp4' } } }) }
  useRunningHubStore.setState({ workflows: [workflow, { ...workflow, id: 'second', name: '第二个工作流' }] })
  useGenerationStore.setState({ channels: [{ id: 'rh-test', providerId: 'runninghub', protocol: 'runninghub', name: 'RunningHub', baseURL: 'https://www.runninghub.cn', modelIds: [], enabled: true }], generationDefaultsVersion: 3 })
  const node: RequestNodeSpec = { id: 'request', kind: 'request', variant: 'workflow', label: 'RH 工作流', position: { x: 100, y: 100 }, size: { width: 620, height: 420 }, image: { prompt: '' }, video: { prompt: '' }, rh: { channelId: 'rh-test', workflowKey: 'sample', selections: { sample: { workflow: structuredClone(workflow), values: {}, bindings: {} } }, referenceAssetIds: [] } }
  useGraphStore.setState({ currentDocument: { id: 'test', name: 'test', title: 'test', createdAt: 1, updatedAt: 1, viewport: { x: 0, y: 0, zoom: 1 }, nodes: [node], edges: [] }, selection: [node.id] })
  let setOpen: (value: boolean) => void = () => {}
  function Surface() {
    const current = useGraphStore(state => state.currentDocument!.nodes[0]) as RequestNodeSpec
    const [open, updateOpen] = React.useState(false)
    setOpen = updateOpen
    React.useEffect(() => {
      const manage = () => updateOpen(true)
      window.addEventListener('cnote:open-runninghub-settings', manage)
      return () => window.removeEventListener('cnote:open-runninghub-settings', manage)
    }, [])
    return <CanvasProvider><div style={{ position: 'absolute', top: 150, left: 120, width: 620, height: 420 }} className="flex flex-col rounded-3xl border border-border bg-card"><NodeHoverToolbar node={current} selected /><RHNodePanel node={current} /></div><RunningHubWorkflowsDialog channelId="rh-test" open={open} onOpenChange={updateOpen} /></CanvasProvider>
  }
  const host = document.createElement('div'); host.style.height = '900px'; document.body.append(host)
  createRoot(host).render(<Surface />)
  await wait(); await wait()
  assert(button('选择工作流'), 'workflow menu must remain available after selection')
  const slot = button('添加VHS_LoadVideo')!
  assert(slot && slot.getBoundingClientRect().width === 56 && slot.getBoundingClientRect().height === 56, 'one square media slot')
  assert(!document.body.textContent?.includes('等待视频输入'), 'no extra placeholder frame')
  assert(!button('更新工作流配置'), 'no update before a real edit')
  button('选择工作流')!.click(); await wait()
  const options = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')]
  assert(options.length === 2 && !options.some(option => option.textContent === '选择工作流'), 'only actual workflows in menu')
  options[1].click(); await wait()
  assert(useGraphStore.getState().currentDocument!.nodes[0].kind === 'request', 'node preserved')
  button('选择工作流')!.click(); await wait()
  ;[...document.querySelectorAll<HTMLButtonElement>('[role="option"]')][0].click(); await wait()
  button('管理 RH 工作流')!.click(); await wait()
  assert(document.querySelector('[role="dialog"]'), 'management opens')
  const footerSave = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(item => item.textContent === '保存')
  assert(footerSave, 'management has visible save/close action')
  button('编辑 深度视频')!.click(); await wait()
  const name = document.querySelector<HTMLInputElement>('[role="dialog"] label input')!
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(name, '深度视频（修改）'); name.dispatchEvent(new Event('input', { bubbles: true })); await wait()
  ;[...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === '保存工作流')!.click(); await wait()
  assert(useRunningHubStore.getState().workflows.find(item => item.id === 'sample')!.name === '深度视频（修改）', 'edit saved')
  setOpen(false); await wait()
  assert(button('更新工作流配置'), 'update action appears after management edit')
  button('更新工作流配置')!.click(); await wait()
  assert(!button('更新工作流配置'), 'update action disappears after applying')
  assert(button('选择工作流')!.textContent?.includes('修改'), 'node receives updated name')
  return { passed: true, cases: ['square input', 'retained switch menus', 'no placeholder options', 'management edit/save', 'conditional update action'] }
}
