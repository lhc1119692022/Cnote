import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { answerAppDialog, useAppDialogStore } from '@/lib/app-dialog'

export function AppDialogHost() {
  const request = useAppDialogStore(state => state.requests[0])
  return <Dialog open={Boolean(request)} onOpenChange={open => { if (!open) answerAppDialog(false) }}>
    <DialogContent>
      <DialogHeader><DialogTitle>{request?.confirm ? '确认操作' : '提示'}</DialogTitle></DialogHeader>
      <p className="whitespace-pre-wrap text-sm text-muted-foreground">{request?.message}</p>
      <div className="mt-6 flex justify-end gap-3">
        {request?.confirm && <Button variant="secondary" autoFocus onClick={() => answerAppDialog(false)}>取消</Button>}
        <Button onClick={() => answerAppDialog(true)}>确定</Button>
      </div>
    </DialogContent>
  </Dialog>
}
