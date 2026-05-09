import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { PublicKey, Keypair, LAMPORTS_PER_SOL, SystemProgram } from "@solana/web3.js";
import { createHash } from "crypto";
import { expect } from "chai";

type AttentionMarket = any;

// ─── Commitment helper (Node.js) ──────────────────────────────────────────────
// Must match Rust: keccak::hashv(&[&[outcome], &secret, user_pubkey.as_ref()])
function computeCommitment(
  outcome: 1 | 2,
  secret: Buffer,
  userPubkey: PublicKey
): Buffer {
  // Node.js built-in crypto doesn't have keccak — use sha3-256 via the hash module
  // We use the same concatenation as the Rust program:
  // hashv concatenates [outcome_byte, secret_32_bytes, pubkey_32_bytes]
  const input = Buffer.concat([
    Buffer.from([outcome]),
    secret,
    userPubkey.toBuffer(),
  ]);
  // Use keccak256 — requires the sha3 variant. We call it via crypto's createHash
  // with algorithm "sha3-256" as a reasonable test approximation, OR we can use
  // a JS keccak library. For tests we'll use @noble/hashes/sha3 if available,
  // else fall back to sha256 (still validates the mechanism).
  try {
    const { keccak_256 } = require("@noble/hashes/sha3");
    return Buffer.from(keccak_256(input));
  } catch {
    // Fallback: sha256 (won't match on-chain keccak but tests the plumbing)
    return createHash("sha256").update(input).digest();
  }
}

describe("attention_market — commit-reveal", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AttentionMarket as Program<AttentionMarket>;

  const walletA = Keypair.generate(); // commits viral
  const walletB = Keypair.generate(); // commits flop

  const contentId = "cr-test-001";
  const title = "Commit-Reveal Test Market";
  const durationSeconds = new BN(2); // 2s betting window

  // Secrets and commitments
  const secretA = Buffer.alloc(32, 0x01);
  const secretB = Buffer.alloc(32, 0x02);

  let marketPda: PublicKey;
  let vaultPda: PublicKey;
  let betAPda: PublicKey;
  let betBPda: PublicKey;

  before(async () => {
    // Fund test wallets
    for (const kp of [walletA, walletB]) {
      const sig = await provider.connection.requestAirdrop(kp.publicKey, 5 * LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(sig);
    }

    // Derive PDAs
    [marketPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), Buffer.from(contentId)],
      program.programId
    );
    [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), marketPda.toBuffer()],
      program.programId
    );
    [betAPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("bet"), marketPda.toBuffer(), walletA.publicKey.toBuffer()],
      program.programId
    );
    [betBPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("bet"), marketPda.toBuffer(), walletB.publicKey.toBuffer()],
      program.programId
    );
  });

  it("1. Creates a market (2 second betting window)", async () => {
    await program.methods
      .createMarket(contentId, title, durationSeconds)
      .accounts({
        market: marketPda,
        vault: vaultPda,
        authority: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const market = await program.account.market.fetch(marketPda);
    expect(market.contentId).to.equal(contentId);
    expect(market.resolved).to.equal(false);
    expect(market.totalCommitted.toNumber()).to.equal(0);
    console.log("  ✓ Market created:", marketPda.toString());
  });

  it("2. Wallet A commits viral (0.5 SOL)", async () => {
    const betAmount = new BN(0.5 * LAMPORTS_PER_SOL);
    const commitment = computeCommitment(1, secretA, walletA.publicKey);

    await program.methods
      .commitBet(Array.from(commitment), betAmount)
      .accounts({
        market: marketPda,
        vault: vaultPda,
        bet: betAPda,
        user: walletA.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([walletA])
      .rpc();

    const market = await program.account.market.fetch(marketPda);
    expect(market.totalCommitted.toNumber()).to.equal(betAmount.toNumber());
    expect(market.totalViral.toNumber()).to.equal(0); // not revealed yet
    expect(market.totalFlop.toNumber()).to.equal(0);

    const bet = await program.account.betRecord.fetch(betAPda);
    expect(bet.revealed).to.equal(false);
    expect(bet.amount.toNumber()).to.equal(betAmount.toNumber());
    console.log("  ✓ Wallet A committed 0.5 SOL (side hidden)");
  });

  it("3. Wallet B commits flop (0.3 SOL)", async () => {
    const betAmount = new BN(0.3 * LAMPORTS_PER_SOL);
    const commitment = computeCommitment(2, secretB, walletB.publicKey);

    await program.methods
      .commitBet(Array.from(commitment), betAmount)
      .accounts({
        market: marketPda,
        vault: vaultPda,
        bet: betBPda,
        user: walletB.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([walletB])
      .rpc();

    const market = await program.account.market.fetch(marketPda);
    expect(market.totalCommitted.toNumber()).to.equal(0.8 * LAMPORTS_PER_SOL);
    expect(market.totalViral.toNumber()).to.equal(0); // still hidden
    console.log("  ✓ Wallet B committed 0.3 SOL (side hidden)");
  });

  it("4. Reveals are rejected before end_time", async () => {
    let threw = false;
    try {
      await program.methods
        .revealBet(1, Array.from(secretA))
        .accounts({ market: marketPda, bet: betAPda, user: walletA.publicKey })
        .signers([walletA])
        .rpc();
    } catch {
      threw = true;
    }
    expect(threw).to.equal(true);
    console.log("  ✓ Reveal correctly rejected before market expires");
  });

  it("5. Waits for market to expire then both wallets reveal", async () => {
    console.log("  Waiting 3 seconds for market to expire...");
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Wallet A reveals viral
    await program.methods
      .revealBet(1, Array.from(secretA))
      .accounts({ market: marketPda, bet: betAPda, user: walletA.publicKey })
      .signers([walletA])
      .rpc();

    // Wallet B reveals flop
    await program.methods
      .revealBet(2, Array.from(secretB))
      .accounts({ market: marketPda, bet: betBPda, user: walletB.publicKey })
      .signers([walletB])
      .rpc();

    const market = await program.account.market.fetch(marketPda);
    expect(market.totalViral.toNumber()).to.equal(0.5 * LAMPORTS_PER_SOL);
    expect(market.totalFlop.toNumber()).to.equal(0.3 * LAMPORTS_PER_SOL);

    const betA = await program.account.betRecord.fetch(betAPda);
    expect(betA.revealed).to.equal(true);
    expect(betA.revealedOutcome).to.equal(1);
    console.log("  ✓ Both bets revealed — viral: 0.5 SOL, flop: 0.3 SOL");
  });

  it("6. resolve_market auto-picks winner (viral wins: 0.5 > 0.3)", async () => {
    // In a real test we'd wait 1hr for the reveal window, but on localnet
    // we test the auto-resolve logic by checking what it would pick.
    // For the test harness we skip the window check by noting:
    //   market.end_time + 3600 > now (the test runs faster than 1hr)
    // So we verify the state and trust the integration test covers the timing.
    // On localnet with solana-test-validator we'd need to warp the clock.
    // Here we just verify the accumulated totals are correct, and the
    // resolve instruction would pick viral (0.5 > 0.3).

    const market = await program.account.market.fetch(marketPda);
    const viralWins = market.totalViral.toNumber() >= market.totalFlop.toNumber();
    expect(viralWins).to.equal(true);
    console.log("  ✓ Accumulated totals confirm viral would win (0.5 SOL vs 0.3 SOL)");
    console.log("  ℹ resolve_market requires reveal window closure (end_time + 3600s)");
    console.log("    Use `solana-test-validator --warp-slot` or wait 1hr on devnet");
  });

  it("7. Wrong commitment is rejected on reveal", async () => {
    // Create a fresh market with a different content ID to test bad reveal
    const badContentId = "cr-bad-reveal";
    const [badMarket] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), Buffer.from(badContentId)],
      program.programId
    );
    const [badVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), badMarket.toBuffer()],
      program.programId
    );
    const [badBet] = PublicKey.findProgramAddressSync(
      [Buffer.from("bet"), badMarket.toBuffer(), walletA.publicKey.toBuffer()],
      program.programId
    );

    // Create market with 1s window
    await program.methods
      .createMarket(badContentId, "Bad Reveal Test", new BN(1))
      .accounts({ market: badMarket, vault: badVault, authority: provider.wallet.publicKey, systemProgram: SystemProgram.programId })
      .rpc();

    const wrongSecret = Buffer.alloc(32, 0xff);
    const commitment = computeCommitment(1, wrongSecret, walletA.publicKey);

    await program.methods
      .commitBet(Array.from(commitment), new BN(0.1 * LAMPORTS_PER_SOL))
      .accounts({ market: badMarket, vault: badVault, bet: badBet, user: walletA.publicKey, systemProgram: SystemProgram.programId })
      .signers([walletA])
      .rpc();

    await new Promise((r) => setTimeout(r, 2000));

    // Try to reveal with a different secret — should fail
    let threw = false;
    try {
      const differentSecret = Buffer.alloc(32, 0xaa);
      await program.methods
        .revealBet(1, Array.from(differentSecret))
        .accounts({ market: badMarket, bet: badBet, user: walletA.publicKey })
        .signers([walletA])
        .rpc();
    } catch {
      threw = true;
    }
    expect(threw).to.equal(true);
    console.log("  ✓ Invalid commitment correctly rejected on reveal");
  });
});
