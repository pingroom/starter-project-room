import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { readdir } from 'node:fs/promises';
import { atomicJson, readJson, withLock } from './storage.js';
import { fail, hash, project, rooms, roomRecord, planFields, validateState, uuid, object } from './model.js';

export async function provision({ client, token, roomAccess, input, directory, command = 'plan', planHash, roomId, ownerId, signal,
  nonce = () => randomBytes(6).toString('hex'), now = () => new Date().toISOString() }) {
  const p = project(input);
  if (roomAccess !== 'all' || typeof token !== 'string' || !/^[\x21-\x7e]{1,8192}$/.test(token)) {
    fail('invalid_connection', 'Use an all-rooms connection; the declaration does not override server permissions.');
  }
  if (!['plan', 'create', 'inspect', 'recover'].includes(command)) fail('invalid_command', 'Unknown command.');
  const binding = hash(`project-room-v1:${token}`);
  const filename = `${p.projectId}.json`;
  const checkAbort = () => signal?.throwIfAborted();
  return withLock(directory, async () => {
    let state;
    try { state = validateState(await readJson(join(directory, filename), 128 * 1024)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (state && (JSON.stringify(state.project) !== JSON.stringify(p) || state.binding !== binding)) {
      fail('project_conflict', 'Project ID is already bound to different input or credential. Preserve its journal.');
    }
    const save = async () => { validateState(state); await atomicJson(directory, filename, state); };
    const listing = async () => { checkAbort(); const result = rooms(await client.rooms.list()); checkAbort(); return result; };
    if (command === 'plan') {
      if (state) return { ...state, localOnly: true };
      const files = await readdir(directory);
      if (files.filter((file) => file.endsWith('.json')).length >= 100) fail('state_limit', 'The project directory already holds 100 journals.');
      const before = await listing();
      checkAbort();
      const catalog = await client.rooms.icons();
      checkAbort();
      if (!object(catalog?.icons) || !Object.hasOwn(catalog.icons, p.icon)) fail('invalid_icon', 'The selected icon is absent from the current room catalog.');
      state = { version: 1, project: p, binding, nonce: nonce(), request: null,
        baselineIds: before.map((room) => room.id).sort(), planHash: '', status: 'planned', createdAt: now(), verifiedAt: null, room: null };
      state.request = { name: `${p.label} ${state.nonce}`, icon: p.icon, color: p.color };
      if (before.some((room) => room.name === state.request.name)) fail('name_collision', 'Generated name already exists. No plan or room was created.');
      state.planHash = hash(planFields(state));
      await save();
      return state;
    }
    if (!state) fail('missing_plan', 'Run npm run plan first.');
    if (command === 'inspect') {
      const current = await listing();
      return { status: state.status, planHash: state.planHash, request: state.request,
        candidates: current.filter((room) => room.name === state.request.name && !state.baselineIds.includes(room.id))
          .map((room) => ({ roomId: room.id, ownerId: room.owner_id, name: room.name, type: room.type, isPublic: room.is_public })) };
    }
    if (command === 'recover') {
      if (state.status === 'planned') fail('not_attempted', 'This plan has not attempted creation.');
      const targetId = roomId ?? state.room?.roomId;
      const expectedOwner = ownerId ?? state.room?.ownerId;
      if (!uuid(targetId) || !uuid(expectedOwner)) fail('recovery_identity_required', 'Review the candidate, then supply both room UUID and owner UUID.');
      if (state.room && (targetId !== state.room.roomId || expectedOwner !== state.room.ownerId)) fail('identity_conflict', 'Recovery cannot replace a saved room identity.');
      const current = await listing();
      const matches = current.filter((room) => room.name === state.request.name && !state.baselineIds.includes(room.id));
      if (matches.length !== 1 || matches[0].id !== targetId) fail('recovery_conflict', 'No unique matching new room is visible. Preserve the unresolved attempt.');
      const record = roomRecord(matches[0], state.request, expectedOwner);
      if (state.room && JSON.stringify(record) !== JSON.stringify(state.room)) fail('room_drift', 'Saved room identity or invite code changed.');
      state.room = record; state.status = 'verified'; state.verifiedAt = now(); await save();
      return state;
    }
    if (!state) fail('missing_plan', 'Run npm run plan first.');
    if (planHash !== state.planHash) fail('plan_hash_required', 'Supply the exact reviewed plan hash.');
    if (state.status === 'verified') return { ...state, localOnly: true };
    if (state.status !== 'planned') fail('creation_unresolved', 'A creation was already attempted. Inspect and recover; do not create again.');
    const before = await listing();
    if (before.some((room) => room.name === state.request.name)) fail('name_collision', 'The planned name is already visible. Nothing was created.');
    checkAbort();
    // A durable transition precedes the only POST. Recovery never resends it.
    state.status = 'creating'; await save(); checkAbort();
    try {
      const created = await client.rooms.create(state.request);
      const record = roomRecord(created, state.request);
      if (state.baselineIds.includes(record.roomId)) fail('room_mismatch', 'Creation returned a pre-existing room identity.');
      state.room = record; state.status = 'created_unverified'; await save();
      const current = await listing();
      const matches = current.filter((room) => room.name === state.request.name && !state.baselineIds.includes(room.id));
      if (matches.length !== 1 || matches[0].id !== record.roomId) fail('room_mismatch', 'The created room is not uniquely visible in the current grant.');
      const verified = roomRecord(matches[0], state.request, record.ownerId);
      if (JSON.stringify(verified) !== JSON.stringify(record)) fail('room_drift', 'Created room metadata changed before verification.');
      state.status = 'verified'; state.verifiedAt = now(); await save();
      return state;
    } catch {
      fail('creation_unresolved', 'Creation outcome is unresolved. Inspect and recover the saved attempt; no automatic retry is allowed.');
    }
  });
}
