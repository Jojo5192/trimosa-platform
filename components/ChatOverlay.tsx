'use client'

/**
 * Thin wrapper: the global chat modal opened from the NavBar.
 * All chat UI/logic lives in components/chat/ChatPanel.tsx (shared with the
 * /dashboard/chat and /guest/chat pages).
 */
import ChatPanel from '@/components/chat/ChatPanel'

interface Props {
  open: boolean
  onClose: () => void
  userId: string
}

export default function ChatOverlay({ open, onClose, userId }: Props) {
  if (!open) return null
  return <ChatPanel variant="overlay" open={open} onClose={onClose} userId={userId} />
}
