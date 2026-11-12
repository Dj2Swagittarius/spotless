import tls from 'tls';
import { it } from 'vitest';
import { discover } from '../mdns';
import { encodeMessage, MessageReader, NS } from '../protocol';

it('live: discover and read receiver status', async () => {
  const found = await discover(3000);
  process.stdout.write('FOUND ' + JSON.stringify(found) + '\n');
  for (const c of found.slice(0, 3)) {
    const status = await new Promise<string>((resolve) => {
      const s = tls.connect({ host: c.host, port: c.port, rejectUnauthorized: false });
      const r = new MessageReader();
      const t = setTimeout(() => { s.destroy(); resolve('timeout'); }, 4000);
      s.on('error', (e) => { clearTimeout(t); resolve('error ' + e.message); });
      s.on('data', (d) => {
        for (const m of r.push(d)) {
          if (m.namespace === NS.receiver) { clearTimeout(t); s.destroy(); resolve(m.data); }
        }
      });
      s.once('secureConnect', () => {
        s.write(encodeMessage({ sourceId: 'sender-x', destinationId: 'receiver-0', namespace: NS.connection, data: '{"type":"CONNECT"}' }));
        s.write(encodeMessage({ sourceId: 'sender-x', destinationId: 'receiver-0', namespace: NS.receiver, data: '{"type":"GET_STATUS","requestId":1}' }));
      });
    });
    process.stdout.write('STATUS ' + c.name + ' ' + status.slice(0, 500) + '\n');
  }
}, 20000);
