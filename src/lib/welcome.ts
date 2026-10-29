// The first run welcome's one piece of state: whether this computer chose to carry on without an account.

import { useState } from 'react'
import { useAccount } from './account'
import { usePersistentState } from './usePersistentState'

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean'

/**
 * Whether the first run welcome shows: on a computer that is not signed in, until Continue without an account is
 * chosen, which is remembered. Create a free account and Log in put it away for this session only, so it comes back
 * next time if signing in was not finished.
 */
export function useWelcome() {
  const [withoutAccount, setWithoutAccount] = usePersistentState('serviceex.welcomeSeen', false, isBoolean)
  const [putAway, setPutAway] = useState(false)
  const account = useAccount()
  // Wait for the account, so a signed-in computer never flashes the welcome.
  const open = !withoutAccount && !putAway && account !== null && !account.signedIn
  return { open, continueWithoutAccount: () => setWithoutAccount(true), toAccount: () => setPutAway(true) }
}
