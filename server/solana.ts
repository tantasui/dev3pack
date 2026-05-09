import {
  Connection,
  PublicKey,
  Keypair,
  LAMPORTS_PER_SOL,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { AnchorProvider, BN, BorshCoder, Idl, Program } from "@coral-xyz/anchor";
import bs58 from "bs58";

// ─── Program constants ────────────────────────────────────────────────────────

export const PROGRAM_ID = new PublicKey(
  "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS"
);
export const REVEAL_WINDOW_SECONDS = 3600;

// ─── IDL (copied from sdk — React-free) ──────────────────────────────────────

export const IDL: Idl = {
  version: "0.1.0",
  name: "attention_market",
  instructions: [
    {
      name: "createMarket",
      accounts: [
        { name: "market", isMut: true, isSigner: false },
        { name: "vault", isMut: true, isSigner: false },
        { name: "protocolTreasury", isMut: false, isSigner: false },
        { name: "authority", isMut: true, isSigner: true },
        { name: "systemProgram", isMut: false, isSigner: false },
      ],
      args: [
        { name: "contentId", type: "string" },
        { name: "title", type: "string" },
        { name: "durationSeconds", type: "i64" },
        { name: "mode", type: "u8" },
      ],
    },
    {
      name: "commitBet",
      accounts: [
        { name: "market", isMut: true, isSigner: false },
        { name: "vault", isMut: true, isSigner: false },
        { name: "bet", isMut: true, isSigner: false },
        { name: "userStats", isMut: true, isSigner: false },
        { name: "user", isMut: true, isSigner: true },
        { name: "systemProgram", isMut: false, isSigner: false },
      ],
      args: [
        { name: "commitment", type: { array: ["u8", 32] } },
        { name: "amountLamports", type: "u64" },
      ],
    },
    {
      name: "revealBet",
      accounts: [
        { name: "market", isMut: true, isSigner: false },
        { name: "bet", isMut: true, isSigner: false },
        { name: "userStats", isMut: true, isSigner: false },
        { name: "user", isMut: false, isSigner: true },
      ],
      args: [
        { name: "outcome", type: "u8" },
        { name: "secret", type: { array: ["u8", 32] } },
      ],
    },
    {
      name: "resolveMarket",
      accounts: [
        { name: "market", isMut: true, isSigner: false },
        { name: "vault", isMut: true, isSigner: false },
        { name: "protocolTreasury", isMut: true, isSigner: false },
        { name: "creator", isMut: true, isSigner: false },
        { name: "authority", isMut: false, isSigner: true },
      ],
      args: [],
    },
    {
      name: "claimWinnings",
      accounts: [
        { name: "market", isMut: false, isSigner: false },
        { name: "vault", isMut: true, isSigner: false },
        { name: "bet", isMut: true, isSigner: false },
        { name: "userStats", isMut: true, isSigner: false },
        { name: "user", isMut: true, isSigner: true },
      ],
      args: [],
    },
    {
      name: "postComment",
      accounts: [
        { name: "market", isMut: true, isSigner: false },
        { name: "comment", isMut: true, isSigner: false },
        { name: "author", isMut: true, isSigner: true },
        { name: "systemProgram", isMut: false, isSigner: false },
      ],
      args: [
        { name: "content", type: "string" },
        { name: "commentIndex", type: "u64" },
      ],
    },
  ],
  accounts: [
    {
      name: "Market",
      type: {
        kind: "struct",
        fields: [
          { name: "contentId", type: "string" },
          { name: "title", type: "string" },
          { name: "authority", type: "publicKey" },
          { name: "creator", type: "publicKey" },
          { name: "protocolTreasury", type: "publicKey" },
          { name: "mode", type: "u8" },
          { name: "totalCommitted", type: "u64" },
          { name: "totalPot", type: "u64" },
          { name: "totalViral", type: "u64" },
          { name: "totalFlop", type: "u64" },
          { name: "viralCount", type: "u64" },
          { name: "flopCount", type: "u64" },
          { name: "commentCount", type: "u64" },
          { name: "endTime", type: "i64" },
          { name: "earlyWindowEnd", type: "i64" },
          { name: "resolved", type: "bool" },
          { name: "outcome", type: "u8" },
          { name: "winnerPool", type: "u64" },
          { name: "bump", type: "u8" },
        ],
      },
    },
    {
      name: "BetRecord",
      type: {
        kind: "struct",
        fields: [
          { name: "market", type: "publicKey" },
          { name: "user", type: "publicKey" },
          { name: "commitment", type: { array: ["u8", 32] } },
          { name: "amount", type: "u64" },
          { name: "isEarly", type: "bool" },
          { name: "revealed", type: "bool" },
          { name: "revealedOutcome", type: "u8" },
          { name: "claimed", type: "bool" },
          { name: "bump", type: "u8" },
        ],
      },
    },
    {
      name: "Comment",
      type: {
        kind: "struct",
        fields: [
          { name: "market", type: "publicKey" },
          { name: "author", type: "publicKey" },
          { name: "content", type: "string" },
          { name: "timestamp", type: "i64" },
          { name: "bump", type: "u8" },
        ],
      },
    },
    {
      name: "UserStats",
      type: {
        kind: "struct",
        fields: [
          { name: "user", type: "publicKey" },
          { name: "totalBets", type: "u64" },
          { name: "totalWins", type: "u64" },
          { name: "bump", type: "u8" },
        ],
      },
    },
  ],
  events: [
    {
      name: "WhaleBet",
      fields: [
        { name: "market", type: "publicKey", index: false },
        { name: "amount", type: "u64", index: false },
        { name: "timestamp", type: "i64", index: false },
      ],
    },
  ],
  errors: [],
};

// ─── Solana connection ────────────────────────────────────────────────────────

export const connection = new Connection(
  process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
  "confirmed"
);

// ─── Resolver wallet (server-side keypair) ────────────────────────────────────

function loadResolverKeypair(): Keypair {
  const raw = process.env.RESOLVER_KEYPAIR;
  if (!raw) {
    console.warn("[solana] RESOLVER_KEYPAIR not set — using random keypair (resolve will fail)");
    return Keypair.generate();
  }
  try {
    // Try base58 first
    return Keypair.fromSecretKey(bs58.decode(raw));
  } catch {
    // Fallback: JSON array
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  }
}

export const resolverKeypair = loadResolverKeypair();

// Minimal wallet interface for Anchor
export const resolverWallet = {
  publicKey: resolverKeypair.publicKey,
  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    if (tx instanceof Transaction) tx.sign(resolverKeypair);
    return tx;
  },
  async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
    return txs.map((tx) => {
      if (tx instanceof Transaction) tx.sign(resolverKeypair);
      return tx;
    });
  },
};

// ─── Anchor program factory ───────────────────────────────────────────────────

function getProgram(wallet = resolverWallet) {
  const provider = new AnchorProvider(connection, wallet as any, AnchorProvider.defaultOptions());
  return new Program(IDL, PROGRAM_ID, provider);
}

// ─── PDA helpers ──────────────────────────────────────────────────────────────

export function getMarketPda(contentId: string): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), Buffer.from(contentId)],
    PROGRAM_ID
  )[0];
}

export function getVaultPda(marketPubkey: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), marketPubkey.toBuffer()],
    PROGRAM_ID
  )[0];
}

export function getCommentPda(marketPubkey: PublicKey, index: number): PublicKey {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(index));
  return PublicKey.findProgramAddressSync(
    [Buffer.from("comment"), marketPubkey.toBuffer(), buf],
    PROGRAM_ID
  )[0];
}

// ─── Parsed types ─────────────────────────────────────────────────────────────

export interface MarketRow {
  pubkey: string;
  contentId: string;
  title: string;
  mode: number;
  resolved: boolean;
  outcome: number;
  totalCommittedSOL: number;
  totalViralSOL: number;
  totalFlopSOL: number;
  viralCount: number;
  flopCount: number;
  commentCount: number;
  endTime: number;
  earlyWindowEnd: number;
  winnerPoolSOL: number;
  creator: string;
  protocolTreasury: string;
}

export interface CommentRow {
  pubkey: string;
  market: string;
  author: string;
  content: string;
  timestamp: number;
}

export interface CreatorStatsRow {
  totalEarned: number;
  marketsCreated: number;
  totalVolume: number;
}

// ─── Query functions ──────────────────────────────────────────────────────────

export async function getAllMarkets(): Promise<MarketRow[]> {
  const coder = new BorshCoder(IDL);
  const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
    filters: [{ dataSize: 395 }],
  });
  const results: MarketRow[] = [];
  for (const { pubkey, account } of accounts) {
    try {
      const m = coder.accounts.decode("Market", account.data);
      results.push({
        pubkey: pubkey.toBase58(),
        contentId: m.contentId,
        title: m.title,
        mode: m.mode,
        resolved: m.resolved,
        outcome: m.outcome,
        totalCommittedSOL: m.totalCommitted.toNumber() / LAMPORTS_PER_SOL,
        totalViralSOL: m.totalViral.toNumber() / LAMPORTS_PER_SOL,
        totalFlopSOL: m.totalFlop.toNumber() / LAMPORTS_PER_SOL,
        viralCount: m.viralCount.toNumber(),
        flopCount: m.flopCount.toNumber(),
        commentCount: m.commentCount.toNumber(),
        endTime: m.endTime.toNumber(),
        earlyWindowEnd: m.earlyWindowEnd.toNumber(),
        winnerPoolSOL: m.winnerPool.toNumber() / LAMPORTS_PER_SOL,
        creator: m.creator.toBase58(),
        protocolTreasury: m.protocolTreasury.toBase58(),
      });
    } catch {}
  }
  return results;
}

export async function getMarketByPubkey(pubkey: PublicKey): Promise<MarketRow | null> {
  const coder = new BorshCoder(IDL);
  try {
    const account = await connection.getAccountInfo(pubkey);
    if (!account) return null;
    const m = coder.accounts.decode("Market", account.data);
    return {
      pubkey: pubkey.toBase58(),
      contentId: m.contentId,
      title: m.title,
      mode: m.mode,
      resolved: m.resolved,
      outcome: m.outcome,
      totalCommittedSOL: m.totalCommitted.toNumber() / LAMPORTS_PER_SOL,
      totalViralSOL: m.totalViral.toNumber() / LAMPORTS_PER_SOL,
      totalFlopSOL: m.totalFlop.toNumber() / LAMPORTS_PER_SOL,
      viralCount: m.viralCount.toNumber(),
      flopCount: m.flopCount.toNumber(),
      commentCount: m.commentCount.toNumber(),
      endTime: m.endTime.toNumber(),
      earlyWindowEnd: m.earlyWindowEnd.toNumber(),
      winnerPoolSOL: m.winnerPool.toNumber() / LAMPORTS_PER_SOL,
      creator: m.creator.toBase58(),
      protocolTreasury: m.protocolTreasury.toBase58(),
    };
  } catch {
    return null;
  }
}

export async function getComments(
  marketPubkey: PublicKey,
  limit = 30,
  offset = 0
): Promise<{ comments: CommentRow[]; total: number }> {
  const coder = new BorshCoder(IDL);
  const market = await getMarketByPubkey(marketPubkey);
  if (!market) return { comments: [], total: 0 };

  const total = market.commentCount;
  const start = Math.max(0, Math.min(offset, total));
  const end = Math.min(start + limit, total);

  const pdas = Array.from({ length: end - start }, (_, i) =>
    getCommentPda(marketPubkey, start + i)
  );
  if (pdas.length === 0) return { comments: [], total };

  const accounts = await connection.getMultipleAccountsInfo(pdas);
  const comments: CommentRow[] = [];
  accounts.forEach((acc, i) => {
    if (!acc) return;
    try {
      const c = coder.accounts.decode("Comment", acc.data);
      comments.push({
        pubkey: pdas[i].toBase58(),
        market: c.market.toBase58(),
        author: c.author.toBase58(),
        content: c.content,
        timestamp: c.timestamp.toNumber(),
      });
    } catch {}
  });

  return { comments, total };
}

export async function getCreatorStats(creatorPubkey: PublicKey): Promise<CreatorStatsRow> {
  try {
    const coder = new BorshCoder(IDL);
    const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
      filters: [
        { dataSize: 395 },
        { memcmp: { offset: 240, bytes: creatorPubkey.toBase58() } },
      ],
    });

    let totalVolume = 0;
    let totalEarned = 0;
    const marketsCreated = accounts.length;

    for (const { account } of accounts) {
      try {
        const m = coder.accounts.decode("Market", account.data);
        const pot = m.totalCommitted.toNumber() / LAMPORTS_PER_SOL;
        totalVolume += pot;
        if (m.resolved) totalEarned += pot * 0.03;
      } catch {}
    }

    return { totalEarned, marketsCreated, totalVolume };
  } catch {
    return { totalEarned: 0, marketsCreated: 0, totalVolume: 0 };
  }
}

export async function resolveMarket(marketPubkey: PublicKey): Promise<string> {
  const market = await getMarketByPubkey(marketPubkey);
  if (!market) throw new Error("Market not found");

  const program = getProgram();
  const vaultPda = getVaultPda(marketPubkey);

  return program.methods
    .resolveMarket()
    .accounts({
      market: marketPubkey,
      vault: vaultPda,
      protocolTreasury: new PublicKey(market.protocolTreasury),
      creator: new PublicKey(market.creator),
      authority: resolverWallet.publicKey,
    })
    .rpc();
}
