// Addresses typed to pair with another computer: only the local network, with clear errors for anything else.
import { describe, expect, it } from 'vitest'
import { DEFAULT_SHARE_PORT, isPrivateIpv4, parseShareAddress } from './sharing'

describe('private network addresses', () => {
  it('are 10.x, 172.16 to 172.31.x, 192.168.x and link-local 169.254.x', () => {
    for (const address of ['10.0.0.5', '10.255.255.254', '172.16.0.1', '172.31.255.1', '192.168.1.20', '169.254.10.3']) {
      expect(isPrivateIpv4(address), address).toBe(true)
    }
    for (const address of ['8.8.8.8', '172.15.0.1', '172.32.0.1', '192.169.1.1', '169.254.0.1', '169.254.255.1', '127.0.0.1', '0.0.0.0', '10.0.0.256', '10.0.0']) {
      expect(isPrivateIpv4(address), address).toBe(false)
    }
  })
})

describe('typed addresses', () => {
  it('take an IP address and the default port', () => {
    expect(parseShareAddress('192.168.1.20', '')).toEqual({ host: '192.168.1.20', port: DEFAULT_SHARE_PORT })
    expect(parseShareAddress(' 10.0.0.7 ', '47820')).toEqual({ host: '10.0.0.7', port: 47820 })
    expect(parseShareAddress('172.20.4.1', '51234')).toEqual({ host: '172.20.4.1', port: 51234 })
  })

  it('take a port typed after the address', () => {
    expect(parseShareAddress('192.168.1.20:51234', '47820')).toEqual({ host: '192.168.1.20', port: 51234 })
    // A port typed in its own field wins over the default only.
    expect(parseShareAddress('192.168.1.20:51234', '50000')).toEqual({ host: '192.168.1.20', port: 50000 })
  })

  it('take .local names, in any case', () => {
    expect(parseShareAddress('Sanctuary-Booth.local', '')).toEqual({ host: 'sanctuary-booth.local', port: DEFAULT_SHARE_PORT })
    expect(parseShareAddress('booth.local.', '')).toEqual({ host: 'booth.local', port: DEFAULT_SHARE_PORT })
  })

  it('refuse internet addresses and names, with what is allowed', () => {
    expect(parseShareAddress('8.8.8.8', '')).toEqual({ error: expect.stringMatching(/not a local network address.*192\.168/) })
    expect(parseShareAddress('example.com', '')).toEqual({ error: expect.stringMatching(/not a local network name.*\.local/) })
    expect(parseShareAddress('booth', '')).toEqual({ error: expect.stringMatching(/not a local network name/) })
  })

  it('refuse this computer, bad addresses, IPv6 and bad ports', () => {
    expect(parseShareAddress('127.0.0.1', '')).toEqual({ error: expect.stringMatching(/is this computer/) })
    expect(parseShareAddress('192.168.1.300', '')).toEqual({ error: expect.stringMatching(/not a valid IP address/) })
    expect(parseShareAddress('192.168.1', '')).toEqual({ error: expect.stringMatching(/not a valid IP address/) })
    expect(parseShareAddress('fe80::1', '')).toEqual({ error: expect.stringMatching(/IPv6/) })
    expect(parseShareAddress('192.168.1.20', '70000')).toEqual({ error: expect.stringMatching(/port is a number from 1 to 65535/) })
    expect(parseShareAddress('192.168.1.20', '0')).toEqual({ error: expect.stringMatching(/port/) })
    expect(parseShareAddress('192.168.1.20', 'abc')).toEqual({ error: expect.stringMatching(/port/) })
    expect(parseShareAddress('  ', '')).toEqual({ error: expect.stringMatching(/Type the other computer/) })
    expect(parseShareAddress('bad_name.local', '')).toEqual({ error: expect.stringMatching(/not a local network name/) })
  })
})
