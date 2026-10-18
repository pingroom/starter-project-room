import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, stat, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { provision } from '../src/provision.js';
import { project, validateState } from '../src/model.js';
import { loadConnection } from '../src/config.js';
import { readJson, atomicJson, withLock } from '../src/storage.js';
import { mockServer, input, roomId, ownerId, makeRoom } from '../src/mock.js';

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'project-room-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const server = mockServer(options);
  const base = { client: server.client, token: 'offline-test-token', roomAccess: 'all', input, directory, nonce: () => 'abcdef123456' };
  return { directory, server, base, run: (extra = {}) => provision({ ...base, ...extra }) };
}

test('plan is read-only; exact create uses SDK route and saves a private invite receipt', async (t) => {
  const f = await fixture(t); const plan = await f.run();
  assert.equal(f.server.creates, 0); assert.equal(plan.request.name.length, 24);
  const result = await f.run({ command: 'create', planHash: plan.planHash });
  assert.equal(result.status, 'verified'); assert.equal(result.room.inviteUrl, 'https://pgr.link/j/DEMO42');
  assert.deepEqual(f.server.calls.filter((c) => c.method === 'POST'), [{ method: 'POST', route: '/api/agent/rooms', body: plan.request }]);
  const path = join(f.directory, 'docs-portal.json');
  assert.equal((await stat(path)).mode & 0o777, 0o600); assert.equal((await stat(f.directory)).mode & 0o777, 0o700);
  assert.ok(!(await readFile(path, 'utf8')).includes('offline-test-token'));
});

test('completed project reruns locally even after teammates join', async (t) => {
  const f = await fixture(t); const p = await f.run(); await f.run({ command: 'create', planHash: p.planHash });
  f.server.rooms[0].members.push({ user_id: '33333333-3333-4333-8333-333333333333', room_id: roomId, role: 'member' });
  const count = f.server.calls.length;
  assert.equal((await f.run()).localOnly, true);
  assert.equal((await f.run({ command: 'create', planHash: p.planHash })).localOnly, true);
  assert.equal(f.server.calls.length, count); assert.equal(f.server.creates, 1);
});

test('lost create response stays blocked and explicit recovery sends no second POST', async (t) => {
  const f = await fixture(t, { failAfterCreate: true }); const p = await f.run();
  await assert.rejects(f.run({ command: 'create', planHash: p.planHash }), { code: 'creation_unresolved' });
  await assert.rejects(f.run({ command: 'create', planHash: p.planHash }), { code: 'creation_unresolved' });
  const observed = await f.run({ command: 'inspect' }); assert.equal(observed.candidates[0].roomId, roomId);
  await assert.rejects(f.run({ command: 'recover' }), { code: 'recovery_identity_required' });
  const recovered = await f.run({ command: 'recover', roomId, ownerId });
  assert.equal(recovered.status, 'verified'); assert.equal(f.server.creates, 1);
});

test('missing read permission after successful create preserves known identity for recovery', async (t) => {
  const f = await fixture(t, { hiddenAfterCreate: true }); const p = await f.run();
  await assert.rejects(f.run({ command: 'create', planHash: p.planHash }), { code: 'creation_unresolved' });
  const state = await readJson(join(f.directory, 'docs-portal.json'), 131072);
  assert.equal(state.status, 'created_unverified'); assert.equal(state.room.roomId, roomId);
  f.server.hiddenAfterCreate = false;
  assert.equal((await f.run({ command: 'recover' })).status, 'verified'); assert.equal(f.server.creates, 1);
});

test('server quota rejection remains a single unresolved attempt', async (t) => {
  const f = await fixture(t, { rejectCreate: true }); const p = await f.run();
  await assert.rejects(f.run({ command: 'create', planHash: p.planHash }), { code: 'creation_unresolved' });
  await assert.rejects(f.run({ command: 'create', planHash: p.planHash }), { code: 'creation_unresolved' });
  assert.equal((await f.run({ command: 'inspect' })).candidates.length, 0); assert.equal(f.server.creates, 1);
});

test('duplicate project ID with changed input or credential is refused', async (t) => {
  const f = await fixture(t); await f.run();
  await assert.rejects(f.run({ input: { ...input, label: 'Other' } }), { code: 'project_conflict' });
  await assert.rejects(f.run({ token: 'another-token' }), { code: 'project_conflict' });
  assert.equal(f.server.creates, 0);
});

test('unreviewed hash never creates', async (t) => {
  const f = await fixture(t); await f.run();
  await assert.rejects(f.run({ command: 'create', planHash: 'bad' }), { code: 'plan_hash_required' }); assert.equal(f.server.creates, 0);
});

test('selected grants fail before any API request', async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.run({ roomAccess: 'selected' }), { code: 'invalid_connection' }); assert.equal(f.server.calls.length, 0);
});

for (const [name, patch] of [['numeric project ID', { projectId: 1 }], ['traversal ID', { projectId: '../secret' }],
  ['too-long label', { label: 'A long project name' }], ['invisible edge', { label: '\u200bProject' }],
  ['noncatalog icon shape', { icon: '🔔' }], ['invisible color', { color: '#ffffff' }], ['unknown field', { is_public: true }]]) {
  test(`invalid manifest: ${name}`, () => assert.throws(() => project({ ...input, ...patch }), { code: 'invalid_project' }));
}

test('icon must exist in the current catalog', async (t) => {
  const f = await fixture(t); f.server.catalog.icons = {};
  await assert.rejects(f.run(), { code: 'invalid_icon' }); assert.equal(f.server.creates, 0);
});

test('new name collision after planning refuses creation', async (t) => {
  const f = await fixture(t); const p = await f.run(); f.server.rooms.push(makeRoom(p.request));
  await assert.rejects(f.run({ command: 'create', planHash: p.planHash }), { code: 'name_collision' }); assert.equal(f.server.creates, 0);
});

for (const [name, patch] of [['public room', { is_public: true }], ['personal room', { type: 'personal' }],
  ['wrong icon', { icon: 'rocket' }], ['missing owner', { members: [] }]]) {
  test(`unexpected create response: ${name}`, async (t) => {
    const f = await fixture(t, { mutateCreated: (r) => ({ ...r, ...patch }) }); const p = await f.run();
    await assert.rejects(f.run({ command: 'create', planHash: p.planHash }), { code: 'creation_unresolved' });
    assert.equal(f.server.creates, 1); assert.equal((await f.run()).status, 'creating');
  });
}

test('recovery rejects a mismatched owner and duplicate matching rooms', async (t) => {
  const f = await fixture(t, { failAfterCreate: true }); const p = await f.run();
  await assert.rejects(f.run({ command: 'create', planHash: p.planHash }));
  await assert.rejects(f.run({ command: 'recover', roomId, ownerId: '33333333-3333-4333-8333-333333333333' }), { code: 'room_mismatch' });
  f.server.rooms.push({ ...f.server.rooms[0], id: '44444444-4444-4444-8444-444444444444' });
  await assert.rejects(f.run({ command: 'recover', roomId, ownerId }), { code: 'recovery_conflict' }); assert.equal(f.server.creates, 1);
});

test('recovery never adopts a room that existed before planning', async (t) => {
  const previous = makeRoom({ name: 'Previous', icon: 'bell', color: '#0391fe' });
  const f = await fixture(t, { initialRooms: [previous], rejectCreate: true }); const p = await f.run();
  await assert.rejects(f.run({ command: 'create', planHash: p.planHash })); f.server.rooms[0].name = p.request.name;
  await assert.rejects(f.run({ command: 'recover', roomId, ownerId }), { code: 'recovery_conflict' });
});

test('recovery refuses invite-code drift of a known created room', async (t) => {
  const f = await fixture(t, { hiddenAfterCreate: true }); const p = await f.run();
  await assert.rejects(f.run({ command: 'create', planHash: p.planHash })); f.server.hiddenAfterCreate = false; f.server.rooms[0].invite_code = 'CHANGED';
  await assert.rejects(f.run({ command: 'recover' }), { code: 'room_drift' }); assert.equal(f.server.creates, 1);
});

test('null, tampered, and duplicate-key journals are rejected without creating', async (t) => {
  const f = await fixture(t); const p = await f.run(); const path = join(f.directory, 'docs-portal.json');
  assert.throws(() => validateState({ ...p, request: { ...p.request, name: 'Tampered' } }), { code: 'invalid_state' });
  await writeFile(path, 'null'); await assert.rejects(f.run(), { code: 'invalid_state' });
  await writeFile(path, '{"a":1,"a":2}'); await assert.rejects(f.run(), { code: 'invalid_json' }); assert.equal(f.server.creates, 0);
});

test('bounded reads refuse oversize, invalid UTF8, and symlink inputs', async (t) => {
  const f = await fixture(t); const path = join(f.directory, 'input.json');
  await writeFile(path, ' '.repeat(101)); await assert.rejects(readJson(path, 100), { code: 'input_limit' });
  await writeFile(path, Buffer.from([0xff])); await assert.rejects(readJson(path, 100), { code: 'invalid_json' });
  await symlink(path, join(f.directory, 'link.json')); await assert.rejects(readJson(join(f.directory, 'link.json'), 100));
});

test('partial and selected environment overrides never borrow saved credentials', async (t) => {
  const f = await fixture(t); await atomicJson(f.directory, 'connection.json', { token: 'saved', roomAccess: 'all' });
  const path = join(f.directory, 'connection.json');
  assert.equal((await loadConnection({}, path)).token, 'saved');
  for (const env of [{ PINGROOM_TOKEN: 'new' }, { PINGROOM_ROOM_ACCESS: 'all' }, { PINGROOM_TOKEN: '', PINGROOM_ROOM_ACCESS: 'all' }, { PINGROOM_TOKEN: 'new', PINGROOM_ROOM_ACCESS: 'selected' }]) {
    await assert.rejects(loadConnection(env, path), { code: 'invalid_connection' });
  }
  assert.equal((await loadConnection({ PINGROOM_TOKEN: 'new', PINGROOM_ROOM_ACCESS: 'all' }, path)).token, 'new');
});

test('exclusive lock blocks concurrent commands', async (t) => {
  const f = await fixture(t);
  await withLock(f.directory, async () => { await assert.rejects(f.run(), { code: 'locked' }); }); assert.equal(f.server.calls.length, 0);
});

test('aborted request makes no room and malformed room listings fail closed', async (t) => {
  const f = await fixture(t); const abort = new AbortController(); abort.abort();
  await assert.rejects(f.run({ signal: abort.signal })); assert.equal(f.server.calls.length, 0);
  f.server.rooms = [{ id: 'bad', name: 'Bad' }]; await assert.rejects(f.run(), { code: 'invalid_rooms' }); assert.equal(f.server.creates, 0);
});

test('state directory limit refuses further reservations', async (t) => {
  const f = await fixture(t);
  for (let n = 0; n < 100; n++) await writeFile(join(f.directory, `${n}.json`), '{}');
  await assert.rejects(f.run(), { code: 'state_limit' }); assert.equal(f.server.calls.length, 0);
});
