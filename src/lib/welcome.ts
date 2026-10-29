// The first run welcome's one piece of state: whether this computer has seen it.

import { useAccount } from './account'
import { usePersistentState } from './usePersistentState'

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean'

/** Whether the first run welcome shows: once, on a computer that is not signed in, until a choice is made. */
export function useWelcome() {
  const [seen, setSeen] = usePersistentState('serviceex.welcomeSeen', false, isBoolean)
  const account = useAccount()
  // Wait for the account, so a signed-in computer never flashes the welcome.
  const open = !seen && account !== null && !account.signedIn
  return { open, dismiss: () => setSeen(true) }
}

