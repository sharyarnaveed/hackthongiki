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
