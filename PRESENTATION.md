# TheSpace: Presentation Deck

> A cozy pixel-art virtual office where teams work together, and own the office they build.

Each `---` below is one slide. Speaker notes are in the *Notes* lines.

---

## 1. Title

# TheSpace
### Your team's office, back on the map.

A pixel-art virtual office with live presence, proximity voice, video meetings and an office you own as an NFT.

*Notes: open with the demo office on screen, with two avatars walking in.*

---

## 2. The problem

- Remote teams lost the **office moments**: the quick question at a desk, the coffee chat, "got a minute?"
- Slack and Zoom are **scheduled and heavy**. Every chat is a meeting link, and every meeting is a calendar invite.
- Teams feel **invisible to each other**: you can't see who's around, busy or free.
- Tools are rented, not owned. Nothing about your team's space is **yours**.

---

## 3. The solution: TheSpace

A shared 2D office in the browser. No install.

- **Walk up and talk.** Proximity voice gets louder as you get closer, and fades as you walk away.
- **Meet in the meeting room.** Video calls start at the meeting table. Everyone in the office sees *"Ali is in a call · Join"*.
- **See who's here.** Live avatars, status (Available / Focusing / On a break) and a minimap.
- **Make it yours.** The office is generated from your answers, and you can rearrange the furniture.
- **Own it.** Every workspace is an NFT, and decor items are NFTs you can buy, place and trade.

---

## 4. Demo flow (3 minutes)

1. Sign up → onboarding → pick a floor plan, style and avatar → the office is generated.
2. A teammate joins with the invite code and appears live in the office.
3. Walk up to them and talk with proximity voice.
4. Start a video call in the meeting room. The teammate sees the banner and clicks **Join**.
5. Dashboard → **Link wallet** (MetaMask) → the workspace ownership NFT moves to your wallet.
6. **Decor market** → buy the *Golden Monstera* → **Place** → it sparkles in the office.

*Notes: keep MetaMask unlocked and on Avalanche Fuji before the demo.*

---

## 5. Features built

| Area | What works today |
|---|---|
| Office | 6 floor plans × 4 styles × 5 team sizes, 16 furniture groups, generated and saved on the server |
| Live | Presence, movement, status, name tags, minimap, nearby speech bubbles |
| Talk | Proximity voice, video calls (up to 8), room and office chat channels |
| Team | Roles (owner/admin/member), invite codes, desks, desk swap requests, ownership transfer |
| Office life | Notice board, coffee/cat/focus stats, move furniture and save the layout |
| Web3 | Sign in with a wallet, workspace ownership NFT, decor NFT shop and peer-to-peer marketplace |

---

## 6. How it works (tech)

- **Frontend:** Next.js 16, React 19, Tailwind 4, **Phaser 4** for the office game
- **Backend:** Fastify 5, MongoDB, WebSockets for live presence and signalling
- **Calls:** direct WebRTC first, with a fallback relay over the same WebSocket. It works behind strict firewalls with no TURN server.
- **Blockchain:** Avalanche (C-Chain), Solidity + OpenZeppelin ERC-721
  - `WorkspaceOwnership`: one NFT per workspace, and whoever holds it owns the workspace. It can only be sent to members.
  - `OfficeDecor`: a shop that mints decor for AVAX, plus a marketplace where people list, buy and cancel listings.
- **Shared code:** the server builds the exact same office the client draws, from one TypeScript generator.

---

## 7. Why Web3 here?

- **Real ownership:** the office belongs to whoever holds the NFT. Hand it over in the app or straight from MetaMask, and the app follows the chain.
- **Real items:** decor is yours. Sell it, gift it or move it between your offices.
- **Optional:** without a wallet the app works exactly the same. Crypto is a bonus, not a barrier.

---

## 8. Revenue model: overview

TheSpace makes money from **two engines**:

1. **SaaS subscriptions:** predictable, recurring revenue from teams.
2. **Digital economy:** decor sales, marketplace fees and partnerships.

| # | Revenue stream | Who pays | Type |
|---|---|---|---|
| 1 | Team subscriptions (per seat) | Companies | Recurring |
| 2 | Decor shop sales (NFT) | Users | Transactional |
| 3 | Marketplace fee on resales | Buyers and sellers | Transactional |
| 4 | Creator revenue share | Artists (we take a cut) | Transactional |
| 5 | Premium offices and themes | Teams | One-off / upgrade |
| 6 | Branded decor and sponsorships | Brands | Partnerships |
| 7 | Events and virtual coworking spaces | Organisers and communities | Per event / recurring |
| 8 | Enterprise (SSO, self-hosting, SLA) | Large companies | Contracts |

---

## 9. Stream 1: Team subscriptions (core)

| Plan | Price | For | Includes |
|---|---|---|---|
| **Free** | $0 | Small teams trying it | Up to 5 members, 1 office, voice, chat, basic decor |
| **Team** | **$5 / user / month** | Startups and remote teams | Unlimited members, video calls, all floor plans, notice board, stats |
| **Business** | **$9 / user / month** | Growing companies | Several offices, admin tools, analytics, priority media relay, SSO |
| **Enterprise** | Custom | Large companies | Self-hosting, SLA, audit log, dedicated support |

- Free → paid triggers: a 6th member joins, the team needs video calls, or it wants a second office.
- Annual billing at 2 months free improves cash flow.

---

## 10. Stream 2: Decor shop sales (live today)

- The `OfficeDecor` contract **already sells decor for AVAX**, and the money stays in the contract until the app wallet calls `withdraw()`.
- Starter catalog: 9 items from **0.005 to 0.05 AVAX** (bonsai, monstera, neon lamp, fireplace…).
- Growth levers:
  - **Limited editions:** set a supply, and "sold out" items become collectibles.
  - **Seasonal drops:** Halloween, winter and Ramadan sets.
  - **Bundles:** "Cozy Café" or "Library Corner" sets, at a discount versus single items.
- Also accept **card payments** (fiat on-ramp, or plain in-app purchases) for users without crypto.

---

## 11. Stream 3: Marketplace fees

- Users already **list, buy and cancel** decor peer-to-peer in the contract.
- **Planned upgrade:** take a **2.5% platform fee** on every resale, and add **creator royalties (EIP-2981, ~5%)**.
- Every resale earns revenue, so the platform earns more when items gain value.
- *Note: the current contract sends 100% to the seller. Adding the fee is a small contract change before mainnet.*

---

## 12. Streams 4–5: Creators and premium offices

**Creator program (revenue share)**
- Pixel artists submit decor. We review it and add it to the shop.
- Split: **70% creator / 30% TheSpace** on first sales, plus royalties on resales.
- The catalog keeps growing without us drawing every item.

**Premium offices and themes**
- Extra floor plans (rooftop, beach house, space station), seasonal styles, animated pets.
- Sold as one-off upgrades ($10–$30 per office) or included in the Business plan.
- **Limited-edition workspace NFTs:** numbered "founder" offices with special layouts.

---

## 13. Streams 6–8: Brands, events and enterprise

**Branded decor and sponsorships**
- Brands sponsor items: a coffee brand's espresso machine, a laptop brand's desks, a sports team's posters.
- Paid per campaign, with optional free giveaways to users (good marketing for both sides).

**Events and virtual coworking**
- Hackathons, conferences, university clubs and meetups rent a big office for the day.
- **Attendance NFT badges** for people who came (on the roadmap).
- Ticketing: we take a small fee per ticket, or charge per event.

**Enterprise**
- SSO, audit log, data residency, self-hosting and an SLA, at annual contract pricing.

---

## 14. Example numbers (illustration)

*Assumptions for one year after launch. These are not real results.*

| Item | Assumption | Yearly revenue |
|---|---|---|
| Paying seats | 2,000 seats × $6 average × 12 months | **$144,000** |
| Decor shop | 5,000 items × $5 average | **$25,000** |
| Marketplace fee | $200,000 resale volume × 2.5% | **$5,000** |
| Creator share (our 30%) | $40,000 creator sales × 30% | **$12,000** |
| Premium offices | 800 upgrades × $15 | **$12,000** |
| Brands and events | 6 sponsors + 20 events | **$30,000** |
| **Total** | | **≈ $228,000** |

Subscriptions are the base (about 63%). The digital economy grows on top of it.

---

## 15. Costs and margins

- **Hosting:** API, MongoDB and WebSocket servers.
- **Media:** most calls go directly between browsers (WebRTC), which costs us nothing. Only blocked networks use our relay, so bandwidth stays low.
- **Blockchain:** the app wallet pays gas for minting and syncing ownership. On Avalanche that's cents per transaction. On paid plans, we can cover users' gas so they never need crypto.
- Software margins are high: no per-user hardware, and most media traffic is peer-to-peer.

---

## 16. Market and competition

| | TheSpace | Gather | Zoom / Meet | Slack Huddles |
|---|---|---|---|---|
| Walk-up proximity voice | ✅ | ✅ | ❌ | ❌ |
| Video meeting rooms | ✅ | ✅ | ✅ | ⚠️ |
| Office generated for your team | ✅ | ⚠️ manual | ❌ | ❌ |
| Own your office (NFT) | ✅ | ❌ | ❌ | ❌ |
| Decor economy / marketplace | ✅ | ❌ | ❌ | ❌ |
| Works behind strict firewalls with no TURN | ✅ | ⚠️ | ✅ | ✅ |

**Our edge:** a cozy, personal office the team **owns**, with an economy around it.

---

## 17. Roadmap

- **Now:** live on Avalanche Fuji testnet. Ownership NFT, decor shop and marketplace work end to end.
- **Next 3 months:**
  - Billing (Stripe) and the Free/Team plans
  - Marketplace fee and royalties
  - Card payments for decor
- **Next 6 months:**
  - Badges for office stats (100 coffees, 10 focus hours)
  - Kudos tokens
  - Wall art
  - Token-gated join
- **Later:**
  - Mainnet launch
  - Creator portal
  - Events and ticketing
  - Enterprise SSO and self-hosting
  - The app pays gas for every user

---

## 18. The ask / closing

- **We're looking for:** pilot teams (remote startups, university societies, hackathon organisers) and pixel artists for the creator program.
- **Try it:** sign up, invite a teammate and say hi at the coffee machine.

### TheSpace: the office your team actually wants to log into.

*Notes: end on the live office with the decor sparkling and a teammate waving.*
