# PingRoom project room

Create a private PingRoom room when a new project starts, then save its room UUID and invite link in a local receipt. A reviewed plan and stable project ID keep reruns tied to the same room.

Use this in a project bootstrap script before teammates join. It creates a standard private room owned by the connected human, with PingRoom's default buttons. It does not invite people, send pings, change existing rooms, or delete anything.

## Try it offline

Requires Node.js 22 or newer. Choose **Use this template**, clone your repository, then:

```sh
npm ci
npm run demo
npm test
```

The demo uses the pinned official SDK with an in-memory HTTP transport. It simulates a lost creation response, recovers the existing room, and repeats the command without a second creation request. No credentials or network are used after installation. Tests neither create live rooms nor verify phone delivery.

## Connect and create a room

1. Install [PingRoom](https://pingroom.io/i) and sign in.
2. Run `npm run connect`, open the printed link, and approve **all rooms** access. Use the same link while the command waits. A selected-room grant cannot read a newly created room and is refused by the connection script.
3. Edit `project.json` with a stable project ID and your desired room label, icon, and color.
4. Run `npm run plan` or `npm start`. Review the exact room name, settings, and `planHash`.
5. Create that exact saved plan:

```sh
npm run create -- YOUR_64_CHARACTER_PLAN_HASH
```

A successful creation stores `.projects/<projectId>.json`, including the room UUID, owner UUID, invite code, invite URL, and verification time. Invite links remain in that private file; the command does not print or share them. Share the link yourself when the room is ready.

Run the same plan/create command again to return the **historical local receipt** without another API request. This does not revalidate current access or membership. Teammates can join afterward without breaking these reruns. Keep the receipt even if the room is later renamed or deleted: an old project ID never provisions a replacement automatically.

## Project input

```json
{
  "projectId": "docs-portal",
  "label": "Docs portal",
  "icon": "bell",
  "color": "#0391fe"
}
```

- `projectId`: 1–64 lowercase letters, digits, underscores, or hyphens, starting with a letter or digit. Keep it stable for this project.
- `label`: 1–11 ASCII letters, digits, spaces, or hyphens; start and end with a letter or digit. The actual room name adds a random 12-character hexadecimal suffix, staying within PingRoom's 24-character limit. This suffix distinguishes uncertain creations; leave it intact until the receipt is verified.
- `icon`: a room catalog ID. `plan` checks `rooms.icons()`; `bell` is the sample. Emoji and unknown IDs are refused.
- `color`: one of `#ff4245`, `#ff9330`, `#fed702`, `#31d159`, `#00dac4`, `#3cd3fe`, `#00d2e0`, `#0391fe`, `#6d7cfe`, `#da36f1`, `#fe365e`, `#8e8e93`.

Only these four fields are accepted. Changing the input under an existing project ID is rejected. Review the input before planning; the starter does not edit or discard saved plans.

Creation uses `rooms.create({ name, icon, color })`, the SDK's private-room endpoint. That endpoint prohibits a separate `is_public` field. The starter checks the response and a fresh `rooms.list()` for the exact settings, a standard/private room, and one matching owner. It does not use `rooms.get()`, which marks notifications read.

The credential needs `pingroom:rooms:read`, `pingroom:rooms:write`, and all-rooms access. Server permissions, name filtering, and owned-room plan quotas still apply. The new room initially allows its members to trigger default actions. If the connection has no delivery room, PingRoom may adopt the new room as its delivery room; an existing delivery-room choice stays unchanged. Creation also causes PingRoom's normal silent room refresh on the owner's devices.

## Connection and environment

Pairing saves `.pingroom/credentials.json`. Both that directory and `.projects/` are ignored by Git. Files use `0600` and directories `0700` on POSIX; keep equivalent private access on Windows.

For a secret-store credential, supply **both** `PINGROOM_TOKEN` and `PINGROOM_ROOM_ACCESS=all`. This declaration acknowledges your intended grant; it is not proof of current server permissions. A complete environment pair overrides saved credentials; a blank or partial pair is rejected. Grant changes can still make post-creation verification fail, leaving recovery required.

Optional `.env` loading is automatic; existing shell variables take precedence. Copy `.env.example` to `.env` and keep it private. `PROJECT_FILE` selects the manifest and `PROJECT_STATE_DIR` selects the journal directory; relative paths resolve from this checkout. Rotating the credential changes its journal binding: preserve the old state and use an explicitly migrated or separate directory rather than editing receipts to bypass it.

## Uncertain creation and recovery

Before its single creation request, the starter durably saves `creating`. Any rejected request, timeout, interrupted process, malformed response, or failed post-read leaves an unresolved attempt. A valid creation response saves `created_unverified` with its room identity before the final read. Neither state automatically retries creation.

Inspect matching candidates with a read-only command:

```sh
npm run inspect
```

If the create response supplied a valid room identity, recover with `npm run recover`. If the response was lost, independently confirm the room and owner in PingRoom, then explicitly select both UUIDs from the inspection:

```sh
npm run recover -- ROOM_UUID OWNER_UUID
```

Recovery only reads. It requires exactly one newly visible candidate with the saved random name, icon, color, standard/private type, and a single owner matching the selected UUID. Rooms present before planning cannot be adopted. A known identity or invite code cannot be replaced. The owner selection is the operator's review of a candidate; this starter has no independent API assertion of the bound human's UUID after a lost response.

An empty inspection does not prove creation failed or that a timed-out request cannot finish later. Keep the attempt blocked while investigating. Do not delete the journal, use a new project ID, rename the candidate, or add members merely to bypass recovery. There is no automatic rollback, room deletion, or exactly-once guarantee. Server rejections remain blocked too; investigate the recorded attempt before deliberately starting new work.

## Local operation and adaptation

The journal binds the exact project, credential fingerprint, planned request, and pre-existing room UUIDs. Limits are 100 project records per directory, 1000 rooms per read, 8 KiB manifests, and 128 KiB journals. Invalid UTF-8, duplicate JSON keys, symlinked input files, and malformed state are rejected. The files contain private room metadata and invite credentials; they are not encrypted or tamper-proof.

One command owns `.projects/run.lock`. After a crash, read its `owner.json`, verify that process has stopped, then remove only that lock directory. Preserve all project journals. Use a private local filesystem; atomic replacement is not a distributed database or a guarantee against storage-device failure.

SDK requests have five-second timeouts. Ctrl-C stops after the current request settles; an interrupted creation still needs inspection/recovery. Exit codes are `0` success, `2` unresolved creation, `1` other failures, and `130`/`143` interruption. Remote error bodies and tokens are not printed.

Call `provision()` from `src/provision.js` in your project bootstrap tooling. Keep its two-step plan/create flow and one durable directory. To configure the room's buttons after provisioning, use [room blueprint](https://github.com/pingroom/starter-room-blueprint).

Uses `@pingroom/sdk@0.6.0`, pinned with a lockfile and a 14-day release-age policy. Tests exercise the SDK against mock routes, including lost responses, grant failures, stale configuration, wrong room metadata, duplicate IDs, private state, and replay. CI runs tests and the offline demo on Node 22 and 24.

MIT licensed; see [LICENSE](LICENSE). See the [official SDK](https://github.com/pingroom/sdk) for API details.
