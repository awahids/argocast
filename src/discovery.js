// mDNS discovery of panels advertising "_airgo._tcp.local." (spec §2).
import makeMdns from 'multicast-dns';

export const SERVICE = '_airgo._tcp.local';

/**
 * Browses for panels for `timeoutMs` and resolves with
 * [{ name, host, ip, port, txt }].
 */
export function discover({ timeoutMs = 3000, onFound } = {}) {
  const mdns = makeMdns();
  const found = new Map(); // instance name -> record
  const hosts = new Map(); // host target -> ipv4

  const upsert = (name, patch) => {
    const rec = { name, ...(found.get(name) ?? {}), ...patch };
    if (rec.host && hosts.has(rec.host)) rec.ip = hosts.get(rec.host);
    const wasComplete = isComplete(found.get(name));
    found.set(name, rec);
    if (!wasComplete && isComplete(rec)) onFound?.(rec);
  };

  mdns.on('response', (packet) => {
    const records = [...packet.answers, ...packet.additionals];
    for (const r of records) {
      if (r.type === 'A') {
        hosts.set(r.name, r.data);
        for (const [name, rec] of found) if (rec.host === r.name) upsert(name, { ip: r.data });
      }
    }
    for (const r of records) {
      if (r.type === 'PTR' && r.name === SERVICE) upsert(r.data, {});
      else if (r.type === 'SRV' && r.name.endsWith(SERVICE)) upsert(r.name, { host: r.data.target, port: r.data.port });
      else if (r.type === 'TXT' && r.name.endsWith(SERVICE)) upsert(r.name, { txt: decodeTxt(r.data) });
    }
  });

  mdns.query({ questions: [{ name: SERVICE, type: 'PTR' }] });
  const again = setTimeout(() => mdns.query({ questions: [{ name: SERVICE, type: 'PTR' }] }), timeoutMs / 2);

  return new Promise((resolve) => {
    setTimeout(() => {
      clearTimeout(again);
      mdns.destroy();
      resolve([...found.values()].filter(isComplete));
    }, timeoutMs);
  });
}

function isComplete(rec) {
  return Boolean(rec && rec.ip && rec.port);
}

function decodeTxt(data) {
  const list = Array.isArray(data) ? data : [data];
  const txt = {};
  for (const item of list) {
    const s = Buffer.isBuffer(item) ? item.toString('utf8') : String(item);
    const i = s.indexOf('=');
    if (i > 0) txt[s.slice(0, i)] = s.slice(i + 1);
    else if (s) txt[s] = true;
  }
  return txt;
}
