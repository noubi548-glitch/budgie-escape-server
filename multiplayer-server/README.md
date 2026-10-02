# Budgie Escape — Multiplayer Server (Prototype)

## What is this thing?

Think of your game as houses and this server as the **telephone exchange**.

Right now, every player's copy of Budgie Escape is a house with no phone
line. This server is the exchange in the middle: when it's running, game
copies can call it, and it passes around one simple message over and over:

> "I'm NobleVR, and my budgie is *right here*, facing *this way*."

Everybody connected hears everybody else's messages, so every game can
draw everyone else's budgie in the right place. That's all multiplayer
really is at the start.

**One honest warning before anything else:** the server by itself does
NOT make the game on itch.io multiplayer. The game still needs its
"netcode" — the part inside the game that calls the server and draws
your friends. That job is written out step-by-step in `DESIGN.md`
(that's "Milestone 1"). This folder gets you the working server half,
tested and ready.

## Try it on your own computer first

You need [Node.js](https://nodejs.org) installed (free). Then, in this
folder:

```
node server.js
```

That's it — no install step, no settings. Open
`http://localhost:3000` in a browser and you'll see a little status page
telling you how many players are connected (0, until a game with
netcode calls it). Press `Ctrl+C` to stop it.

## Putting it on the internet for free (Render)

Friends can't reach `localhost` — that's just your own machine. The
server needs a home on the internet. **Render** is the easiest free one:

1. Put this folder in a **GitHub** repo (github.com → New repository →
   upload the files: `server.js`, `package.json`, this README).
2. Go to **render.com**, sign up (free), click **New + → Web Service**,
   and connect your GitHub repo.
3. Settings Render asks for:
   - **Runtime:** Node
   - **Build Command:** leave it as `npm install` (there's nothing to
     install — this server uses zero add-ons — so it finishes instantly)
   - **Start Command:** `node server.js`
   - **Plan:** Free
4. Click **Create**. In a minute or two Render gives you your server's
   public address, which looks like:

   ```
   https://budgie-escape-mp.onrender.com
   ```

5. **That's the address friends connect to** — except games use the
   secure WebSocket version of it, which is the same address starting
   with `wss://` instead of `https://`:

   ```
   wss://budgie-escape-mp.onrender.com
   ```

   That `wss://` address is what goes into the game's netcode
   (see `DESIGN.md`, section 4).

Other hosts exist — **Railway** and **Fly.io** — but as of now they've
switched to trial credit / pay-as-you-go instead of a forever-free plan.
Render's free plan is the one that stays $0, which is why it's the pick.

## The known limits (read this part — no surprises later)

- **The server falls asleep.** On Render's free plan, if nobody connects
  for ~15 minutes, the server naps. The next friend who joins waits
  **30–60 seconds** while it wakes up, then everything works. The game
  should show "connecting…" during that wait instead of looking broken.
- **No cheat protection.** The server believes whatever a player's game
  tells it. A cheater could tell it "I'm on the moon" and everyone
  would see their budgie on the moon. For playing with friends, fine.
  For strangers, that's a later problem to solve.
- **Gamertags are just names.** There's no account or password system —
  anyone can type any name. (Your in-game rank codes keep working
  exactly like they do now, on each player's own copy.)
- **Small scale.** Max 50 players at once, which is way more than a
  free server can feed anyway.
- **Restarts reset the room.** If the server restarts (Render does this
  sometimes), everyone just reconnects and rejoins — nothing is saved
  on the server, on purpose.
- **Logs.** The server prints who joined/left (gamertag + time) in the
  host's log screen. That's normal for servers. Don't paste your real
  name, address, or other personal info into your gamertag — here or
  anywhere online.

## What's in this folder

| File | What it is |
|---|---|
| `server.js` | The whole server. One file, no add-ons. |
| `package.json` | Just tells hosts "this is a Node app, start it with `node server.js`." |
| `DESIGN.md` | The plan for adding netcode inside the game itself (Milestone 1). |
| `README.md` | This file. |

## How it works, in one breath

A game connects → says hello with a gamertag → the server gives it an
ID and introduces it to everyone → 20 times a second, each game reports
where its budgie is and the server repeats it to everyone else → when
someone leaves, the server tells everyone to remove that budgie.
Simple on purpose. Fancy comes later.
