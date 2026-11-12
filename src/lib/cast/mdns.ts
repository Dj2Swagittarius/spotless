import dgram from 'dgram';
import os from 'os';

/**
 * Finding Chromecasts on the LAN: one mDNS question for `_googlecast._tcp.local`, sent from an
 * ephemeral port so receivers answer by unicast straight back to us (RFC 6762 section 6.7). That
 * avoids binding port 5353, which avahi or another responder on the host usually holds.
 *
 * Multicast does not cross Docker's default bridge network: a container on it finds nothing here,
 * which is why Chromecasts can also be added by address in Settings.
 */

export interface FoundCast {
  /** the receiver's stable id (TXT `id`), or its address when it has none */
  id: string;
  name: string;
  model: string;
  host: string;
  port: number;
}

const SERVICE = '_googlecast._tcp.local';
const MDNS_ADDR = '224.0.0.251';
const MDNS_PORT = 5353;
const TYPE_A = 1;
const TYPE_PTR = 12;
const TYPE_TXT = 16;
const TYPE_SRV = 33;

/** The DNS query packet: one PTR question for the cast service, unicast response requested. */
export function buildQuery(): Buffer {
  const header = Buffer.alloc(12); // id 0, flags 0, qdcount 1
  header.writeUInt16BE(1, 4);
  const labels = SERVICE.split('.').map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l, 'ascii')]));
  const tail = Buffer.alloc(4);
  tail.writeUInt16BE(TYPE_PTR, 0);
  tail.writeUInt16BE(0x8001, 2); // class IN with the "QU" (unicast response) bit
  return Buffer.concat([header, ...labels, Buffer.from([0]), tail]);
}

function readName(buf: Buffer, start: number): [string, number] {
  const labels: string[] = [];
  let pos = start;
  let end = -1; // where reading resumes after the first compression pointer
  for (let hops = 0; hops < 32; hops++) {
    if (pos >= buf.length) throw new Error('name out of bounds');
    const len = buf[pos];
    if (len === 0) {
      return [labels.join('.'), end >= 0 ? end : pos + 1];
    }
    if ((len & 0xc0) === 0xc0) {
      if (pos + 1 >= buf.length) throw new Error('pointer out of bounds');
      if (end < 0) end = pos + 2;
      pos = ((len & 0x3f) << 8) | buf[pos + 1];
      continue;
    }
    if (pos + 1 + len > buf.length) throw new Error('label out of bounds');
    labels.push(buf.toString('utf8', pos + 1, pos + 1 + len));
    pos += 1 + len;
  }
  throw new Error('name compression loop');
}

interface RR {
  name: string;
  type: number;
  data: Buffer;
  /** offset of `data` in the packet, for names inside it that point back into the packet */
  offset: number;
}

function parseRecords(buf: Buffer): RR[] {
  if (buf.length < 12) return [];
  const qd = buf.readUInt16BE(4);
  const total = buf.readUInt16BE(6) + buf.readUInt16BE(8) + buf.readUInt16BE(10);
  let pos = 12;
  for (let i = 0; i < qd; i++) {
    [, pos] = readName(buf, pos);
    pos += 4;
  }
  const out: RR[] = [];
  for (let i = 0; i < total && pos < buf.length; i++) {
    let name: string;
    [name, pos] = readName(buf, pos);
    if (pos + 10 > buf.length) break;
    const type = buf.readUInt16BE(pos);
    const len = buf.readUInt16BE(pos + 8);
    pos += 10;
    if (pos + len > buf.length) break;
    out.push({ name: name.toLowerCase(), type, data: buf.subarray(pos, pos + len), offset: pos });
    pos += len;
  }
  return out;
}

function parseTxt(data: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let pos = 0;
  while (pos < data.length) {
    const len = data[pos];
    const entry = data.toString('utf8', pos + 1, pos + 1 + len);
    pos += 1 + len;
    const eq = entry.indexOf('=');
    if (eq > 0) out[entry.slice(0, eq).toLowerCase()] = entry.slice(eq + 1);
  }
  return out;
}

/** Cast receivers described by one mDNS response packet (usually one, all records together). */
export function parseResponse(buf: Buffer, from: string): FoundCast[] {
  let records: RR[];
  try {
    records = parseRecords(buf);
  } catch {
    return [];
  }
  const instances = new Set<string>();
  for (const r of records) {
    if (r.type === TYPE_PTR && r.name === SERVICE) {
      try {
        instances.add(readName(buf, r.offset)[0].toLowerCase());
      } catch {
        // malformed pointer target: skip this one
      }
    }
  }
  const found: FoundCast[] = [];
  for (const inst of instances) {
    const txtRec = records.find((r) => r.type === TYPE_TXT && r.name === inst);
    const srv = records.find((r) => r.type === TYPE_SRV && r.name === inst);
    const txt = txtRec ? parseTxt(txtRec.data) : {};
    let port = 8009;
    let host = from;
    if (srv && srv.data.length >= 7) {
      port = srv.data.readUInt16BE(4);
      try {
        const target = readName(buf, srv.offset + 6)[0].toLowerCase();
        const a = records.find((r) => r.type === TYPE_A && r.name === target && r.data.length === 4);
        if (a) host = [...a.data].join('.');
      } catch {
        // keep the sender's address
      }
    }
    // Groups of speakers ("cast groups") answer too, on their leader's address with another port.
    const name = txt.fn || inst.replace(`.${SERVICE}`, '');
    found.push({ id: (txt.id || `${host}:${port}`).toLowerCase(), name, model: txt.md ?? '', host, port });
  }
  return found;
}

/** IPv4 addresses of this machine's network interfaces, loopback excluded. */
function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

/** Ask once on one interface (`iface` undefined: the system default) and collect the answers. */
function askOn(iface: string | undefined, timeoutMs: number, found: Map<string, FoundCast>): Promise<void> {
  return new Promise((resolve) => {
    let socket: dgram.Socket;
    try {
      socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    } catch {
      resolve();
      return;
    }
    const done = () => {
      try {
        socket.close();
      } catch {
        // already closed
      }
      resolve();
    };
    socket.on('error', done);
    socket.on('message', (msg, rinfo) => {
      for (const c of parseResponse(msg, rinfo.address)) found.set(c.id, c);
    });
    socket.bind(0, () => {
      try {
        socket.setMulticastTTL(255);
        if (iface) socket.setMulticastInterface(iface);
      } catch {
        // not fatal: the defaults reach the LAN on a single-homed machine
      }
      const q = buildQuery();
      const ask = () => {
        try {
          socket.send(q, MDNS_PORT, MDNS_ADDR, () => {});
        } catch {
          // socket already closed (no network, or the timeout won the race)
        }
      };
      ask();
      // a second ask a moment later catches receivers that were busy the first time
      setTimeout(ask, 800).unref?.();
      setTimeout(done, timeoutMs).unref?.();
    });
  });
}

/**
 * Ask the LAN for cast receivers and collect the answers that arrive within `timeoutMs`. The
 * question goes out on every interface: on a machine with a VPN, WSL or Docker adapter the system
 * default for multicast is often not the LAN.
 */
export async function discover(timeoutMs = 2500): Promise<FoundCast[]> {
  const found = new Map<string, FoundCast>();
  const ifaces = lanAddresses();
  await Promise.all((ifaces.length ? ifaces : [undefined]).map((a) => askOn(a, timeoutMs, found)));
  return [...found.values()];
}
