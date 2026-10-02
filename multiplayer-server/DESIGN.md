# DESIGN.md — where netcode hooks into Budgie Escape

Goal of this doc: the exact surgery points for **Milestone 1 — two players
see each other's budgies flying in real time.**

The game is one file: `index.html` (in Muse it's the `budgie-escape`
artifact; the exported copy lives at
`workspace/your_files/budgie-escape/budgie-escape.html`).
Line numbers below are from that exported copy — future edits may shift
them a little, so **search by the symbol names**, which are stable.

Nothing here requires changing the game's physics, collision, or map.
Remote budgies are *visual only* in Milestone 1: you see your friend,
your friend sees you; bumping into each other is a later milestone.

---

## 1. The state we send (already exists — just read it)

| What | Where in the game | Notes |
|---|---|---|
| Bird position | `player.pos` (a THREE.Vector3) on `const player = {...}` (~line 2677) | world units = meters |
| Bird facing | `player.yaw`, `player.pitch`, `player.roll` (same object) | radians |
| Bird mode | `player.state` → `'walk' \| 'air' \| 'perch'`, and `'drive'` while driving | matches the server's `s` field |
| Driving? | `let driving = false` (~line 4297), set true in the enter-car code | when true, send the car's transform instead |
| Car transform | `playerCar.pos`, `playerCar.yaw` — `playerCar` is built by `makeCarObj` (~line 4564) | send as `v` = the current car id (`playerCar.spec.id`) |

**Server message for all of the above** (see `server.js`):

```json
{ "t": "state", "p": [x, y, z], "y": yaw, "pi": pitch, "r": roll,
  "s": "air", "v": null, "spd": 4.2 }
```

## 2. SEND hook — inside the main loop

- Function: `function loop()` (~line 5136), the `G.mode === 'play'` branch,
  *after* the fixed-step simulation runs (`updatePlayer(sdt)` /
  `updateDriving(sdt)`).
- Add a throttle: only send when ~50 ms have passed since the last send
  (20 Hz — the server drops anything faster anyway).
- Read `player.pos` / `playerCar.pos` (whichever is active), build the
  `state` message above, `ws.send(JSON.stringify(msg))`.
- Only send while a WebSocket is open; if it's closed, skip silently
  (single-player must keep working with no server at all).

## 3. RECEIVE + RENDER hook — remote budgie meshes

Important: the local bird is **not** a normal scene object — its body
parts (`beak`, `feet`, `wings`) are children of `camRig`, which is
attached to the `camera` (~line 2695), so you see your own wings/beak
in first person. **Do not reuse that rig for remote players.**

Instead:

1. Keep a `const remotePlayers = new Map()` (server id → record).
2. On `{"t":"roster"}` / `{"t":"join"}`: build a small standalone budgie
   group (body + head + beak + two wing planes is plenty at distance —
   the materials palette `budgieC`, ~line 2696, and the part shapes in
   the `camRig` construction right below it are a good template),
   `scene.add(group)`, and add a floating name label (canvas sprite)
   with the player's gamertag.
3. On `{"t":"state", "id": ...}`: store the target `pos/yaw/pitch/roll`
   and `s` in that player's record. Don't snap the mesh — smooth it:
   in `loop()` (same place as the send hook), `lerp` each remote mesh
   toward its latest target (~15%/frame) so motion looks fluid at 20 Hz.
   Set wing-flap animation when `s === 'air'`; hide the bird mesh and
   show a simple car mesh when `s === 'drive'`.
4. On `{"t":"bye"}`: `scene.remove(group)` and delete the record.

## 4. CONNECT hook — when the player presses Start

- Where: the title → play transition (the code that sets
  `G.mode = 'play'` when Start is pressed).
- Open `new WebSocket(SERVER_URL)` where `SERVER_URL` is
  `ws://localhost:3000` for local testing and
  `wss://<your-host-url>` in production (see README).
- On open: send `{ "t": "hello", "name": <gamertag> }` — use the same
  display name the game already shows for the player.
- On close/error: schedule a reconnect with backoff (2 s, 5 s, 10 s…).
  Free hosts sleep when idle, so the *first* connect can take ~1 minute
  while the server wakes up — show a small "connecting…" note, never
  block the game on it. Reconnecting is safe: the server just treats it
  as a fresh join with a new id.
- All netcode lives in **one new `<script>` block** near the end of the
  file plus the three tiny hooks above (send in `loop()`, mesh update in
  `loop()`, connect on Start). If multiplayer ever needs to come out,
  deleting that block restores today's game exactly.

## 5. Deliberately NOT in Milestone 1

- Car *chases* / police sync, collisions between players, chat, ranks or
  coins over the network, host migration. All later milestones.
- Cheat protection: the server trusts each client's reported position.
  Fine for friends; see README "known limits".
