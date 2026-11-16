import { describe, expect, it } from 'vitest'
import type { Browser } from '@playwright/test'
import { SHOT_FILE } from '../../scripts/lib/schemas.ts'
import { checkHost, chooseShot, guardedRequest, isBlockedAddress, renderCard, shotName, type Lookup } from '../../scripts/lib/shots.ts'
import { cardSvg } from '../../scripts/lib/svg.ts'

describe('cardSvg', () => {
  it('escapes < > & " \' in every text field', () => {
    const svg = cardSvg({ name: `a<b>&"'`, language: '<Lang>', topics: ['x"y', '<script>'] }, 1280, 800)
    expect(svg).not.toMatch(/<script|<b>|<Lang>|x"y/)
    expect(svg).toContain('a&#60;b&#62;&#38;&#34;&#39;')
    expect(svg).toContain('&#60;Lang&#62;')
    expect(svg).toContain('width="1280" height="800"')
  })
  it('handles no language, no topics and a very long name', () => {
    const svg = cardSvg({ name: 'x'.repeat(200), language: null, topics: [] }, 1280, 800)
    expect(svg).toContain('>Code<')
    expect(svg).toMatch(/font-size="[1-9]\d?"/)
  })
  it('caps topics at 6', () => {
    const svg = cardSvg({ name: 'n', language: 'TS', topics: Array.from({ length: 20 }, (_, i) => `t${i}`) }, 1280, 800)
    expect(svg.match(/#t\d+/g)).toHaveLength(6)
  })
})

describe('isBlockedAddress', () => {
  it.each([
    '0.0.0.0', '0.255.255.255', '10.0.0.1', '10.255.255.255', '127.0.0.1', '127.255.255.254',
    '100.64.0.1', '100.127.255.255', '172.16.0.1', '172.31.255.255', '192.168.0.1', '192.168.255.255',
    '169.254.169.254', '224.0.0.1', '255.255.255.255',
    '::', '::1', '0:0:0:0:0:0:0:1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'fe80::1%eth0',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '::ffff:a00:1', '::ffff:169.254.169.254', '::ffff:c0a8:1',
    '::ffff:100.64.0.1', '::ffff:172.16.0.1', '::ffff:0.0.0.0', '0:0:0:0:0:ffff:7f00:1', '64:ff9b::7f00:1', '::127.0.0.1',
    '198.18.0.1', '198.19.255.255', '192.0.0.1', '168.63.129.16', '::ffff:168.63.129.16',
    'ff02::1', 'ff00::', 'fec0::1', 'feff::1', '100::1', '64:ff9b:1::1', '2001::1', '2001:0:4136:e378::1', '2002:808:808::1', '2002::',
    '[::1]', 'not-an-ip', '', '1.2.3', '::1::2',
  ])('blocks %s', (ip) => expect(isBlockedAddress(ip)).toBe(true))

  it.each([
    '8.8.8.8', '1.1.1.1', '100.63.255.255', '100.128.0.1', '172.15.255.255', '172.32.0.1', '192.169.0.1', '169.253.0.1', '223.255.255.255',
    '198.17.255.255', '198.20.0.0', '192.0.1.1', '168.63.129.17', '2001:db8::1', '2003::1', '100:0:0:1::1', '64:ff9b:2::1',
    '2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8', '::ffff:808:808', 'fbff::1', 'fe00::1', '64:ff9b::808:808',
  ])('allows %s', (ip) => expect(isBlockedAddress(ip)).toBe(false))
})

describe('checkHost', () => {
  const stub = (map: Record<string, string[]>) => async (h: string) => {
    const a = map[h]
    if (!a) throw new Error('ENOTFOUND')
    return a.map((address) => ({ address }))
  }
  it('allows a host whose addresses are all public', async () => {
    expect(await checkHost('example.com', stub({ 'example.com': ['93.184.216.34', '2606:2800::1'] }))).toBe(true)
  })
  it('blocks a hostname that resolves to 127.0.0.1', async () => {
    expect(await checkHost('evil.test', stub({ 'evil.test': ['127.0.0.1'] }))).toBe(false)
  })
  it('blocks when ANY address is blocked', async () => {
    expect(await checkHost('mixed.test', stub({ 'mixed.test': ['8.8.8.8', '169.254.169.254'] }))).toBe(false)
  })
  it('blocks on lookup error, empty answer, localhost names and literal private IPs', async () => {
    expect(await checkHost('nope.test', stub({}))).toBe(false)
    expect(await checkHost('empty.test', stub({ 'empty.test': [] }))).toBe(false)
    expect(await checkHost('localhost', stub({ localhost: ['8.8.8.8'] }))).toBe(false)
    expect(await checkHost('a.LOCALHOST', stub({}))).toBe(false)
    expect(await checkHost('169.254.169.254', stub({}))).toBe(false)
    expect(await checkHost('[::1]', stub({}))).toBe(false)
    expect(await checkHost('8.8.8.8', stub({}))).toBe(true)
  })
})

describe('shotName', () => {
  it.each([
    ['plain', 'plain'], ['.github', '_github'], ['foo.', 'foo_'], ['a..b', 'a__b'], ['a...b', 'a___b'], ['..x', '__x'], ['x..', 'x__'],
    ['a.b.c', 'a.b.c'], ['OCR1', 'OCR1'], ['a_b-c', 'a_b-c'],
  ])('%s -> %s', (i, o) => {
    expect(shotName(i)).toBe(o)
    expect(SHOT_FILE.test(`${shotName(i)}.webp`)).toBe(true)
  })
  it('SHOT_FILE refuses a leading dot', () => {
    expect(SHOT_FILE.test('.hidden.webp')).toBe(false)
    expect(SHOT_FILE.test('ok.webp')).toBe(true)
  })
})

describe('guardedRequest (DNS rebinding)', () => {
  it('connects only to the address the guard checked: public first answer, loopback second -> blocked', async () => {
    let calls = 0
    const lookup: Lookup = async () => [{ address: ++calls === 1 ? '93.184.216.34' : '127.0.0.1' }]
    const url = new URL('https://rebind.test/')
    expect(await checkHost(url.hostname, lookup)).toBe(true) // the pre-check passes ...
    await expect(guardedRequest(url, { method: 'GET', headers: {}, timeoutMs: 3000, lookup })).rejects.toThrow(/blocked address/) // ... the socket lookup sees 127.0.0.1
    expect(calls).toBe(2)
  })
  it('blocks when any resolved address is blocked', async () => {
    const lookup: Lookup = async () => [{ address: '93.184.216.34' }, { address: '10.0.0.5' }]
    await expect(guardedRequest(new URL('https://mixed.test/'), { method: 'GET', headers: {}, timeoutMs: 3000, lookup })).rejects.toThrow(/blocked address/)
  })
  it('fails when the lookup fails', async () => {
    const lookup: Lookup = async () => {
      throw new Error('ENOTFOUND')
    }
    await expect(guardedRequest(new URL('https://nope.test/'), { method: 'GET', headers: {}, timeoutMs: 3000, lookup })).rejects.toThrow()
  })
})

describe('renderCard output check', () => {
  it('throws when Chromium returns something that is not a WebP', async () => {
    const page = { goto: async () => {}, setContent: async () => {}, screenshot: async () => Buffer.from('png'), evaluate: async () => Buffer.from('junk').toString('base64') }
    const ctx = { route: async () => {}, newPage: async () => page, close: async () => {} }
    const browser = { newContext: async () => ctx } as unknown as Browser
    await expect(renderCard(browser, { name: 'x', language: null, topics: [] }, { width: 10, height: 10, timeoutMs: 1000 })).rejects.toThrow(/WebP/)
  })
})

describe('chooseShot (rules 8-9)', () => {
  it('ok -> new', () => expect(chooseShot(true, true)).toBe('new'))
  it('fail with previous -> previous', () => expect(chooseShot(false, true)).toBe('previous'))
  it('fail without previous -> card', () => expect(chooseShot(false, false)).toBe('card'))
})
