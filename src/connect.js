import { PingRoom } from '@pingroom/sdk';
import { dirname } from 'node:path';
import { API_URL, credentialsPath } from './config.js';
import { atomicJson, privateDirectory } from './storage.js';
const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
process.once('SIGTERM', () => controller.abort());
try {
  if (process.argv.length !== 2) throw new Error('No arguments accepted.');
  console.log('Install or open PingRoom: https://pingroom.io/i');
  console.log('Approve this project-room connection with access to all rooms. Selected-room grants cannot read rooms created later.');
  const client = new PingRoom({ baseUrl: API_URL, timeoutMs: 10_000 });
  const pairing = await client.auth.startPairing({ agent_label: 'Project room provisioning' });
  console.log(`Approve the connection: ${pairing.pair_browser_url ?? pairing.pair_url}`);
  const active = await client.auth.waitForPairing(pairing, { signal: controller.signal });
  controller.signal.throwIfAborted();
  if (active.room_access !== 'all') throw new Error('All-rooms grant required.');
  await privateDirectory(dirname(credentialsPath));
  await atomicJson(dirname(credentialsPath), 'credentials.json', { token: active.credential, roomAccess: 'all' });
  console.log('Connection saved privately. Edit project.json, then run npm run plan.');
} catch {
  console.error('Connection did not complete. Approve an all-rooms grant; a selected-room grant is not supported.');
  process.exitCode = 1;
}
