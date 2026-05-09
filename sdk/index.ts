import {
  Connection,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { Program, AnchorProvider, BN, Idl } from "@coral-xyz/anchor";
import { keccak_256 } from "@noble/hashes/sha3";
import { useCallback, useEffect, useRef, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";

// ─── Constants ────────────────────────────────────────────────────────────────

export const PROGRAM_ID = new PublicKey(
  "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS"
);
export const REVEAL_WINDOW_SECONDS = 3600;
export const WHALE_THRESHOLD_SOL = 1;

// Devnet protocol treasury (use program deployer wallet for demo)
export const DEVNET_TREASURY = new PublicKey(
  "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS"
);

// WhaleBet event discriminator: first 8 bytes of sha256("event:WhaleBet")
// Precomputed for efficiency
export const WHALE_BET_DISCRIMINATOR = [56, 158, 187, 15, 77, 131, 214, 152];

// ─── IDL ─────────────────────────────────────────────────────────────────────

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
        { name: "user", isMut: true, isSigner: false },
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

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MarketAccount {
  publicKey: PublicKey;
  contentId: string;
  title: string;
  authority: PublicKey;
  creator: PublicKey;
  protocolTreasury: PublicKey;
  mode: number;           // 0=majority, 1=minority
  totalCommitted: BN;
  totalPot: BN;
  totalViral: BN;
  totalFlop: BN;
  viralCount: BN;
  flopCount: BN;
  commentCount: BN;
  endTime: BN;
  earlyWindowEnd: BN;
  resolved: boolean;
  outcome: number;
  winnerPool: BN;
  bump: number;
}

export interface BetRecord {
  publicKey: PublicKey;
  market: PublicKey;
  user: PublicKey;
  commitment: number[];
  amount: BN;
  isEarly: boolean;
  revealed: boolean;
  revealedOutcome: number;
  claimed: boolean;
  bump: number;
}

export interface Comment {
  publicKey: PublicKey;
  market: PublicKey;
  author: PublicKey;
  content: string;
  timestamp: number;
}

export interface UserStats {
  publicKey: PublicKey;
  user: PublicKey;
  totalBets: number;
  totalWins: number;
  winRate: number;
}

export interface MarketOdds {
  viralPercent: number;
  flopPercent: number;
  totalSOL: number;
}

export interface FeeBreakdown {
  protocolCut: number;
  creatorCut: number;
  winnerPool: number;
}

export type BetSide = "viral" | "flop";

// ─── PDA helpers ─────────────────────────────────────────────────────────────

export function getMarketPda(contentId: string): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), Buffer.from(contentId)],
    PROGRAM_ID
  );
}

export function getVaultPda(marketPubkey: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), marketPubkey.toBuffer()],
    PROGRAM_ID
  );
}

export function getBetPda(
  marketPubkey: PublicKey,
  userPubkey: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bet"), marketPubkey.toBuffer(), userPubkey.toBuffer()],
    PROGRAM_ID
  );
}

export function getCommentPda(
  marketPubkey: PublicKey,
  commentIndex: number
): [PublicKey, number] {
  const indexBuf = Buffer.alloc(8);
  indexBuf.writeBigUInt64LE(BigInt(commentIndex));
  return PublicKey.findProgramAddressSync(
    [Buffer.from("comment"), marketPubkey.toBuffer(), indexBuf],
    PROGRAM_ID
  );
}

export function getUserStatsPda(userPubkey: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("stats"), userPubkey.toBuffer()],
    PROGRAM_ID
  );
}

// ─── Commitment helpers ───────────────────────────────────────────────────────

export function generateSecret(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

export function computeCommitment(
  outcome: BetSide,
  secret: Uint8Array,
  userPubkey: PublicKey
): Uint8Array {
  const buf = new Uint8Array(65);
  buf[0] = outcome === "viral" ? 1 : 2;
  buf.set(secret, 1);
  buf.set(userPubkey.toBytes(), 33);
  return keccak_256(buf);
}

// ─── Secret localStorage ─────────────────────────────────────────────────────

function secretKey(marketPubkey: PublicKey): string {
  return `crowdcast:secret:${marketPubkey.toBase58()}`;
}

export function storeSecret(marketPubkey: PublicKey, secret: Uint8Array): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(secretKey(marketPubkey), Buffer.from(secret).toString("base64"));
}

export function retrieveSecret(marketPubkey: PublicKey): Uint8Array | null {
  if (typeof window === "undefined") return null;
  const b64 = localStorage.getItem(secretKey(marketPubkey));
  if (!b64) return null;
  return new Uint8Array(Buffer.from(b64, "base64"));
}

// ─── Program factory ─────────────────────────────────────────────────────────

function getProgram(connection: Connection, wallet: any): Program {
  const provider = new AnchorProvider(connection, wallet, AnchorProvider.defaultOptions());
  return new Program(IDL, PROGRAM_ID, provider);
}

// ─── SDK functions ────────────────────────────────────────────────────────────

export async function createMarket(
  connection: Connection,
  wallet: any,
  contentId: string,
  title: string,
  durationSeconds: number,
  mode: 0 | 1 = 0,
  protocolTreasury: PublicKey = DEVNET_TREASURY
): Promise<{ tx: string; marketPubkey: PublicKey }> {
  const program = getProgram(connection, wallet);
  const [marketPda] = getMarketPda(contentId);
  const [vaultPda] = getVaultPda(marketPda);

  const tx = await program.methods
    .createMarket(contentId, title, new BN(durationSeconds), mode)
    .accounts({
      market: marketPda,
      vault: vaultPda,
      protocolTreasury,
      authority: wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  return { tx, marketPubkey: marketPda };
}

export async function commitBet(
  connection: Connection,
  wallet: any,
  marketPubkey: PublicKey,
  outcome: BetSide,
  amountSOL: number
): Promise<string> {
  const program = getProgram(connection, wallet);
  const [vaultPda] = getVaultPda(marketPubkey);
  const [betPda] = getBetPda(marketPubkey, wallet.publicKey);
  const [userStatsPda] = getUserStatsPda(wallet.publicKey);

  const secret = generateSecret();
  const commitment = computeCommitment(outcome, secret, wallet.publicKey);
  storeSecret(marketPubkey, secret);

  const lamports = new BN(Math.floor(amountSOL * LAMPORTS_PER_SOL));

  return program.methods
    .commitBet(Array.from(commitment), lamports)
    .accounts({
      market: marketPubkey,
      vault: vaultPda,
      bet: betPda,
      userStats: userStatsPda,
      user: wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

export async function revealBet(
  connection: Connection,
  wallet: any,
  marketPubkey: PublicKey,
  outcome: BetSide
): Promise<string> {
  const program = getProgram(connection, wallet);
  const [betPda] = getBetPda(marketPubkey, wallet.publicKey);
  const [userStatsPda] = getUserStatsPda(wallet.publicKey);

  const secret = retrieveSecret(marketPubkey);
  if (!secret) throw new Error("Secret not found in localStorage");

  return program.methods
    .revealBet(outcome === "viral" ? 1 : 2, Array.from(secret))
    .accounts({
      market: marketPubkey,
      bet: betPda,
      userStats: userStatsPda,
      user: wallet.publicKey,
    })
    .rpc();
}

export async function resolveMarket(
  connection: Connection,
  wallet: any,
  marketPubkey: PublicKey
): Promise<string> {
  const program = getProgram(connection, wallet);
  const [vaultPda] = getVaultPda(marketPubkey);
  const market = await getMarket(connection, marketPubkey);
  if (!market) throw new Error("Market not found");

  return program.methods
    .resolveMarket()
    .accounts({
      market: marketPubkey,
      vault: vaultPda,
      protocolTreasury: market.protocolTreasury,
      creator: market.creator,
      authority: wallet.publicKey,
    })
    .rpc();
}

export async function claimWinnings(
  connection: Connection,
  wallet: any,
  marketPubkey: PublicKey
): Promise<string> {
  const program = getProgram(connection, wallet);
  const [vaultPda] = getVaultPda(marketPubkey);
  const [betPda] = getBetPda(marketPubkey, wallet.publicKey);
  const [userStatsPda] = getUserStatsPda(wallet.publicKey);

  return program.methods
    .claimWinnings()
    .accounts({
      market: marketPubkey,
      vault: vaultPda,
      bet: betPda,
      userStats: userStatsPda,
      user: wallet.publicKey,
    })
    .rpc();
}

export async function postComment(
  connection: Connection,
  wallet: any,
  marketPubkey: PublicKey,
  content: string
): Promise<string> {
  const program = getProgram(connection, wallet);
  const market = await getMarket(connection, marketPubkey);
  if (!market) throw new Error("Market not found");

  const commentIndex = market.commentCount.toNumber();
  const [commentPda] = getCommentPda(marketPubkey, commentIndex);

  return program.methods
    .postComment(content, new BN(commentIndex))
    .accounts({
      market: marketPubkey,
      comment: commentPda,
      author: wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

// ─── Query functions ──────────────────────────────────────────────────────────

export async function getMarket(
  connection: Connection,
  marketPubkey: PublicKey
): Promise<MarketAccount | null> {
  const program = getProgram(connection, { publicKey: PublicKey.default } as any);
  try {
    const account = await (program.account as any).market.fetch(marketPubkey);
    return { publicKey: marketPubkey, ...account };
  } catch {
    return null;
  }
}

export async function getMarketByContentId(
  connection: Connection,
  contentId: string
): Promise<MarketAccount | null> {
  const [marketPda] = getMarketPda(contentId);
  return getMarket(connection, marketPda);
}

export async function getUserBet(
  connection: Connection,
  marketPubkey: PublicKey,
  userPubkey: PublicKey
): Promise<BetRecord | null> {
  const program = getProgram(connection, { publicKey: PublicKey.default } as any);
  const [betPda] = getBetPda(marketPubkey, userPubkey);
  try {
    const account = await (program.account as any).betRecord.fetch(betPda);
    return { publicKey: betPda, ...account };
  } catch {
    return null;
  }
}

export async function getComments(
  connection: Connection,
  marketPubkey: PublicKey,
  limit = 50
): Promise<Comment[]> {
  const program = getProgram(connection, { publicKey: PublicKey.default } as any);
  try {
    // Fetch by PDA derivation using sequential indices
    const market = await getMarket(connection, marketPubkey);
    if (!market) return [];

    const count = market.commentCount.toNumber();
    const start = Math.max(0, count - limit);
    const pdas = Array.from({ length: count - start }, (_, i) =>
      getCommentPda(marketPubkey, start + i)[0]
    );
    if (pdas.length === 0) return [];

    const accounts = await Promise.allSettled(
      pdas.map((pda) => (program.account as any).comment.fetch(pda))
    );

    return accounts
      .map((result, i) => {
        if (result.status !== "fulfilled") return null;
        const a = result.value;
        return {
          publicKey: pdas[i],
          market: a.market,
          author: a.author,
          content: a.content,
          timestamp: a.timestamp.toNumber ? a.timestamp.toNumber() : Number(a.timestamp),
        } as Comment;
      })
      .filter(Boolean) as Comment[];
  } catch {
    return [];
  }
}

export async function getUserStats(
  connection: Connection,
  userPubkey: PublicKey
): Promise<UserStats | null> {
  const program = getProgram(connection, { publicKey: PublicKey.default } as any);
  const [statsPda] = getUserStatsPda(userPubkey);
  try {
    const account = await (program.account as any).userStats.fetch(statsPda);
    const totalBets = account.totalBets.toNumber ? account.totalBets.toNumber() : Number(account.totalBets);
    const totalWins = account.totalWins.toNumber ? account.totalWins.toNumber() : Number(account.totalWins);
    return {
      publicKey: statsPda,
      user: account.user,
      totalBets,
      totalWins,
      winRate: totalBets > 0 ? totalWins / totalBets : 0,
    };
  } catch {
    return null;
  }
}

export async function getCreatorStats(
  connection: Connection,
  creatorPubkey: PublicKey
): Promise<{ totalEarned: number; marketsCreated: number; totalVolume: number }> {
  try {
    const program = getProgram(connection, { publicKey: PublicKey.default } as any);
    // Filter Market accounts by creator field
    // creator field offset: 8 (disc) + 68 (content_id) + 132 (title) + 32 (authority) = 240
    const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
      filters: [
        { dataSize: 395 },
        { memcmp: { offset: 240, bytes: creatorPubkey.toBase58() } },
      ],
    });

    let totalVolume = 0;
    let totalEarned = 0;
    let marketsCreated = accounts.length;

    for (const { account, pubkey } of accounts) {
      try {
        const market = await (program.account as any).market.fetch(pubkey);
        const pot = market.totalCommitted.toNumber() / LAMPORTS_PER_SOL;
        totalVolume += pot;
        if (market.resolved) {
          totalEarned += pot * 0.03; // 3% creator fee
        }
      } catch {}
    }

    return { totalEarned, marketsCreated, totalVolume };
  } catch {
    return { totalEarned: 0, marketsCreated: 0, totalVolume: 0 };
  }
}

// ─── Odds ─────────────────────────────────────────────────────────────────────

export function computeOdds(market: MarketAccount | null): MarketOdds | null {
  if (!market) return null;
  const viral = market.totalViral.toNumber();
  const flop = market.totalFlop.toNumber();
  const total = viral + flop;
  if (total === 0) return null;
  return {
    viralPercent: Math.round((viral / total) * 100),
    flopPercent: Math.round((flop / total) * 100),
    totalSOL: total / LAMPORTS_PER_SOL,
  };
}

export function computeFeeBreakdown(totalCommittedSOL: number): FeeBreakdown {
  const protocolCut = totalCommittedSOL * 0.02;
  const creatorCut = totalCommittedSOL * 0.03;
  const winnerPool = totalCommittedSOL - protocolCut - creatorCut;
  return { protocolCut, creatorCut, winnerPool };
}

// ─── React hook: useMarket ────────────────────────────────────────────────────

export function useMarket(contentId: string, videoMode: 0 | 1 = 0) {
  const { connection } = useConnection();
  const wallet = useWallet();

  const [market, setMarket] = useState<MarketAccount | null>(null);
  const [userBet, setUserBet] = useState<BetRecord | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentStats, setCommentStats] = useState<Record<string, UserStats>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mockCommittedSOL, setMockCommittedSOL] = useState(
    parseFloat((Math.random() * 2 + 0.5).toFixed(3))
  );
  const [whaleCount, setWhaleCount] = useState(0);
  const [recentWhaleAt, setRecentWhaleAt] = useState<number | null>(null);
  const logSubId = useRef<number | null>(null);

  const [marketPubkey] = getMarketPda(contentId);

  const fetchMarket = useCallback(async () => {
    try {
      const m = await getMarket(connection, marketPubkey);
      setMarket(m);
      if (m && wallet.publicKey) {
        const bet = await getUserBet(connection, marketPubkey, wallet.publicKey);
        setUserBet(bet);
      }
    } catch {}
  }, [connection, marketPubkey, wallet.publicKey]);

  const fetchComments = useCallback(async () => {
    try {
      const c = await getComments(connection, marketPubkey, 30);
      setComments(c);
      // Lazily fetch stats for each unique author
      const authors = [...new Set(c.map((x) => x.author.toBase58()))];
      const statsResults = await Promise.allSettled(
        authors.map((a) => getUserStats(connection, new PublicKey(a)))
      );
      const map: Record<string, UserStats> = {};
      authors.forEach((a, i) => {
        const r = statsResults[i];
        if (r.status === "fulfilled" && r.value) map[a] = r.value;
      });
      setCommentStats(map);
    } catch {}
  }, [connection, marketPubkey]);

  useEffect(() => {
    fetchMarket();
    fetchComments();
  }, [fetchMarket, fetchComments]);

  // Mock committed SOL drift
  useEffect(() => {
    if (market) return;
    const id = setInterval(
      () => setMockCommittedSOL((p) => parseFloat((p + Math.random() * 0.15).toFixed(3))),
      5000
    );
    return () => clearInterval(id);
  }, [market]);

  // Whale event subscription via onLogs
  useEffect(() => {
    if (logSubId.current !== null) return;

    const id = connection.onLogs(
      PROGRAM_ID,
      ({ logs }) => {
        for (const log of logs) {
          if (!log.startsWith("Program data:")) continue;
          try {
            const b64 = log.slice("Program data: ".length).trim();
            const bytes = Buffer.from(b64, "base64");
            // Check discriminator (first 8 bytes)
            const disc = Array.from(bytes.slice(0, 8));
            const isWhale = WHALE_BET_DISCRIMINATOR.every((b, i) => b === disc[i]);
            if (!isWhale) continue;
            // Optionally decode market pubkey from bytes 8..40 and filter
            setWhaleCount((c) => c + 1);
            const now = Date.now();
            setRecentWhaleAt(now);
            // Auto-clear after 5s
            setTimeout(() => setRecentWhaleAt((prev) => (prev === now ? null : prev)), 5000);
          } catch {}
        }
      },
      "confirmed"
    );
    logSubId.current = id;

    return () => {
      if (logSubId.current !== null) {
        connection.removeOnLogsListener(logSubId.current);
        logSubId.current = null;
      }
    };
  }, [connection]);

  // ─── Phase flags ────────────────────────────────────────────────────────────
  const nowSec = Math.floor(Date.now() / 1000);
  const endTime = market?.endTime.toNumber() ?? null;
  const earlyWindowEnd = market?.earlyWindowEnd.toNumber() ?? null;

  const bettingClosed = endTime !== null && nowSec >= endTime;
  const revealWindowClosed = endTime !== null && nowSec >= endTime + REVEAL_WINDOW_SECONDS;
  const isEarlyWindow = earlyWindowEnd !== null && nowSec <= earlyWindowEnd && !bettingClosed;
  const earlyWindowSecondsLeft = isEarlyWindow && earlyWindowEnd ? Math.max(0, earlyWindowEnd - nowSec) : 0;
  const canReveal = bettingClosed && !revealWindowClosed && userBet !== null && !userBet.revealed;

  const odds = revealWindowClosed ? computeOdds(market) : null;
  const totalCommittedSOL = market
    ? market.totalCommitted.toNumber() / LAMPORTS_PER_SOL
    : mockCommittedSOL;

  const feeBreakdown = computeFeeBreakdown(totalCommittedSOL);

  // ─── Actions ────────────────────────────────────────────────────────────────

  const handleCommitBet = useCallback(
    async (outcome: BetSide, amountSOL: number) => {
      if (!wallet.publicKey) throw new Error("Wallet not connected");
      setLoading(true);
      setError(null);
      try {
        if (!market) {
          try {
            await createMarket(
              connection, wallet, contentId, contentId, 300, videoMode, DEVNET_TREASURY
            );
          } catch {}
        }
        await commitBet(connection, wallet, marketPubkey, outcome, amountSOL);
        await fetchMarket();
      } catch (e: any) {
        setError(e.message ?? "Transaction failed");
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [connection, wallet, market, contentId, videoMode, marketPubkey, fetchMarket]
  );

  const handleRevealBet = useCallback(async () => {
    if (!wallet.publicKey || !userBet) throw new Error("Nothing to reveal");
    setLoading(true);
    setError(null);
    try {
      const secret = retrieveSecret(marketPubkey);
      if (!secret) throw new Error("Secret not found");
      const viralHash = computeCommitment("viral", secret, wallet.publicKey);
      const stored = new Uint8Array(userBet.commitment as number[]);
      const isViral = arraysEqual(viralHash, stored);
      await revealBet(connection, wallet, marketPubkey, isViral ? "viral" : "flop");
      await fetchMarket();
    } catch (e: any) {
      setError(e.message ?? "Reveal failed");
      throw e;
    } finally {
      setLoading(false);
    }
  }, [connection, wallet, marketPubkey, userBet, fetchMarket]);

  const handleClaimWinnings = useCallback(async () => {
    if (!wallet.publicKey) throw new Error("Wallet not connected");
    setLoading(true);
    setError(null);
    try {
      await claimWinnings(connection, wallet, marketPubkey);
      await fetchMarket();
    } catch (e: any) {
      setError(e.message ?? "Claim failed");
      throw e;
    } finally {
      setLoading(false);
    }
  }, [connection, wallet, marketPubkey, fetchMarket]);

  const handleResolveMarket = useCallback(async () => {
    if (!wallet.publicKey) throw new Error("Wallet not connected");
    setLoading(true);
    try {
      await resolveMarket(connection, wallet, marketPubkey);
      await fetchMarket();
    } finally {
      setLoading(false);
    }
  }, [connection, wallet, marketPubkey, fetchMarket]);

  const handlePostComment = useCallback(
    async (content: string) => {
      if (!wallet.publicKey) throw new Error("Wallet not connected");
      setLoading(true);
      setError(null);
      try {
        await postComment(connection, wallet, marketPubkey, content);
        await fetchComments();
      } catch (e: any) {
        setError(e.message ?? "Comment failed");
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [connection, wallet, marketPubkey, fetchComments]
  );

  return {
    market,
    marketPubkey,
    userBet,
    odds,
    totalCommittedSOL,
    feeBreakdown,
    bettingClosed,
    revealWindowClosed,
    isEarlyWindow,
    earlyWindowSecondsLeft,
    canReveal,
    whaleCount,
    recentWhaleAt,
    comments,
    commentStats,
    loading,
    error,
    commitBet: handleCommitBet,
    revealBet: handleRevealBet,
    claimWinnings: handleClaimWinnings,
    resolveMarket: handleResolveMarket,
    postComment: handlePostComment,
    refresh: fetchMarket,
  };
}

// ─── Util ─────────────────────────────────────────────────────────────────────

function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
