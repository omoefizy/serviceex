// The Windows network check: which networks are Public, from what PowerShell prints, and the firewall command.
import { describe, expect, it } from 'vitest'
import { firewallCommand, parsePublicNetworks, publicNetworks } from './network'

describe('Public networks on Windows', () => {
  it('finds the Public ones in a list, with the category as text or as its number', () => {
    const json = JSON.stringify([
      { Name: 'Church Guest', InterfaceAlias: 'Wi-Fi', Category: 'Public' },
      { Name: 'Church Office', InterfaceAlias: 'Ethernet', Category: 'Private' },
      { Name: 'corp.example', InterfaceAlias: 'Ethernet 2', Category: 'DomainAuthenticated' },
      { Name: 'Hotspot', InterfaceAlias: 'Wi-Fi 2', NetworkCategory: 0 },
    ])
    expect(parsePublicNetworks(json)).toEqual(['Church Guest', 'Hotspot'])
  })

  it('takes a single network, as PowerShell prints when there is only one', () => {
    expect(parsePublicNetworks('{"Name":"Network 3","InterfaceAlias":"Ethernet","Category":"Public"}\r\n')).toEqual(['Network 3'])
    expect(parsePublicNetworks('{"Name":"Home","InterfaceAlias":"Wi-Fi","Category":"Private"}')).toEqual([])
  })

  it('falls back to the adapter name, and finds nothing in empty or broken output', () => {
    expect(parsePublicNetworks('{"Name":"","InterfaceAlias":"Wi-Fi","Category":"public"}')).toEqual(['Wi-Fi'])
    expect(parsePublicNetworks('')).toEqual([])
    expect(parsePublicNetworks('Get-NetConnectionProfile : not recognized')).toEqual([])
  })

  it('is never asked for on a Mac or Linux', async () => {
    expect(await publicNetworks('darwin')).toEqual([])
    expect(await publicNetworks('linux')).toEqual([])
  })
})

describe('the firewall command', () => {
  it('allows the app on Private networks only, on Windows', () => {
    const command = firewallCommand('C:\\Users\\Pat\\AppData\\Local\\Programs\\ServiceEx\\ServiceEx.exe', 'win32')
    expect(command).toBe(
      'netsh advfirewall firewall add rule name="ServiceEx Sharing" dir=in action=allow program="C:\\Users\\Pat\\AppData\\Local\\Programs\\ServiceEx\\ServiceEx.exe" enable=yes profile=private',
    )
    expect(firewallCommand('/Applications/ServiceEx.app', 'darwin')).toBeNull()
  })
})
