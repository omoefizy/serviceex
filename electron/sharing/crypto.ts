// The cryptography behind local network sharing. Nothing here touches Electron, so tests run it in plain Node.
//
// Pairing is SPAKE2 over the 2048-bit MODP group of RFC 3526, keyed by the 6 digit code the receiving computer
// shows. Someone on the network who sees or even sits in the middle of the exchange cannot test codes offline;
// each pairing allows one guess. The shared key it produces is stored per device.
//
// Every request after pairing travels in a sealed envelope: AES-256-GCM with a key per direction derived from
// that shared key, bound to both device ids, the request path and a fresh nonce. That is the authenticated,
// encrypted channel: a device without the key can neither read nor forge anything, and replays are refused.

import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'

const P = BigInt(
  '0xffffffffffffffffc90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74020bbea63b139b22514a08798e3404ddef9519b3cd3a431b302b0a6df25f14374fe1356d6d51c245e485b576625e7ec6f44c42e9a637ed6b0bff5cb6f406b7edee386bfb5a899fa5ae9f24117c4b1fe649286651ece45b3dc2007cb8a163bf0598da48361c55d39a69163fa8fd24cf5f83655d23dca3ad961c62f356208552bb9ed529077096966d670c354e4abc9804f1746c08ca18217c32905e462e36ce3be39e772c180e86039b2783a2ec07a28fb5c55df06f4c52c9de2bcbf6955817183995497cea956ae515d2261898fa051015728e5a8aacaa68ffffffffffffffff',
)
/** P is a safe prime; 2 generates the subgroup of order Q, the quadratic residues. */
const Q = (P - 1n) / 2n
const G = 2n
const BYTES = 256

/** The RFC 3526 prime, for the test that checks it against Node's own copy. */
export const PAIRING_PRIME_HEX = P.toString(16)

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n
  let b = base % modulus
  let e = exponent
  while (e > 0n) {
    if (e & 1n) result = (result * b) % modulus
    b = (b * b) % modulus
    e >>= 1n
  }
  return result
}

const toBig = (bytes: Buffer) => BigInt(`0x${bytes.toString('hex') || '0'}`)
const toBytes = (value: bigint) => Buffer.from(value.toString(16).padStart(BYTES * 2, '0'), 'hex')

/** A group element nobody knows the discrete log of: a hash, squared into the subgroup. */
function hashToGroup(label: string): bigint {
  const blocks = [0, 1, 2, 3, 4].map((i) => createHash('sha512').update(`${label} ${i}`).digest())
  return modPow(toBig(Buffer.concat(blocks)) % P, 2n, P)
}

const M = hashToGroup('ServiceEx SPAKE2 M')
const N = hashToGroup('ServiceEx SPAKE2 N')

function randomExponent(): bigint {
  // 512 random bits reduced mod Q are uniform enough for all practical purposes.
  return (toBig(randomBytes(64)) % (Q - 1n)) + 1n
}

const codeScalar = (code: string) => toBig(createHash('sha256').update(`ServiceEx pairing code ${code}`).digest()) % Q

/** Rejects anything that is not an element of the subgroup, which would leak the code. */
function checkElement(value: bigint): void {
  if (value <= 1n || value >= P - 1n || modPow(value, Q, P) !== 1n) throw new Error('The other computer sent an invalid pairing message')
}

/** A fresh 6 digit code. */
export function pairingCode(): string {
  const value = toBig(randomBytes(6)) % 1_000_000n
  return value.toString().padStart(6, '0')
}

export interface PairingKeys {
  /** The key both sides store for this pair of devices. */
  secret: Buffer
  /** Proof for the initiator (the computer that typed the code) and for the responder (the one that showed it). */
  initiatorConfirm: Buffer
  responderConfirm: Buffer
}

function deriveKeys(initiatorId: string, responderId: string, x: Buffer, y: Buffer, k: Buffer): PairingKeys {
  const transcript = createHash('sha256')
  for (const part of [Buffer.from('ServiceEx-SPAKE2-v1'), Buffer.from(initiatorId), Buffer.from(responderId), x, y, k]) {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(part.length)
    transcript.update(length).update(part)
  }
  const hash = transcript.digest()
  const confirmKey = Buffer.from(hkdfSync('sha256', hash, Buffer.alloc(0), 'ServiceEx confirm', 32))
  return {
    secret: Buffer.from(hkdfSync('sha256', hash, Buffer.alloc(0), 'ServiceEx shared secret', 32)),
    initiatorConfirm: createHmac('sha256', confirmKey).update('initiator').digest(),
    responderConfirm: createHmac('sha256', confirmKey).update('responder').digest(),
  }
}

/** The computer that types the code. */
export class PairingInitiator {
  private readonly x = randomExponent()
  private readonly w: bigint
  private readonly initiatorId: string
  private readonly responderId: string
  /** The first message, sent to the responder. */
  readonly message: Buffer

  constructor(initiatorId: string, responderId: string, code: string) {
    this.initiatorId = initiatorId
    this.responderId = responderId
    this.w = codeScalar(code)
    this.message = toBytes((modPow(G, this.x, P) * modPow(M, this.w, P)) % P)
  }

  /** Takes the responder's message; the keys are only good once its confirmation has been checked. */
  finish(responderMessage: Buffer): PairingKeys {
    const y = toBig(responderMessage)
    checkElement(y)
    const unblinded = (y * modPow(modPow(N, this.w, P), P - 2n, P)) % P
    const k = toBytes(modPow(unblinded, this.x, P))
    return deriveKeys(this.initiatorId, this.responderId, this.message, toBytes(y), k)
  }
}

/** The computer that shows the code: answers the initiator's message. */
export function respondToPairing(
  initiatorId: string,
  responderId: string,
  code: string,
  initiatorMessage: Buffer,
): { message: Buffer; keys: PairingKeys } {
  const x = toBig(initiatorMessage)
  checkElement(x)
  const w = codeScalar(code)
  const y = randomExponent()
  const message = toBytes((modPow(G, y, P) * modPow(N, w, P)) % P)
  const unblinded = (x * modPow(modPow(M, w, P), P - 2n, P)) % P
  const k = toBytes(modPow(unblinded, y, P))
  return { message, keys: deriveKeys(initiatorId, responderId, toBytes(x), message, k) }
}

export const sameBytes = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b)

// ---------- Sealed envelopes ----------

/** The key one device seals with for another, for requests or for responses. */
export function channelKey(secret: Buffer, fromId: string, toId: string, direction: 'request' | 'response'): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, Buffer.from('ServiceEx channel v1'), `${direction} ${fromId} > ${toId}`, 32))
}

/** Seals a JSON header and optional binary body: iv (12) | ciphertext | tag (16). */
export function seal(key: Buffer, aad: string, header: object, body: Buffer = Buffer.alloc(0)): Buffer {
  const json = Buffer.from(JSON.stringify(header))
  const length = Buffer.alloc(4)
  length.writeUInt32BE(json.length)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(aad))
  const ciphertext = Buffer.concat([cipher.update(length), cipher.update(json), cipher.update(body), cipher.final()])
  return Buffer.concat([iv, ciphertext, cipher.getAuthTag()])
}

/** Opens an envelope, or throws when it was not sealed with this key for this purpose. */
export function open<T = Record<string, unknown>>(key: Buffer, aad: string, envelope: Buffer): { header: T; body: Buffer } {
  if (envelope.length < 12 + 4 + 16) throw new Error('Envelope too short')
  const decipher = createDecipheriv('aes-256-gcm', key, envelope.subarray(0, 12))
  decipher.setAAD(Buffer.from(aad))
  decipher.setAuthTag(envelope.subarray(envelope.length - 16))
  const plain = Buffer.concat([decipher.update(envelope.subarray(12, envelope.length - 16)), decipher.final()])
  const length = plain.readUInt32BE(0)
  if (length > plain.length - 4) throw new Error('Envelope header too long')
  return { header: JSON.parse(plain.subarray(4, 4 + length).toString()) as T, body: plain.subarray(4 + length) }
}

export const randomId = (bytes = 16) => randomBytes(bytes).toString('hex')
