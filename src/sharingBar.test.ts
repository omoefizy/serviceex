// The sharing controls in the operator window: received PowerPoint files import in the mode the operator chose, the
// incoming chip with Decline, Cancel and Dismiss on transfers, pairing by a typed address, and the hint shown when no
// other computer can be found or Windows has the network set to Public.
import { createElement, Fragment, Profiler } from 'react'
import { renderToString } from 'react-dom/server'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IncomingTransfer, InboxItem, SharePeer, SharingEvent, TransferProgress } from '../shared/types'

let listener: ((event: SharingEvent) => void) | null = null
const calls: { method: string; args: unknown[] }[] = []
const stored = new Map<string, string>()
const record =
  (method: string, answer: unknown = undefined) =>
  async (...args: unknown[]) => {
    calls.push({ method, args })
    return typeof answer === 'function' ? (answer as (...a: unknown[]) => unknown)(...args) : answer
  }

vi.stubGlobal('localStorage', {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => stored.set(key, value),
  removeItem: (key: string) => stored.delete(key),
})
vi.stubGlobal('window', {
  api: {
    presentations: { import: record('presentations.import', []), list: async () => [], delete: record('presentations.delete') },
    sharing: {
      status: async () => ({ enabled: true, deviceId: 'a'.repeat(32), deviceName: 'Booth', port: 47820, addresses: [], error: null, publicNetworks: [], firewallCommand: null }),
      peers: async () => [],
      inbox: async () => [],
      cues: async () => [],
      sharedService: async () => ({ role: 'none', items: [] }),
      librarySync: async () => null,
      cancel: record('sharing.cancel'),
      decline: record('sharing.decline'),
      pairByAddress: record('sharing.pairByAddress', (host: unknown) => {
        if (host === '192.168.1.99') throw new Error('192.168.1.99:47820 did not answer in time.')
        return { pairingId: 'p'.repeat(32), peerId: 'b'.repeat(32), name: 'Sanctuary booth' }
      }),
      onEvent: (fn: (event: SharingEvent) => void) => {
        listener = fn
        return () => {}
      },
    },
  },
})

const { applyAcceptResult, beginPairingAt, cancelTransfer, declineIncoming, dismissTransfer, showNoDevicesHint, NO_DEVICES_HINT_MS, startSharing, useSharingStore } = await import(
  './lib/sharing'
)
const { chosenImportMode, IMPORT_MODE_KEY } = await import('./lib/presentations')
const { IncomingChip, NetworkHint, SharingBar, SharingDetails } = await import('./components/SharingBar')

const sender = 'c'.repeat(32)
const incoming = (patch: Partial<IncomingTransfer> = {}): IncomingTransfer => ({
  id: `${sender}-${'d'.repeat(32)}`,
  senderId: sender,
  senderName: 'Youth room',
  name: 'Easter.pptx',
  size: 4 * 1024 * 1024,
  received: 1024 * 1024,
  state: 'receiving',
  ...patch,
})
const transfer = (patch: Partial<TransferProgress> = {}): TransferProgress => ({
  id: 'e'.repeat(32),
  peerId: 'b'.repeat(32),
  peerName: 'Sanctuary booth',
  name: 'Sunday.serviceex',
  sent: 0,
  size: 100,
  state: 'sending',
  ...patch,
})

beforeEach(() => {
  calls.length = 0
  stored.clear()
  useSharingStore.setState({ transfers: [], incoming: [], pairing: null, message: null })
})

describe('received PowerPoint files', () => {
  const done = { status: 'done' as const, message: 'Easter is being added to Presentations.', presentations: [{ path: '/r/Easter.pptx', replaceId: null }], serviceId: null, changed: [] }

  it('import in Native mode when the operator chose it in the Presentations panel', async () => {
    stored.set(IMPORT_MODE_KEY, JSON.stringify('native'))
    expect(chosenImportMode()).toBe('native')
    await applyAcceptResult(done)
    expect(calls.find((c) => c.method === 'presentations.import')?.args).toEqual([['/r/Easter.pptx'], 'native'])
  })

  it('import in Image mode by default, or when what was stored is not a mode', async () => {
    expect(chosenImportMode()).toBe('image')
    stored.set(IMPORT_MODE_KEY, '"sideways"')
    await applyAcceptResult(done)
    expect(calls.find((c) => c.method === 'presentations.import')?.args).toEqual([['/r/Easter.pptx'], 'image'])
  })

  it('from library sync import in the chosen mode too', async () => {
    stored.set(IMPORT_MODE_KEY, JSON.stringify('native'))
    startSharing()
    listener?.({ type: 'librarySaved', presentations: ['/r/Talk.pptx'], changed: [] })
    await vi.waitFor(() => expect(calls.find((c) => c.method === 'presentations.import')?.args).toEqual([['/r/Talk.pptx'], 'native']))
  })
})

describe('incoming files', () => {
  it('show who from, what, how far, and Decline', () => {
    const html = renderToString(createElement(IncomingChip, { transfer: incoming() }))
    expect(html).toContain('Youth room')
    expect(html).toContain('Easter.pptx')
    expect(html).toContain('25%')
    expect(html).toContain('Decline')
  })

  it('say when the sender has gone quiet, and still offer Decline', () => {
    const html = renderToString(createElement(IncomingChip, { transfer: incoming({ state: 'stalled' }) }))
    expect(html).toContain('Waiting for Youth room 25%')
    expect(html).toContain('Decline')
  })

  it('once over, say how it ended and offer Dismiss instead', () => {
    const html = renderToString(createElement(IncomingChip, { transfer: incoming({ state: 'done', received: 4 * 1024 * 1024 }) }))
    expect(html).toContain('In the Inbox')
    expect(html).not.toContain('Decline')
    expect(html).toContain('Dismiss')
  })

  it('follow the events from the main process, one chip per file', () => {
    startSharing()
    listener?.({ type: 'incoming', transfer: incoming({ received: 0 }) })
    listener?.({ type: 'incoming', transfer: incoming({ received: 2 * 1024 * 1024 }) })
    expect(useSharingStore.getState().incoming).toEqual([incoming({ received: 2 * 1024 * 1024 })])
    listener?.({ type: 'incoming', transfer: incoming({ state: 'cancelled', received: 0 }) })
    expect(useSharingStore.getState().incoming[0].state).toBe('cancelled')
    expect(useSharingStore.getState().message?.text).toBe('Youth room stopped sending Easter.pptx.')
  })

  it('are declined through the main process', async () => {
    await declineIncoming(incoming().id)
    expect(calls).toEqual([{ method: 'sharing.decline', args: [incoming().id] }])
  })
})

describe('transfers from this computer', () => {
  it('cancel through the main process', async () => {
    await cancelTransfer(transfer().id)
    expect(calls).toEqual([{ method: 'sharing.cancel', args: [transfer().id] }])
  })

  it('leave the bar when dismissed, and the main process clears them and their package', () => {
    useSharingStore.setState({ transfers: [transfer({ state: 'failed', error: 'No answer' })] })
    dismissTransfer(transfer().id)
    expect(useSharingStore.getState().transfers).toEqual([])
    expect(calls).toEqual([{ method: 'sharing.cancel', args: [transfer().id] }])
  })

  it('say when the other computer declined', () => {
    startSharing()
    listener?.({ type: 'progress', transfer: transfer({ state: 'declined', error: 'Sanctuary booth declined the file.' }) })
    expect(useSharingStore.getState().message).toEqual({ text: 'Sanctuary booth declined Sunday.serviceex.', error: true })
  })
})

describe('pairing by address', () => {
  it('asks the computer at the address who it is, and waits for its code', async () => {
    await beginPairingAt('192.168.1.20', '47820')
    expect(calls).toEqual([{ method: 'sharing.pairByAddress', args: ['192.168.1.20', '47820'] }])
    expect(useSharingStore.getState().pairing).toMatchObject({
      peerId: 'b'.repeat(32),
      peerName: 'Sanctuary booth',
      pairingId: 'p'.repeat(32),
      busy: false,
      error: null,
      address: { host: '192.168.1.20', port: '47820' },
    })
  })

  it('shows why when nothing answers', async () => {
    await beginPairingAt('192.168.1.99', '47820')
    expect(useSharingStore.getState().pairing).toMatchObject({ pairingId: null, busy: false, error: '192.168.1.99:47820 did not answer in time.' })
  })
})

describe('the no devices hint', () => {
  it('waits 10 seconds with no other computer online', () => {
    expect(NO_DEVICES_HINT_MS).toBe(10_000)
    expect(showNoDevicesHint(null, 50_000)).toBe(false)
    expect(showNoDevicesHint(1_000, 10_999)).toBe(false)
    expect(showNoDevicesHint(1_000, 11_000)).toBe(true)
  })

  it('points to the firewall and the network setting, with a link to Troubleshooting', () => {
    const html = renderToString(createElement(NetworkHint, { noDevices: true, publicNetworks: [], onDismiss: () => {} }))
    expect(html).toContain('No other computers found')
    expect(html).toMatch(/firewall/)
    expect(html).toMatch(/Private, not Public/)
    expect(html).toContain('Troubleshooting')
  })

  it('warns at once when Windows has the network set to Public', () => {
    const html = renderToString(createElement(NetworkHint, { noDevices: false, publicNetworks: ['Church Guest'], onDismiss: () => {} }))
    expect(html).toContain('Windows treats Church Guest as a Public network')
    expect(html).toContain('How to fix')
  })

  it('shows nothing while other computers are found on a Private network', () => {
    expect(renderToString(createElement(NetworkHint, { noDevices: false, publicNetworks: [], onDismiss: () => {} }))).toBe('')
  })
})

describe('the sharing bar', () => {
  // Tells React the renders below run inside act().
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

  const peer = (patch: Partial<SharePeer> = {}): SharePeer => ({
    id: 'b'.repeat(32),
    name: 'Sanctuary booth',
    online: true,
    paired: true,
    trusted: false,
    disconnected: false,
    liveTitle: 'Amazing Grace',
    hosting: null,
    ...patch,
  })
  const received = (id: string): InboxItem => ({ id, senderId: sender, senderName: 'Youth room', name: `${id}.serviceex`, size: 1024, kind: 'package', receivedAt: '2026-10-25T09:00:00.000Z' })
  const initial = useSharingStore.getState()
  // The mount, and one each for the six loads it starts; a selector returning a new value each time loops past 50.
  const MAX_COMMITS = 8

  /** Mounts the bar (with the status popover's sharing details), lets the loads started on mount settle, and counts the commits it took. */
  async function mount(): Promise<{ commits: number; renderer: ReactTestRenderer }> {
    let commits = 0
    let renderer!: ReactTestRenderer
    await act(async () => {
      // Stops a render loop here, as a failure, instead of letting it hang the run.
      const onRender = () => {
        if (++commits > MAX_COMMITS * 5) throw new Error(`SharingBar rendered ${commits} times`)
      }
      const details = createElement(SharingDetails, { noDevices: false, hintHidden: false, onHideHint: () => {} })
      renderer = create(createElement(Profiler, { id: 'bar', onRender }, createElement(Fragment, null, createElement(SharingBar), details)))
    })
    return { commits, renderer }
  }

  beforeEach(() => {
    useSharingStore.setState(initial, true)
    vi.restoreAllMocks()
  })

  it('settles in a few renders with devices, transfers and Inbox items', async () => {
    const peers = [peer(), peer({ id: 'f'.repeat(32), name: 'Youth room', paired: false, liveTitle: null })]
    const inbox = [received('one'), received('two'), received('three')]
    vi.spyOn(window.api.sharing, 'peers').mockResolvedValue(peers)
    vi.spyOn(window.api.sharing, 'inbox').mockResolvedValue(inbox)
    useSharingStore.setState({ peers, inbox, transfers: [transfer(), transfer({ id: '9'.repeat(32), state: 'preparing' })], incoming: [incoming()] })

    const { commits, renderer } = await mount()
    const text = JSON.stringify(renderer.toJSON())
    expect(text).toContain('Sanctuary booth')
    expect(text).toContain('Sunday.serviceex')
    expect(text).toContain('Easter.pptx')
    expect(renderer.root.findByProps({ 'aria-label': 'Inbox, 3 items' })).toBeTruthy()
    expect(commits).toBeLessThanOrEqual(MAX_COMMITS)
    act(() => renderer.unmount())
  })

  it('settles in a few renders with nothing shared yet and no status loaded', async () => {
    vi.spyOn(window.api.sharing, 'status').mockReturnValue(new Promise(() => {}))

    const { commits, renderer } = await mount()
    expect(useSharingStore.getState().status).toBeNull()
    expect(renderer.toJSON()).toBeNull()
    expect(commits).toBeLessThanOrEqual(MAX_COMMITS)
    act(() => renderer.unmount())
  })
})
