import {
  Connection,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { Program, AnchorProvider, BN, Idl } from "@coral-xyz/anchor";
import { keccak_256 } from "@noble/hashes/sha3";
import { useCallback, useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";

// ─── Program ID ──────────────────────────────────────────────────────────────

export const PROGRAM_ID = new PublicKey(
  "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS"
);

export const REVEAL_WINDOW_SECONDS = 3600; // must match REVEAL_WINDOW const in lib.rs

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
        { name: "authority", isMut: true, isSigner: true },
        { name: "systemProgram", isMut: false, isSigner: false },
      ],
      args: [
        { name: "contentId", type: "string" },
        { name: "title", type: "string" },
        { name: "durationSeconds", type: "i64" },
      ],
    },
    {
      name: "commitBet",
      accounts: [
        { name: "market", isMut: true, isSigner: false },
        { name: "vault", isMut: true, isSigner: false },
        { name: "bet", isMut: true, isSigner: false },
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
        { name: "user", isMut: true, isSigner: false },
      ],
      args: [],
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
          { name: "totalCommitted", type: "u64" },
          { name: "totalViral", type: "u64" },
          { name: "totalFlop", type: "u64" },
          { name: "endTime", type: "i64" },
          { name: "resolved", type: "bool" },
          { name: "outcome", type: "u8" },
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
          { name: "revealed", type: "bool" },
          { name: "revealedOutcome", type: "u8" },
          { name: "claimed", type: "bool" },
          { name: "bump", type: "u8" },
        ],
      },
    },
  ],
  errors: [
    { code: 6000, name: "ContentIdTooLong", msg: "Content ID exceeds 64 characters" },
    { code: 6001, name: "TitleTooLong", msg: "Title exceeds 128 characters" },
    { code: 6002, name: "InvalidDuration", msg: "Duration must be positive" },
    { code: 6003, name: "InvalidOutcome", msg: "Outcome must be 1 (viral) or 2 (flop)" },
    { code: 6004, name: "InvalidAmount", msg: "Amount must be greater than zero" },
    { code: 6005, name: "MarketAlreadyResolved", msg: "Market has already been resolved" },
    { code: 6006, name: "MarketExpired", msg: "Market betting period has expired" },
    { code: 6007, name: "MarketNotExpired", msg: "Market has not yet expired" },
    { code: 6008, name: "RevealWindowNotClosed", msg: "Reveal window (1hr) has not closed yet" },
    { code: 6009, name: "MarketNotResolved", msg: "Market has not been resolved yet" },
    { code: 6010, name: "AlreadyClaimed", msg: "Winnings already claimed" },
    { code: 6011, name: "DidNotWin", msg: "Your bet did not win" },
    { code: 6012, name: "NoWinners", msg: "No winners on the winning side" },
    { code: 6013, name: "Overflow", msg: "Arithmetic overflow" },
    { code: 6014, name: "InvalidCommitment", msg: "Commitment hash does not match" },
    { code: 6015, name: "BetAlreadyRevealed", msg: "Bet has already been revealed" },
    { code: 6016, name: "RevealWindowClosed", msg: "Reveal window has closed — bet is forfeited" },
    { code: 6017, name: "BetNotRevealed", msg: "Bet must be revealed before claiming" },
  ],
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MarketAccount {
  publicKey: PublicKey;
  contentId: string;
  title: string;
  authority: PublicKey;
  totalCommitted: BN;
  totalViral: BN;
  totalFlop: BN;
  endTime: BN;
  resolved: boolean;
  outcome: number; // 0 = unresolved, 1 = viral, 2 = flop
  bump: number;
}

export interface BetRecord {
  publicKey: PublicKey;
  market: PublicKey;
  user: PublicKey;
  commitment: number[]; // [u8; 32]
  amount: BN;
  revealed: boolean;
  revealedOutcome: number;
  claimed: boolean;
  bump: number;
}

export interface MarketOdds {
  viralPercent: number;
  flopPercent: number;
  totalSOL: number;
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

// ─── Commitment helpers ───────────────────────────────────────────────────────

/** Generates 32 cryptographically-random bytes as the bet secret. */
export function generateSecret(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

/**
 * Computes keccak256([outcome_byte, ...secret, ...userPubkey]).
 * Must produce the same digest as Rust's:
 *   keccak::hashv(&[&[outcome], &secret, user_pubkey.as_ref()])
 */
export function computeCommitment(
  outcome: BetSide,
  secret: Uint8Array,
  userPubkey: PublicKey
): Uint8Array {
  const buf = new Uint8Array(65); // 1 + 32 + 32
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
  const b64 = Buffer.from(secret).toString("base64");
  localStorage.setItem(secretKey(marketPubkey), b64);
}

export function retrieveSecret(marketPubkey: PublicKey): Uint8Array | null {
  if (typeof window === "undefined") return null;
  const b64 = localStorage.getItem(secretKey(marketPubkey));
  if (!b64) return null;
  return new Uint8Array(Buffer.from(b64, "base64"));
}

// ─── Program factory ─────────────────────────────────────────────────────────

function getProgram(connection: Connection, wallet: any): Program {
  const provider = new AnchorProvider(
    connection,
    wallet,
    AnchorProvider.defaultOptions()
  );
  return new Program(IDL, PROGRAM_ID, provider);
}

// ─── SDK functions ────────────────────────────────────────────────────────────

export async function createMarket(
  connection: Connection,
  wallet: any,
  contentId: string,
  title: string,
  durationSeconds: number
): Promise<{ tx: string; marketPubkey: PublicKey }> {
  const program = getProgram(connection, wallet);
  const [marketPda] = getMarketPda(contentId);
  const [vaultPda] = getVaultPda(marketPda);

  const tx = await program.methods
    .createMarket(contentId, title, new BN(durationSeconds))
    .accounts({
      market: marketPda,
      vault: vaultPda,
      authority: wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  return { tx, marketPubkey: marketPda };
}

/**
 * Commits a bet: generates a secret, stores it in localStorage, computes
 * commitment hash, transfers SOL, and records the commitment on-chain.
 * The bet side is NOT visible on-chain until reveal phase.
 */
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
      user: wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

/**
 * Reveals a previously committed bet.
 * Retrieves the secret from localStorage automatically.
 * Must be called during the reveal window (end_time to end_time + 1hr).
 */
export async function revealBet(
  connection: Connection,
  wallet: any,
  marketPubkey: PublicKey,
  outcome: BetSide
): Promise<string> {
  const program = getProgram(connection, wallet);
  const [betPda] = getBetPda(marketPubkey, wallet.publicKey);

  const secret = retrieveSecret(marketPubkey);
  if (!secret) throw new Error("Secret not found in localStorage. Cannot reveal.");

  const outcomeNum = outcome === "viral" ? 1 : 2;

  return program.methods
    .revealBet(outcomeNum, Array.from(secret))
    .accounts({
      market: marketPubkey,
      bet: betPda,
      user: wallet.publicKey,
    })
    .rpc();
}

/** Resolves the market after the reveal window closes. Outcome is auto-computed. */
export async function resolveMarket(
  connection: Connection,
  wallet: any,
  marketPubkey: PublicKey
): Promise<string> {
  const program = getProgram(connection, wallet);

  return program.methods
    .resolveMarket()
    .accounts({
      market: marketPubkey,
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

  return program.methods
    .claimWinnings()
    .accounts({
      market: marketPubkey,
      vault: vaultPda,
      bet: betPda,
      user: wallet.publicKey,
    })
    .rpc();
}

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

// ─── Odds ─────────────────────────────────────────────────────────────────────

/** Returns odds only if both sides have been revealed (after reveal window). */
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

// ─── React hook: useMarket ────────────────────────────────────────────────────

export function useMarket(contentId: string) {
  const { connection } = useConnection();
  const wallet = useWallet();

  const [market, setMarket] = useState<MarketAccount | null>(null);
  const [userBet, setUserBet] = useState<BetRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mock total committed — drifts upward during active betting to simulate activity
  const [mockCommittedSOL, setMockCommittedSOL] = useState(
    parseFloat((Math.random() * 2 + 0.5).toFixed(3))
  );

  const [marketPubkey] = getMarketPda(contentId);

  const fetchMarket = useCallback(async () => {
    try {
      const m = await getMarket(connection, marketPubkey);
      setMarket(m);

      if (m && wallet.publicKey) {
        const bet = await getUserBet(connection, marketPubkey, wallet.publicKey);
        setUserBet(bet);
      }
    } catch {
      // fall back to mock state
    }
  }, [connection, marketPubkey, wallet.publicKey]);

  useEffect(() => {
    fetchMarket();
  }, [fetchMarket]);

  // Drift mock committed SOL every 5s during active betting (no side info leaked)
  useEffect(() => {
    if (market) return;
    const interval = setInterval(() => {
      setMockCommittedSOL((prev) =>
        parseFloat((prev + Math.random() * 0.15).toFixed(3))
      );
    }, 5000);
    return () => clearInterval(interval);
  }, [market]);

  // ─── Phase flags ────────────────────────────────────────────────────────────
  const nowSec = Math.floor(Date.now() / 1000);
  const endTime = market?.endTime.toNumber() ?? null;
  const bettingClosed = endTime !== null && nowSec >= endTime;
  const revealWindowClosed =
    endTime !== null && nowSec >= endTime + REVEAL_WINDOW_SECONDS;

  const canReveal =
    bettingClosed &&
    !revealWindowClosed &&
    userBet !== null &&
    !userBet.revealed;

  // ─── Odds (only visible after reveal window) ─────────────────────────────
  const odds = revealWindowClosed ? computeOdds(market) : null;

  const totalCommittedSOL = market
    ? market.totalCommitted.toNumber() / LAMPORTS_PER_SOL
    : mockCommittedSOL;

  // ─── Actions ────────────────────────────────────────────────────────────────

  const handleCommitBet = useCallback(
    async (outcome: BetSide, amountSOL: number) => {
      if (!wallet.publicKey || !wallet.signTransaction) {
        throw new Error("Wallet not connected");
      }
      setLoading(true);
      setError(null);
      try {
        if (!market) {
          try {
            await createMarket(connection, wallet, contentId, contentId, 300);
          } catch {
            // already exists — continue
          }
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
    [connection, wallet, market, contentId, marketPubkey, fetchMarket]
  );

  const handleRevealBet = useCallback(async () => {
    if (!wallet.publicKey || !userBet) throw new Error("Nothing to reveal");
    setLoading(true);
    setError(null);
    try {
      const side: BetSide = userBet.revealedOutcome === 1 ? "viral" : "flop";
      // Retrieve side from localStorage via the bet record's stored commitment
      // We need to know which side — read it from localStorage indirectly
      // by checking which side produces the matching commitment
      const secret = retrieveSecret(marketPubkey);
      if (!secret) throw new Error("Secret not found");
      // Try viral first, then flop
      const viralCommitment = computeCommitment("viral", secret, wallet.publicKey);
      const storedCommitment = new Uint8Array(userBet.commitment as number[]);
      const revealSide: BetSide = arraysEqual(viralCommitment, storedCommitment)
        ? "viral"
        : "flop";
      await revealBet(connection, wallet, marketPubkey, revealSide);
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

  return {
    market,
    marketPubkey,
    userBet,
    odds,
    totalCommittedSOL,
    bettingClosed,
    revealWindowClosed,
    canReveal,
    loading,
    error,
    commitBet: handleCommitBet,
    revealBet: handleRevealBet,
    claimWinnings: handleClaimWinnings,
    resolveMarket: handleResolveMarket,
    refresh: fetchMarket,
  };
}

// ─── Util ─────────────────────────────────────────────────────────────────────

function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
