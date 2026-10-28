// Windows network checks for Sharing: which networks Windows treats as Public (where its firewall keeps other
// computers out), and the firewall rule an administrator can add by hand. The installer cannot add that rule: it
// installs per user, without administrator rights (see electron-builder.json5). Nothing here touches Electron.

import { execFile } from 'node:child_process'

/** Lists each connected network with its category as text: Public, Private or DomainAuthenticated. */
const PROFILE_SCRIPT =
  "Get-NetConnectionProfile | Select-Object Name, InterfaceAlias, @{ Name = 'Category'; Expression = { [string]$_.NetworkCategory } } | ConvertTo-Json -Compress"

/**
 * The names of the networks in Get-NetConnectionProfile's JSON that are Public. Takes one object or a list, and the
 * category as text or as its number (0 is Public).
 */
export function parsePublicNetworks(json: string): string[] {
  let value: unknown
  try {
    value = JSON.parse(json.trim() || '[]')
  } catch {
    return []
  }
  const profiles = (Array.isArray(value) ? value : [value]) as Partial<Record<'Name' | 'InterfaceAlias' | 'Category' | 'NetworkCategory', unknown>>[]
  return profiles
    .filter((p) => typeof p === 'object' && p !== null)
    .filter((p) => {
      const category = p.Category ?? p.NetworkCategory
      return category === 0 || category === '0' || (typeof category === 'string' && category.toLowerCase() === 'public')
    })
    .map((p) => String(p.Name || p.InterfaceAlias || 'Unnamed network').slice(0, 80))
}

/** The networks Windows treats as Public right now; always empty elsewhere, or when Windows cannot say. */
export function publicNetworks(platform: NodeJS.Platform = process.platform): Promise<string[]> {
  if (platform !== 'win32') return Promise.resolve([])
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PROFILE_SCRIPT],
      { timeout: 10_000, windowsHide: true },
      (error, stdout) => resolve(error ? [] : parsePublicNetworks(stdout)),
    )
  })
}

/**
 * The command that lets other computers reach this app on Private networks only: one rule for the program, so it
 * covers TCP 47820 (or whichever port Sharing took) and UDP 5353 for finding devices. It needs an administrator.
 */
export function firewallCommand(exe: string, platform: NodeJS.Platform = process.platform): string | null {
  if (platform !== 'win32') return null
  return `netsh advfirewall firewall add rule name="ServiceEx Sharing" dir=in action=allow program="${exe}" enable=yes profile=private`
}
