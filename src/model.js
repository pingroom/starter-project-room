import { createHash } from 'node:crypto';

export class ProjectError extends Error {
  constructor(code, message) { super(message); this.name = 'ProjectError'; this.code = code; }
}
export const fail = (code, message) => { throw new ProjectError(code, message); };
export const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
export const keys = (value, names) => object(value) && Object.keys(value).sort().join(',') === [...names].sort().join(',');
export const uuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
export const hash = (value) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export const palette = ['#ff4245', '#ff9330', '#fed702', '#31d159', '#00dac4', '#3cd3fe', '#00d2e0', '#0391fe', '#6d7cfe', '#da36f1', '#fe365e', '#8e8e93'];

export function project(raw) {
  if (!keys(raw, ['projectId', 'label', 'icon', 'color'])
    || typeof raw.projectId !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(raw.projectId)
    || typeof raw.label !== 'string' || !/^[A-Za-z0-9](?:[A-Za-z0-9 -]{0,9}[A-Za-z0-9])?$/.test(raw.label)
    || typeof raw.icon !== 'string' || !/^[a-z0-9_-]{1,64}$/.test(raw.icon)
    || !palette.includes(raw.color)) fail('invalid_project', 'Use a stable projectId, 1–11 ASCII label characters, catalog icon, and a supported palette color.');
  return { projectId: raw.projectId, label: raw.label, icon: raw.icon, color: raw.color };
}

export function rooms(raw) {
  if (!Array.isArray(raw) || raw.length > 1000 || raw.some((room) => !object(room) || !uuid(room.id) || typeof room.name !== 'string')
    || new Set(raw.map((room) => room.id)).size !== raw.length) fail('invalid_rooms', 'Room list must contain at most 1000 distinct room UUIDs.');
  return raw;
}

export function roomRecord(room, request, ownerId = null) {
  if (!object(room) || !uuid(room.id) || !uuid(room.owner_id)
    || room.type !== 'standard' || room.is_public !== false
    || room.name !== request.name || room.icon !== request.icon || room.color !== request.color
    || typeof room.invite_code !== 'string' || !/^[A-Z0-9]{4,32}$/.test(room.invite_code)
    || !Array.isArray(room.members) || room.members.length !== 1
    || room.members[0]?.user_id !== room.owner_id || room.members[0]?.room_id !== room.id || room.members[0]?.role !== 'owner'
    || (ownerId !== null && room.owner_id !== ownerId)) {
    fail('room_mismatch', 'The room must match the exact plan, be standard/private, and have only its matching owner.');
  }
  return { roomId: room.id, ownerId: room.owner_id, name: room.name, icon: room.icon, color: room.color,
    inviteCode: room.invite_code, inviteUrl: `https://pgr.link/j/${room.invite_code}` };
}

export function planFields(state) {
  return { version: state.version, project: state.project, binding: state.binding, nonce: state.nonce,
    request: state.request, baselineIds: state.baselineIds };
}

export function validateState(raw) {
  if (!keys(raw, ['version', 'project', 'binding', 'nonce', 'request', 'baselineIds', 'planHash', 'status', 'createdAt', 'verifiedAt', 'room'])
    || raw.version !== 1 || !/^[a-f0-9]{64}$/.test(raw.binding ?? '')
    || !/^[a-f0-9]{12}$/.test(raw.nonce ?? '') || !['planned', 'creating', 'created_unverified', 'verified'].includes(raw.status)
    || typeof raw.createdAt !== 'string' || !Number.isFinite(Date.parse(raw.createdAt))) fail('invalid_state', 'Project journal is invalid; preserve it and investigate.');
  const p = project(raw.project);
  const request = { name: `${p.label} ${raw.nonce}`, icon: p.icon, color: p.color };
  if (!keys(raw.request, ['name', 'icon', 'color']) || JSON.stringify(raw.request) !== JSON.stringify(request)
    || !Array.isArray(raw.baselineIds) || raw.baselineIds.length > 1000 || !raw.baselineIds.every(uuid)
    || new Set(raw.baselineIds).size !== raw.baselineIds.length || raw.planHash !== hash(planFields(raw))) fail('invalid_state', 'Project plan no longer matches its journal hash.');
  if (raw.room !== null) {
    if (!keys(raw.room, ['roomId', 'ownerId', 'name', 'icon', 'color', 'inviteCode', 'inviteUrl'])
      || !uuid(raw.room.roomId) || !uuid(raw.room.ownerId) || raw.baselineIds.includes(raw.room.roomId)
      || raw.room.name !== request.name || raw.room.icon !== request.icon || raw.room.color !== request.color
      || !/^[A-Z0-9]{4,32}$/.test(raw.room.inviteCode)
      || raw.room.inviteUrl !== `https://pgr.link/j/${raw.room.inviteCode}`) fail('invalid_state', 'Saved room identity is invalid.');
  }
  if ((raw.status === 'verified' && (typeof raw.verifiedAt !== 'string' || !Number.isFinite(Date.parse(raw.verifiedAt))))
    || (raw.status !== 'verified' && raw.verifiedAt !== null)) fail('invalid_state', 'Verification timestamp does not match the journal state.');
  if ((['planned', 'creating'].includes(raw.status) && raw.room !== null)
    || (['created_unverified', 'verified'].includes(raw.status) && raw.room === null)) fail('invalid_state', 'Project journal state and room disagree.');
  return raw;
}
