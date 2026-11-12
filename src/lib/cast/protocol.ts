/**
 * Google Cast v2 wire format. Every message on the TLS socket (port 8009) is a 4-byte big-endian
 * length followed by a protobuf `CastMessage`:
 *
 *   1 protocol_version (enum, always 0)   2 source_id (string)   3 destination_id (string)
 *   4 namespace (string)                  5 payload_type (enum: 0 string, 1 binary)
 *   6 payload_utf8 (string)               7 payload_binary (bytes)
 *
 * Only string (JSON) payloads are used, so this is a few dozen lines instead of a protobuf library.
 */

export interface CastMessage {
  sourceId: string;
  destinationId: string;
  namespace: string;
  /** JSON text; empty for a binary payload (never sent by the receivers used here) */
  data: string;
}

/** Largest message a receiver sends is a media status with a long queue; anything bigger is junk. */
export const MAX_MESSAGE_BYTES = 1 << 20;

function varint(n: number): number[] {
  const out: number[] = [];
  while (n > 0x7f) {
    out.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  out.push(n);
  return out;
}

function stringField(field: number, value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8');
  return Buffer.concat([Buffer.from([(field << 3) | 2, ...varint(bytes.length)]), bytes]);
}

/** One framed message, ready to write to the socket. */
export function encodeMessage(m: CastMessage): Buffer {
  const body = Buffer.concat([
    Buffer.from([0x08, 0x00]), // protocol_version = CASTV2_1_0
    stringField(2, m.sourceId),
    stringField(3, m.destinationId),
    stringField(4, m.namespace),
    Buffer.from([0x28, 0x00]), // payload_type = STRING
    stringField(6, m.data),
  ]);
  const head = Buffer.alloc(4);
  head.writeUInt32BE(body.length, 0);
  return Buffer.concat([head, body]);
}

function readVarint(buf: Buffer, pos: number): [number, number] {
  let result = 0;
  let shift = 0;
  for (;;) {
    if (pos >= buf.length) throw new Error('truncated varint');
    const b = buf[pos++];
    result += (b & 0x7f) * 2 ** shift;
    if (!(b & 0x80)) return [result, pos];
    shift += 7;
    if (shift > 35) throw new Error('varint too long');
  }
}

/** Decode one protobuf body (without the length prefix). */
export function decodeMessage(body: Buffer): CastMessage {
  const m: CastMessage = { sourceId: '', destinationId: '', namespace: '', data: '' };
  let pos = 0;
  while (pos < body.length) {
    let key: number;
    [key, pos] = readVarint(body, pos);
    const field = key >>> 3;
    const wire = key & 7;
    if (wire === 0) {
      [, pos] = readVarint(body, pos);
    } else if (wire === 2) {
      let len: number;
      [len, pos] = readVarint(body, pos);
      if (pos + len > body.length) throw new Error('truncated field');
      const value = body.subarray(pos, pos + len);
      pos += len;
      if (field === 2) m.sourceId = value.toString('utf8');
      else if (field === 3) m.destinationId = value.toString('utf8');
      else if (field === 4) m.namespace = value.toString('utf8');
      else if (field === 6) m.data = value.toString('utf8');
    } else {
      throw new Error(`unsupported wire type ${wire}`);
    }
  }
  return m;
}

/**
 * Splits a byte stream into messages. Feed it every chunk the socket delivers; it returns the
 * complete messages so far and keeps any partial one for the next chunk.
 */
export class MessageReader {
  private pending: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): CastMessage[] {
    this.pending = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
    const out: CastMessage[] = [];
    while (this.pending.length >= 4) {
      const len = this.pending.readUInt32BE(0);
      if (len > MAX_MESSAGE_BYTES) throw new Error(`cast message too large (${len} bytes)`);
      if (this.pending.length < 4 + len) break;
      out.push(decodeMessage(this.pending.subarray(4, 4 + len)));
      this.pending = this.pending.subarray(4 + len);
    }
    return out;
  }
}

export const NS = {
  connection: 'urn:x-cast:com.google.cast.tp.connection',
  heartbeat: 'urn:x-cast:com.google.cast.tp.heartbeat',
  receiver: 'urn:x-cast:com.google.cast.receiver',
  media: 'urn:x-cast:com.google.cast.media',
} as const;

/** Google's Default Media Receiver: plays a URL with title and artwork, no app registration needed. */
export const DEFAULT_MEDIA_RECEIVER = 'CC1AD845';
