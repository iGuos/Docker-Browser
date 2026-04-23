import { useEffect } from 'react'

const APP_DIALOG_OVERLAY = '[data-app-dialog-overlay]'

/**
 * Escape 关闭弹层；若全局 App 确认/提示框在上层打开，则不处理（避免一次 Esc 关掉多层）。
 */
export function useModalEscape(open: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (document.querySelector(APP_DIALOG_OVERLAY)) return
      e.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
}
