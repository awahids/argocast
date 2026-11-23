// Persistent sender identity (uuid sent in OPTIONS; panels may remember it).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const FILE = path.join(os.homedir(), '.argocast.json');

export function loadIdentity() {
  try {
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (data.uuid) return data;
  } catch { /* first run */ }
  const data = { uuid: randomUUID() };
  try { fs.writeFileSync(FILE, JSON.stringify(data, null, 2)); } catch { /* read-only home: use ephemeral */ }
  return data;
}
