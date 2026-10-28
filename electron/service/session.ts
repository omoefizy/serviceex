// The account session (access and refresh tokens, and the email) kept as <userData>/serviceex-session.enc, encrypted
// with safeStorage like the developer keys (see ../secrets). Main process only.

import { clearSecret, readSecret, saveSecret } from '../secrets'
import type { SessionStore, StoredSession } from './client'

const isSession = (value: unknown): value is StoredSession => {
  const s = value as Partial<StoredSession> | null
  return !!s && typeof s.accessToken === 'string' && typeof s.refreshToken === 'string' && typeof s.expiresAt === 'number' && typeof s.email === 'string'
}

export const safeSessionStore: SessionStore = {
  async load() {
    const raw = await readSecret('serviceex-session')
    if (!raw) return null
    try {
      const parsed: unknown = JSON.parse(raw)
      return isSession(parsed) ? parsed : null
    } catch {
      return null
    }
  },
  save: (session) => saveSecret('serviceex-session', JSON.stringify(session)),
  clear: () => clearSecret('serviceex-session'),
}
