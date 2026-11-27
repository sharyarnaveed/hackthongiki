# TheSpace — a cozy pixel-art virtual office

Teams get a shared pixel-art office to walk around in. You sign up, create or join a workspace, pick an avatar, and step into an office that is generated from your answers and saved, so every desk and plant stays in the same place.

- **Frontend:** Next.js 16, React 19, Tailwind 4, Phaser 4 (the office game), Framer Motion (`frontend/`)
- **Backend:** Fastify 5, MongoDB via Mongoose, Nodemailer for emails (`backend/`)

The office generator is plain TypeScript in `frontend/components/office/game/`. The backend imports the same code (through the `@/` alias), so the server builds and stores exactly the office the client draws.

---

## Running it locally

```bash
# backend (http://localhost:4000)
cd backend
npm install
npm run dev

# backend tests (uses MONGODB from .env, cleans up after itself)
cd backend
npm test

# frontend (http://localhost:3000)
cd frontend
npm install
npm run dev

# frontend tests (Vitest + Testing Library, no server needed)
cd frontend
npm test
```

`backend/.env`:

| Variable | What it's for |
|---|---|
| `MONGODB` | MongoDB connection string (required) |
| `DB_NAME` | Database name (default `pixelart_office`) |
| `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASS`, `EMAIL_FROM` | SMTP for verification and invitation emails |
| `CLIENT_URL` | Frontend URL used in email links |
| `CLIENT_ORIGIN` | Allowed CORS origins, comma-separated (default: any localhost port) |
| `PORT` | API port (default `4000`) |
| `LOG_LEVEL` | Log level (default `info`; `debug`, `warn`, `silent`…) |
| `LOG_REQUESTS` | `off` hides the one-line access log for each request |

`backend/.env.example` lists every backend setting with a comment (copy it to `backend/.env`). `CLIENT_ORIGIN` accepts `*` for any subdomain, e.g. `https://*.ngrok-free.app`.

`frontend/main.env` (copy `frontend/main.env.example`; read by `next.config.ts`):

| Variable | What it's for |
|---|---|
| `API_INTERNAL_URL` | Where the frontend forwards `/api` — REST and the live WebSocket (default `http://127.0.0.1:4000`) |
| `NEXT_PUBLIC_API_URL` | Where the browser calls the API. Empty = automatic: `http://localhost:4000` on localhost, the page's own address (`/api`) through ngrok. Set it only for an API on its own public domain |
| `NEXT_PUBLIC_STUN_URLS` | STUN servers for direct voice/video (default Google's public one); `off` = everything through the API relay |
| `DEV_ORIGINS` | Extra hosts allowed to open the dev site (ngrok hosts already are) |

### Open the office on another device (ngrok)

Only the frontend is tunnelled; it forwards `/api` (and the live WebSocket) to your backend, so cookies, the live office and the mic/camera (HTTPS) all work on one address.

```bash
cd backend && npm run dev      # the API on :4000
cd frontend && npm run dev     # the site on :3000
ngrok http 3000                # open the https://… link on the other device
```

Set `CLIENT_URL` in `backend/.env` to the ngrok link if you want email links to point there.

### Voice & video: direct first, relay as a fallback (no TURN)

- **Direct (lowest latency, ~50–100 ms):** each pair of browsers first tries a WebRTC connection, signalled over the live socket, using a public STUN server to find each other. Calls get real video, and the browser's echo cancellation works fully.
- **Relay (works anywhere):** if a pair hasn't connected directly within 6 s (strict firewalls, some VPNs and mobile networks), its media goes over the live WebSocket instead and the API passes it on. No TURN server needed. Voice: 16 kHz µ-law in 20 ms frames, sent only while you talk, played through a 60 ms jitter buffer. Video: 320×180 JPEG snapshots, 8 a second. A failed pair tries direct again after 45 s.
- Each browser tells the API which teammates it reaches directly (`direct`), so the API doesn't also relay to them and nobody hears double.
- Browsers only allow the mic and camera on HTTPS (or `localhost`). Headphones avoid echo.

---

## What we have done

### Accounts & auth
- [x] Sign up with name, email, date of birth and password (passwords hashed)
- [x] Email verification with a 6-digit code (stored hashed, expires, limited attempts, resend cooldown)
- [x] Sign in / sign out with an HttpOnly session cookie ("remember me" = 30 days)
- [x] Sessions stored hashed in MongoDB, removed automatically when they expire (TTL index)
- [x] Rate limit on sign-in attempts
- [x] `GET /api/auth/me` returns the signed-in user and their settings
- [x] Last sign-in time saved

### Onboarding
- [x] Choose a path: create a workspace or join one
- [x] Create flow: name tag → office name/description → purpose → style → floor plan + furniture → avatar → invite → review
- [x] Join flow: invitation code → name tag/avatar → confirm
- [x] Workspace saved to MongoDB; the creator becomes the owner
- [x] Unique 8-character invitation code (unambiguous letters, CSPRNG), rate-limited checks
- [x] Invitation emails sent to teammates, with sent status tracked per invitation
- [x] Joining is idempotent (double clicks never add you twice), and the invitation for your email is used up when you join

### The office
- [x] 6 floor plans (Classic, Open plan, Loft, Home, Study house, Garden café) × 4 styles × 5 team sizes
- [x] 16 furniture groups you can tick on or off
- [x] Office generated **on the server** and stored, so it looks the same on every visit and device
- [x] Walk around, rooms, minimap, lighting, interactions (coffee, sofa break, record player, office cat…)
- [x] Owner can change the floor plan and team size; the office is regenerated and saved for everyone
- [x] Desk nameplates show the real members from the database

### Saved in the database
- [x] **Settings** (music, minimap, name tag) saved on the account, with defaults `sound: off, minimap: on, nameTag: on`
- [x] **Status** (Available / Focusing / On a break) saved per workspace, with the time it changed
- [x] **Desk assignment**: each member keeps one desk; the owner gets desk 1, people who join get the next free one, and desks are re-checked when the plan changes
- [x] **Last seen**: when each member last opened the office
- [x] **Waitlist**: the landing page's early-access form saves emails (no duplicates, rate-limited)
- [x] On startup, older users and members get the default settings and status

### Dashboard
- [x] List of your workspaces
- [x] Owner: rename or edit the description, delete the workspace
- [x] Member: leave the workspace
- [x] **Members** dialog on each card (the same team panel as in the office)

### Team & members
- [x] Roles: **owner** (everything), **admin** (invite code, invitations, desks, removing members), **member**
- [x] Members panel in the office (👥 button) and on the dashboard: avatar, role, desk, status, last seen
- [x] Settings screen in the office to change your name tag and avatar
- [x] Owner/admin: show and copy the invitation code, make a new one (the old one stops working), turn it off/on, set an expiry (never, 1, 7 or 30 days)
- [x] Owner/admin: invite more people after onboarding (existing members and pending invites are skipped), resend (1-minute cooldown) or cancel invitations
- [x] Owner: make someone admin or member, transfer ownership (the old owner becomes an admin); owner/admin: remove members (admins can only remove plain members)
- [x] Owner: change the office style and furniture after creation (the office is rebuilt and saved for everyone)
- [x] Members choose a desk: walk up to an open desk and press E, or pick one in the members panel; owners/admins can move anyone and swap two people's desks (safe against two people grabbing the same desk at once)
- [x] **Desk swap requests**: members ask a teammate for their desk from the members panel; the teammate accepts (desks are swapped atomically) or declines, and the asker can cancel. One open request per pair, at most 3 waiting per person. A request is dropped if either person moves or leaves, or the office is rebuilt
- [x] **Emails** to members who are removed and to the new owner after a transfer (a failed email is logged and never undoes the change)
- [x] The player's last position is saved (every 15 s when moved, when the tab is hidden or closed) and you start there next time; positions reset when the office is rebuilt
- [x] The office reopens clean (no panel left open) when you come back from the dashboard

### Office life
- [x] **Notice board** (`notices` collection): walk up to the board and press E, or use the 📝 button. Everyone reads it; the owner pins new notes (up to 280 characters, four colours), edits them, pins them to the top and takes them down. At most 30 notes per board; the board is deleted with the workspace
- [x] **Office stats** (📊 button, or from the Workspace panel): coffees made, cat pets and focus time for the whole office, for you and for each teammate
  - Making a coffee or petting the cat counts it on the server and the toast says the new total ("the office's 12th cup"); repeats within 4 seconds count once
  - Focus time is counted by the server when you leave **Focusing** (at most 4 hours per session, so a forgotten tab doesn't count all night); a session still running shows up in the stats too
- [x] **Move furniture** (owner): Settings → *Arrange furniture*. Click a piece to pick it up, click again to put it down (it turns green or red as you move it), Esc puts it back; drag the floor or use WASD / arrows to look around. Desks take their chair with them. *Save layout* saves it for everyone; *Cancel* puts everything back
  - Pieces must stay inside the walls, off other furniture and off the entrance, and can't box off anything you can use; the server checks the same rules (shared code in `game/layoutEdit.ts`)
  - Every move says where the piece was, and saves are versioned, so a tab with an older layout can't scramble the office. Changing the floor plan, style or furniture rebuilds the office as before

### Real-time (multiplayer)
- [x] **Live office socket** (`GET /api/workspaces/:id/live`, `@fastify/websocket`): signed in with the session cookie, and the page's Origin must be our frontend (CORS doesn't cover sockets). One connection per member: opening the office in a second tab takes over ("Use this tab" brings it back). Reconnects with backoff when the network drops; dead sockets are dropped by a 25 s ping
- [x] **Presence**: teammates' avatars walk around your office in real time (their own avatar, animation, facing, sitting at desks/sofas), with name tags, status dots and markers on the minimap. The HUD shows how many people are here; *People* in the chat lists everyone with their status and room. The members panel says who is "in the office now", and last seen is saved when someone leaves
- [x] Status, name tag and avatar changes show up for everyone straight away; when the owner rebuilds the office or moves furniture, everyone else's office reloads with it
- [x] **Proximity chat**: the *Nearby* tab says things out loud; only people within 6 tiles get it, as a speech bubble over your avatar (not saved)
- [x] **Proximity voice** (🎤 button): with your mic on you hear teammates who also have it on when you walk up to them, louder the closer you are; walk away and it fades out. Direct WebRTC between browsers, or relayed by the API when that's blocked (see *Voice & video*); the 🎤 badge shows how many people you're hearing
- [x] **Works behind strict firewalls** without a TURN server: pairs that can't connect directly fall back to the API relaying their media over the same WebSocket
- [x] **Video calls** in the meeting room and call/phone booths: walk up to the table or booth, press E and *Start / Join the video call*. Everyone in that room's call hears and sees everyone (up to 8), with mute, camera off and leave; no camera joins with sound only. Walking out of the room hangs up
- [x] **Workspace chat** (`messages` collection): an *Office* channel for everyone and one channel per room of the office (the tab follows the room you're standing in). History loads 50 at a time; new messages arrive live, with an unread badge on 💬. Press Enter to open the chat; typing pauses your avatar. Up to 500 characters, 10 messages per 10 s; deleted with the workspace
- [x] Rate limits on the socket too (moves, speech, voice and video frames), and moves are checked against the office's size
- [x] Protocol shared by both sides in `frontend/components/office/live/protocol.ts`

### No mock data
- [x] Removed the demo office, guest user and the `/office-preview` page
- [x] The office only loads from the server; with no workspace you're sent to onboarding, and with no session you're sent to sign-in
- [x] Removed plan previews and onboarding answers kept only in the browser tab
- [x] Removed "Continue in demo mode" when an invitation code can't be checked
- [x] Removed placeholder copy ("needs the backend", fake "3 teammates online" status)

### Server logs
- [x] Readable, colored logs in development (pino-pretty), JSON in production
- [x] One access line per request: method, path, status, time and user (`LOG_REQUESTS=off` to hide); 4xx/slow requests as warnings, 5xx as errors
- [x] MongoDB connect / disconnect / reconnect, startup summary and clean shutdown on Ctrl+C
- [x] Every new action is logged: invite code viewed/regenerated/revoked, invitations added/sent/resent/cancelled, roles, transfers, removals, desk moves and swaps, saved positions, office rebuilds (with what changed)
- [x] One log line for each write: sign-up, sign-in, workspace saved, office generated or served, plan changed, member joined, desks assigned, status, settings, profile, waitlist
- [x] Failed and rejected requests logged with the reason (request bodies hidden for auth routes)

### Tests
- [x] `npm test` in `backend/` runs 39 end-to-end API tests (Node's test runner + `app.inject`) against the MongoDB in `.env`
- [x] Covers auth, waitlist, creating/joining workspaces, permissions, profile, status, invitations, the invite code, roles, desks, desk swap requests, removal/ownership emails, positions, office changes, ownership transfer, leaving and deleting, the notice board, office stats (coffee/cat counting, focus time and its cap), moving furniture (owner only, walls, stale moves) and the live office (origin check, presence, movement, nearby speech, live status, one socket per member, relayed voice, no relay for direct pairs, WebRTC signalling, call rooms, chat channels)
- [x] Emails are kept in memory during tests (`MAIL_TRANSPORT=memory`), nothing is really sent
- [x] Uses the same database as the app, but only creates records tagged with a run id (`…@thespace.test`) and deletes exactly those afterwards
- [x] `npm test` in `frontend/` runs 80 component tests (Vitest, jsdom, Testing Library) for the team panel (member/admin/owner views, desks, swap requests, roles, removal, invitations, invite code, errors), the office settings forms (name tag & avatar, style & furniture), the office HUD (status switch, music, members badge, interact button, minimap frame, name tag, toast), the swap-request polling, the dashboard dialogs (edit, delete/leave, members), the notice board (read-only and owner views, add/edit/pin/delete, errors, full board), the stats panel and the live socket client (presence, relayed media frames, reconnecting, tab takeover)
- [x] The 👥 button in the office shows a badge with desk swap requests waiting for you (checked every 30 s and when you come back to the tab), and a toast when a new one arrives

---

## API

| Method | Route | What it does |
|---|---|---|
| POST | `/api/auth/signup` | Create an account and email a code |
| POST | `/api/auth/verify-email` | Check the code |
| POST | `/api/auth/resend-verification` | Send a new code |
| POST | `/api/auth/signin` | Sign in |
| POST | `/api/auth/signout` | Sign out |
| GET | `/api/auth/me` | The signed-in user and their settings |
| PATCH | `/api/auth/me/preferences` | Save settings (sound, minimap, nameTag) |
| GET | `/api/workspaces/mine` | Your workspaces |
| POST | `/api/workspaces` | Create a workspace from the onboarding answers |
| PATCH | `/api/workspaces/:id` | Owner: rename or edit the description |
| DELETE | `/api/workspaces/:id` | Owner: delete · Member: leave |
| GET | `/api/workspaces/:id/office` | The saved office, your desk and status, and who sits where |
| PUT | `/api/workspaces/:id/office/plan` | Owner: change floor plan, team size, style and/or furniture |
| GET | `/api/workspaces/:id/members` | Members with their desk and status, your desk swap requests (owner/admin also see invitations) |
| PATCH | `/api/workspaces/:id/me` | Change your name tag or avatar |
| PATCH | `/api/workspaces/:id/me/status` | Save your status |
| PUT | `/api/workspaces/:id/me/desk` | Take an open desk (owner/admin: swap with whoever sits there) |
| PUT | `/api/workspaces/:id/me/position` | Save where your avatar stands |
| GET | `/api/workspaces/:id/desk-requests` | Your desk swap requests (sent and waiting for you) |
| POST | `/api/workspaces/:id/desk-requests` | Ask a member (`memberId`) to swap desks |
| POST | `/api/workspaces/:id/desk-requests/:requestId/accept` | Accept a request sent to you (swaps the desks) |
| DELETE | `/api/workspaces/:id/desk-requests/:requestId` | Decline a request sent to you, or cancel yours |
| GET | `/api/workspaces/:id/invite` | Owner/admin: the invite code, expiry and whether it works |
| POST | `/api/workspaces/:id/invite/regenerate` | Owner/admin: new code, optional `expiresInDays` |
| PATCH | `/api/workspaces/:id/invite` | Owner/admin: `revoked` and/or `expiresInDays` (1–90 or null) |
| POST | `/api/workspaces/:id/invitations` | Owner/admin: invite more emails |
| POST | `/api/workspaces/:id/invitations/resend` | Owner/admin: send an invitation again |
| DELETE | `/api/workspaces/:id/invitations/:email` | Owner/admin: cancel an invitation |
| PATCH | `/api/workspaces/:id/members/:memberId` | Owner: set role (`admin` / `member`) |
| DELETE | `/api/workspaces/:id/members/:memberId` | Owner/admin: remove a member (they get an email) |
| PUT | `/api/workspaces/:id/members/:memberId/desk` | Owner/admin: move someone to a desk (swaps if taken) |
| GET | `/api/workspaces/:id/notices` | The notice board, and whether you may edit it |
| POST | `/api/workspaces/:id/notices` | Owner: pin a note (`text`, `color`, `pinned`) |
| PATCH | `/api/workspaces/:id/notices/:noticeId` | Owner: edit a note's text or colour, pin/unpin it |
| DELETE | `/api/workspaces/:id/notices/:noticeId` | Owner: take a note down |
| GET | `/api/workspaces/:id/stats` | Coffees, cat pets and focus time: office totals, yours and each member's |
| POST | `/api/workspaces/:id/me/stats` | Count a `coffee` or a `cat` pet |
| PUT | `/api/workspaces/:id/office/layout` | Owner: save moved furniture (`moves`: index, kind, from, to) |
| GET (WebSocket) | `/api/workspaces/:id/live` | The live office: presence, movement, status, proximity chat, WebRTC signalling and relayed voice/video |
| GET | `/api/workspaces/:id/messages` | Chat in a `channel` (`office` or a room name), 50 at a time (`before` pages back), plus the channel list and who's online |
| POST | `/api/workspaces/:id/messages` | Post `text` to a `channel`; sent live to everyone in the office |
| POST | `/api/workspaces/:id/transfer` | Owner: hand the workspace to another member (they get an email) |
| GET | `/api/workspaces/invitations/:code` | Check an invitation code |
| POST | `/api/workspaces/join` | Join with an invitation code |
| POST | `/api/waitlist` | Early-access sign-up |
| GET | `/api/health` | Health check |

---

## Future plan

### Next up
- [x] Show waiting desk swap requests in the office (a badge on 👥) without opening the members panel
- [x] Frontend tests for the rest of the office HUD and the dashboard dialogs

### Account
- [ ] Forgot / reset password
- [ ] Change password, name or email
- [ ] See and sign out of other sessions

### Real-time (multiplayer)
- [x] WebSocket server for presence: see who's online and where they are walking
- [x] Show teammates' avatars and live status in the office
- [x] Proximity chat / voice when avatars are near each other
- [x] Video calls in the meeting room and call booths
- [x] Workspace chat (`messages` collection, per room)

### Office life
- [x] Notice board the owner can edit (`notices` collection)
- [x] Small stats: coffees made, focus time, cat pets
- [x] Move furniture around and save the layout

### Blockchain (Web3 office)
Everything runs on the Avalanche Fuji testnet (C-Chain) first, so nobody spends real money. Contracts are written in Remix — see `contracts/README.md`.

**Identity & access**
- [ ] **Sign in with a wallet** (Sign-In with Ethereum, EIP-4361) next to email/password, and link a wallet to an existing account
- [ ] **Token-gated workspaces**: the owner can let anyone holding a chosen NFT or token join, instead of (or as well as) the invitation code
- [ ] **Workspace ownership as an NFT**: each office gets an ownership token; sending it to someone else transfers the workspace (kept in sync with the existing transfer flow)
- [ ] Use an NFT you own as your avatar or name-tag badge (ownership checked on the server)

**Badges & rewards**
- [ ] **Achievement badges** as soulbound (non-transferable, ERC-5192) tokens, earned from office stats: 100 coffees, 10 hours of focus, first cat pet, 30-day streak
- [ ] **Proof of attendance**: stand-ups, events and meetings in the office can mint a small attendance badge to everyone who was there
- [ ] **Kudos**: send a teammate a thank-you token (or a testnet "coffee tip") from the members panel, with a public leaderboard
- [ ] Badge shelf in the office and on the profile, showing your on-chain badges

**Team decisions**
- [ ] **On-chain polls** on the notice board: members vote with a wallet signature (gasless, Snapshot-style), the result is final and anyone can check it
- [ ] Optional team treasury (multisig wallet) shown in the office, with proposals voted on by members

**Trust & transparency**
- [ ] **Tamper-proof audit log**: important admin actions (role changes, removals, ownership transfers, layout saves) are hashed together and the daily Merkle root is written on-chain, so the history can be checked but not rewritten
- [ ] Office layout snapshots: save a hash of the saved office on-chain, or mint it as a collectible "office NFT"

**Under the hood**
- [ ] Smart contracts (Solidity) with Foundry or Hardhat, plus contract tests
- [ ] Frontend wallet connect with wagmi + viem; backend reads the chain with viem and listens for events (badges minted, ownership token moved)
- [ ] Gas sponsored for users (account abstraction, ERC-4337 paymaster), so people without crypto can still earn badges
- [ ] No private keys in the database or the repo; the minting key lives in an env variable / secret manager
- [ ] Every on-chain feature is optional: a workspace works exactly as today without a wallet

### Production
- [ ] Shared rate limiter (Redis) instead of in-memory
- [ ] Tests for the office generator (API routes are covered by `npm test`)
- [ ] An in-memory MongoDB for tests, so they don't need the cluster
- [ ] Deployment (frontend + API + MongoDB Atlas), HTTPS cookies
