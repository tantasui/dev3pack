# CrowdCast ⚡

CrowdCast is a TikTok-style attention prediction market on Solana where users scroll short video content and bet SOL on whether the crowd will love it (Viral) or ignore it (Flop). Markets resolve based on an engagement score after a countdown timer, turning attention itself into a tradeable primitive.

## The Primitive

Any content ID — a video, a tweet, an NFT, a blog post — can have a prediction market created around it on-chain. The `attention_market` program is content-agnostic: you pass a `content_id` string and it spins up a fully on-chain market with a SOL vault, proportional payout math, and authority-gated resolution. The CrowdCast TikTok demo is just one consumer of this primitive; any app can integrate via the SDK.

---

## Architecture

```
Layer 1 — Anchor Program    programs/attention_market/src/lib.rs
Layer 2 — TypeScript SDK    sdk/index.ts
Layer 3 — Next.js App       app/
```

---

## Running Locally

### Prerequisites

- [Rust](https://rustup.rs/) + Solana CLI (`sh -c "$(curl -sSfL https://release.solana.com/stable/install)"`)
- [Anchor CLI](https://www.anchor-lang.com/docs/installation) `v0.29.0`
- Node.js 18+ and Yarn

### 1. Install dependencies

```bash
yarn install          # root (test runner deps)
cd app && yarn install
```

### 2. Build the Anchor program

```bash
anchor build
```

This compiles the Rust program and generates the IDL at `target/idl/attention_market.json`.

### 3. Run tests (localnet)

```bash
anchor test
```

The test suite:
1. Creates a market
2. Places two bets from different wallets (viral + flop)
3. Waits for the market to expire
4. Resolves as viral
5. Claims winnings from the viral bettor and asserts correct SOL transfer

### 4. Start the Next.js dev server

```bash
cd app && yarn dev
```

Open [http://localhost:3000](http://localhost:3000) — you'll see the TikTok-style feed. Connect a Phantom or Backpack wallet (devnet mode) to start betting.

---

## Deploying to Devnet

### 1. Set cluster to devnet

```bash
solana config set --url devnet
```

### 2. Airdrop SOL to your deploy wallet

```bash
yarn airdrop
# or for a specific address:
yarn airdrop <YOUR_PUBKEY>
```

### 3. Deploy

```bash
anchor deploy --provider.cluster devnet
```

Copy the program ID from the output and update:
- `Anchor.toml` → `[programs.devnet] attention_market = "<new-id>"`
- `sdk/index.ts` → `PROGRAM_ID = new PublicKey("<new-id>")`
- `app/lib/program.ts` → (inherits from SDK)

### 4. Start the app against devnet

```bash
cd app && yarn dev
```

The app connects to `https://api.devnet.solana.com` by default.

---

## SDK API

```ts
import {
  createMarket,
  placeBet,
  resolveMarket,
  claimWinnings,
  getMarket,
  getMarketByContentId,
  getUserBet,
  useMarket,
  getMarketPda,
  computeOdds,
  PROGRAM_ID,
} from "@crowdcast/sdk";
```

| Function | Description |
|---|---|
| `createMarket(connection, wallet, contentId, title, durationSeconds)` | Creates a new market PDA for any content ID |
| `placeBet(connection, wallet, marketPubkey, outcome, amountSOL)` | Places a SOL bet on `'viral'` or `'flop'` |
| `resolveMarket(connection, wallet, marketPubkey, outcome)` | Authority-only: resolves market after expiry |
| `claimWinnings(connection, wallet, marketPubkey)` | Winner claims proportional SOL payout |
| `getMarket(connection, marketPubkey)` | Fetch market account by pubkey |
| `getMarketByContentId(connection, contentId)` | Fetch market by content ID string |
| `getUserBet(connection, marketPubkey, userPubkey)` | Fetch a user's bet record |
| `computeOdds(market)` | Returns `{ viralPercent, flopPercent, totalSOL }` |
| `useMarket(contentId)` | React hook: market state + bet/claim actions + live odds |

### React hook

```tsx
const {
  market,       // MarketAccount | null
  userBet,      // BetRecord | null
  odds,         // { viralPercent, flopPercent, totalSOL }
  loading,      // boolean
  error,        // string | null
  placeBet,     // (side: 'viral' | 'flop', amountSOL: number) => Promise<void>
  claimWinnings,// () => Promise<void>
  resolveMarket,// (side: 'viral' | 'flop') => Promise<void>
  refresh,      // () => Promise<void>
} = useMarket("my-content-id");
```

---

## Program Accounts

### Market
PDA seed: `["market", contentId]`

| Field | Type | Description |
|---|---|---|
| `contentId` | String | Any content identifier (max 64 chars) |
| `title` | String | Human-readable title (max 128 chars) |
| `authority` | Pubkey | Creator — the only account that can resolve |
| `totalViral` | u64 | Lamports bet on viral outcome |
| `totalFlop` | u64 | Lamports bet on flop outcome |
| `endTime` | i64 | Unix timestamp when betting closes |
| `resolved` | bool | Whether the market has been resolved |
| `outcome` | u8 | 0 = unresolved, 1 = viral, 2 = flop |

### Vault
PDA seed: `["vault", marketPubkey]` — holds the SOL pot

### BetRecord
PDA seed: `["bet", marketPubkey, userPubkey]`

| Field | Type | Description |
|---|---|---|
| `market` | Pubkey | Parent market |
| `user` | Pubkey | Bettor |
| `outcome` | u8 | Which side they bet on |
| `amount` | u64 | Lamports placed |
| `claimed` | bool | Whether winnings were collected |

---

## Design

- Background: `#000000`
- Viral accent: `#7C3AED` (electric purple)
- Flop accent: `#EC4899` (hot pink)
- Font: Inter
- Mobile-first: 390px card width, full-height scroll snap

---

## What's Real vs Mock

| Feature | Status |
|---|---|
| Anchor program (all 4 instructions) | ✅ Real |
| Wallet connect (Phantom / Backpack) | ✅ Real |
| `place_bet` transaction | ✅ Real |
| `claim_winnings` transaction | ✅ Real |
| `create_market` on page load | ✅ Real |
| Video content | Mock (gradients) |
| `resolve_market` | Dev button (authority only) |
| Engagement oracle | Manual resolution |
| Creator chart data | Mock |
