import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { provision } from './provision.js';
import { mockServer, input, roomId, ownerId } from './mock.js';
const directory = await mkdtemp(join(tmpdir(), 'pingroom-project-demo-'));
try {
  const server = mockServer({ failAfterCreate: true });
  const base = { client: server.client, token: 'offline-test-token', roomAccess: 'all', input, directory };
  const plan = await provision(base);
  console.log(`Preview: create private room ${plan.request.name}.`);
  await assert.rejects(provision({ ...base, command: 'create', planHash: plan.planHash }), { code: 'creation_unresolved' });
  console.log('Simulated response loss: the creation attempt stays blocked.');
  const found = await provision({ ...base, command: 'inspect' });
  assert.equal(found.candidates.length, 1);
  const recovered = await provision({ ...base, command: 'recover', roomId, ownerId });
  const repeat = await provision({ ...base, command: 'create', planHash: plan.planHash });
  assert.equal(recovered.status, 'verified'); assert.equal(repeat.localOnly, true); assert.equal(server.creates, 1);
  console.log('Recovered the reviewed room UUID and owner; replay used its local receipt.');
  console.log('One mocked create request. No credentials, network requests, live rooms, or pings.');
} finally { await rm(directory, { recursive: true, force: true }); }
