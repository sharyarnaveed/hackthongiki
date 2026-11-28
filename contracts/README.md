# Smart contracts (Avalanche Fuji, via Remix)

Contracts are written for [Remix](https://remix.ethereum.org) and deployed from the browser with MetaMask.
Network: **Avalanche Fuji** (C-Chain testnet), so nobody spends real money.

| | |
|---|---|
| Network name | Avalanche Fuji C-Chain |
| RPC URL | `https://api.avax-test.network/ext/bc/C/rpc` |
| Chain ID | `43113` |
| Currency | AVAX |
| Explorer | https://testnet.snowtrace.io |
| Test AVAX | https://core.app/tools/testnet-faucet (pick "Fuji C-Chain") |

## `WorkspaceOwnership.sol`: workspace ownership as an NFT

Each workspace has one ERC-721 token. Whoever holds it owns the workspace.

- **App wallet** (the contract owner, TheSpace's backend): mints a token for every workspace, holds it in
  custody while the owner has no wallet linked, approves which wallets may receive it (the workspace's
  members), and mirrors ownership transfers made inside the app (`syncTransfer`).
- **Holder** (a workspace owner with a linked wallet): can send the token, but **only to approved
  members**. Anything else reverts with `RecipientNotMember`.
- Token id = the workspace's MongoDB id as a number, e.g. workspace `665f1c2ab3e4d5f6a7b8c9d0` →
  token id `0x665f1c2ab3e4d5f6a7b8c9d0`.

## 1. Set up MetaMask

1. Add Fuji to MetaMask: open https://chainlist.org/chain/43113 → **Add to MetaMask** (or enter the table
   above by hand).
2. Create a new MetaMask account just for the app, e.g. **"TheSpace app"**. This is the wallet the
   backend will use. Don't use your personal wallet for it.
3. Get free test AVAX for it from the faucet (0.5 AVAX is plenty).

## 2. Deploy in Remix

1. Open https://remix.ethereum.org → **File explorer** → new file `WorkspaceOwnership.sol` → paste this file.
2. **Solidity compiler** tab: compiler `0.8.24` or newer → **Compile**.
   (If deploying later fails with an "invalid opcode" error, open *Advanced configurations* and set EVM
   version to `shanghai`, then compile again.)
3. **Deploy & run** tab:
   - Environment: **Injected Provider - MetaMask**, with the "TheSpace app" account on Fuji.
   - Contract: `WorkspaceOwnership`.
   - Constructor `app`: paste the **"TheSpace app" address** (the same account).
   - **Deploy** → confirm in MetaMask.
4. Copy the deployed contract address (under *Deployed Contracts*) and open it on
   https://testnet.snowtrace.io to check it's there.

## 3. Try it in Remix (manual test)

Use a second MetaMask account ("Member") for the steps marked *(Member)*. Example token id:
`0x665f1c2ab3e4d5f6a7b8c9d0`.

| # | As | Call | Expect |
|---|---|---|---|
| 1 | App | `mint(tokenId)` | `ownerOf(tokenId)` = app address |
| 2 | App | `mint(tokenId)` again | reverts (`ERC721InvalidSender`), one token per workspace |
| 3 | Member | `mint(otherId)` | reverts (`OwnableUnauthorizedAccount`), only the app mints |
| 4 | App | `syncTransfer(tokenId, <Member>)` | `ownerOf` = Member (in-app transfer / wallet linked) |
| 5 | Member | `transferFrom(<Member>, <random address>, tokenId)` | reverts `RecipientNotMember` |
| 6 | App | `setAllowed(tokenId, ["<App2 address>"], true)` | `isAllowed(tokenId, <App2>)` = true |
| 7 | Member | `transferFrom(<Member>, <App2>, tokenId)` | succeeds, ownership moved on-chain |
| 8 | App | `syncTransfer(tokenId, <App>)` | back in custody |
| 9 | App | `burn(tokenId)` | `exists(tokenId)` = false |

Arrays in Remix are typed as `["0xabc…","0xdef…"]`.

## 4. Hand it to the backend

Put these in `backend/.env` (never commit them):

```
CHAIN_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc
CHAIN_ID=43113
OWNERSHIP_CONTRACT=0x…        # deployed address from step 2
CHAIN_PRIVATE_KEY=0x…         # "TheSpace app" account: MetaMask → Account details → Show private key
```

Without them, on-chain ownership is simply off and workspaces work as before.

Restart the backend. The log should say `⛓️ On-chain ownership on`. (If the key isn't the contract's app wallet, or the
address is wrong, it says why and stays off.) From then on the backend:

- mints a token for every workspace (existing ones too, on start),
- approves each member's linked wallet, and revokes it when they leave or unlink,
- keeps the token in the owner's linked wallet, or in the app's custody if they have none,
- moves it when ownership is transferred in the app, and burns it when a workspace is deleted,
- watches the chain: if the holder sends the token to another member in MetaMask, that member becomes the owner.

The members panel shows the token and a Snowtrace link.

---

## `OfficeDecor.sol`: NFT decor shop and marketplace

Decor for the office (plants, lamps, a fireplace…) as NFTs, with a **shop** and a **marketplace** in one contract.

- **Shop**: the app wallet adds catalog items with a price. Anyone buys one for that price in AVAX and gets a new NFT.
- **Marketplace**: you list a decor NFT for a price; the contract holds it until someone buys it (you're paid in the
  same transaction) or you cancel.
- **In the office**: a workspace owner can place decor their linked wallet holds. If the wallet stops holding it
  (sold, listed, sent away, wallet unlinked, or someone else becomes owner), it leaves the office by itself.

### Deploy it

Same as the ownership contract, with the same **"TheSpace app"** account:

1. Remix → new file `OfficeDecor.sol` → paste `contracts/OfficeDecor.sol` → **Compile**.
2. **Deploy & run** → contract `OfficeDecor` → constructor `app` = the "TheSpace app" address → **Deploy**.
3. Copy the address and add it to `backend/.env`:

   ```
   DECOR_CONTRACT=0x…   # deployed OfficeDecor address
   ```
4. Fill the shop with the starter catalog (9 items, 0.005 to 0.05 AVAX). From `backend/`:

   ```
   npm run seed:decor
   ```
   It uses `CHAIN_PRIVATE_KEY`, skips items that are already there, and stops if the key isn't the contract's owner.
5. Restart the backend. The log should say `🪴 Decor market on`, then `🪴 Decor market loaded from the chain`.
6. Open the dashboard → **Decor market**.

### Try it

You need test AVAX in the wallet you've linked on the dashboard.

| # | Where | Do | Expect |
|---|---|---|---|
| 1 | Shop | **Buy** an item → confirm in MetaMask | "You bought…"; it shows in **My decor** |
| 2 | My decor | Pick your office → **Place** | It stands near the entrance, with a little sparkle |
| 3 | Office | **Arrange** → drag it | Moves like any furniture |
| 4 | My decor | **Sell…** → `0.05` → **List** → confirm | Shows on **Market**; it leaves your office |
| 5 | Market | **Cancel sale** on your listing | Back in your wallet |
| 6 | Other account | Link another wallet, **Buy for 0.05** | Buyer has it; seller got 0.05 AVAX |
| 7 | Remix | `updateItem(id, price, false)` as the app | That item shows **Sold out** |
| 8 | Remix | `withdraw(<address>)` as the app | Shop sales are sent there |

### All the contract's functions

| Who | Function | What it does |
|---|---|---|
| App | `addItem(name, kind, price)` | Add a catalog item (`kind` is the furniture it looks like: `plant`, `small-plant`, `tree`, `lamp`, `beanbag`, `record-player`, `fireplace`, `armchair`, `bookshelf`) |
| App | `updateItem(itemId, price, forSale)` | Change the price or take it off sale |
| App | `withdraw(to)` | Send shop sales to `to` |
| Anyone | `buy(itemId)` + exact price | Mint a new decor NFT |
| Holder | `list(tokenId, price)` | Put it on the market (the contract holds it) |
| Seller | `cancel(tokenId)` | Take the listing down |
| Anyone | `buyListing(tokenId)` + exact price | Buy it; the seller is paid at once |
