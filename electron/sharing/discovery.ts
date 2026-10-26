// Finds other ServiceEx computers on the local network with mDNS (Bonjour), and announces this one. Each computer
// publishes _serviceex._tcp with its device id and name in the TXT record.

import { Bonjour, type Browser, type Service } from 'bonjour-service'
import net from 'node:net'
import { ID_PATTERN, PROTOCOL_VERSION, SERVICE_TYPE } from './protocol'

export interface DiscoveredPeer {
  id: string
  name: string
  host: string
  port: number
}

export class Discovery {
  private bonjour: Bonjour | null = null
  private browser: Browser | null = null
  private readonly found = new Map<string, DiscoveredPeer>()
  private readonly onChange: () => void

  constructor(onChange: () => void) {
    this.onChange = onChange
  }

  /** Publishes this computer and starts looking for others. Calling it again republishes (a new name, say). */
  start(me: { id: string; name: string; port: number }): void {
    this.stop()
    const bonjour = new Bonjour(undefined, (error: unknown) => console.error('mDNS error', error))
    this.bonjour = bonjour
    bonjour.publish({
      // Unique on the network even when two computers share a name.
      name: `${me.name} ${me.id.slice(0, 6)}`,
      type: SERVICE_TYPE,
      port: me.port,
      txt: { id: me.id, name: me.name, v: String(PROTOCOL_VERSION) },
    })
    this.browser = bonjour.find({ type: SERVICE_TYPE }, (service) => this.up(service, me.id))
    this.browser.on('down', (service: Service) => {
      const id = String(service.txt?.id ?? '')
      if (this.found.delete(id)) this.onChange()
    })
  }

  stop(): void {
    this.browser?.stop()
    this.browser = null
    if (this.bonjour) {
      const bonjour = this.bonjour
      bonjour.unpublishAll(() => bonjour.destroy())
    }
    this.bonjour = null
    if (this.found.size > 0) {
      this.found.clear()
      this.onChange()
    }
  }

  /** Asks the network again, as when the operator opens the device list. */
  refresh(): void {
    this.browser?.update()
  }

  list(): DiscoveredPeer[] {
    return [...this.found.values()]
  }

  get(id: string): DiscoveredPeer | undefined {
    return this.found.get(id)
  }

  private up(service: Service, myId: string): void {
    const id = String(service.txt?.id ?? '')
    if (!ID_PATTERN.test(id) || id === myId) return
    // IPv4 first: link-local IPv6 addresses need a zone id that mDNS does not give.
    const addresses = (service.addresses ?? []).filter((a) => net.isIP(a))
    const host = addresses.find((a) => net.isIPv4(a)) ?? addresses[0] ?? service.host
    if (!host || !Number.isInteger(service.port)) return
    const name = String(service.txt?.name ?? service.name).slice(0, 40)
    this.found.set(id, { id, name, host, port: service.port })
    this.onChange()
  }
}
