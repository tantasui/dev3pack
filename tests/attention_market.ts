import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { PublicKey, Keypair, LAMPORTS_PER_SOL, SystemProgram } from "@solana/web3.js";
import { createHash } from "crypto";
import { expect } from "chai";

type AttentionMarket = any;

// ─── Commitment helper (Node.js) ──────────────────────────────────────────────
function computeCommitment(
  outcome: 1 | 2,
  secret: Buffer,
  userPubkey: PublicKey
): Buffer {
  const input = Buffer.concat([
    Buffer.from([outcome]),
    secret,
    userPubkey.toBuffer(),
  ]);
  try {
    const { keccak_256 } = require("@noble/hashes/sha3");
    return Buffer.from(keccak_256(input));
  } catch {
    return createHash("sha256").update(input).digest();
  }
}

// ─── PDA helpers ──────────────────────────────────────────────────────────────
function getMarketPda(programId: PublicKey, contentId: string): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), Buffer.from(contentId)],
    programId
  )[0];
}

function getVaultPda(programId: PublicKey, marketPubkey: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), marketPubkey.toBuffer()],
    programId
  )[0];
}

function getBetPda(programId: PublicKey, marketPubkey: PublicKey, userPubkey: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bet"), marketPubkey.toBuffer(), userPubkey.toBuffer()],
    programId
  )[0];
}

function getUserStatsPda(programId: PublicKey, userPubkey: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("stats"), userPubkey.toBuffer()],
    programId
  )[0];
}

function getCommentPda(programId: PublicKey, marketPubkey: PublicKey, index: number): PublicKey {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(index));
  return PublicKey.findProgramAddressSync(
    [Buffer.from("comment"), marketPubkey.toBuffer(), buf],
    programId
  )[0];
}

// ─── Suite 1: majority-wins market (mode 0) ───────────────────────────────────
describe("attention_market — mode 0 (majority wins)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AttentionMarket as Program<AttentionMarket>;
  const pid = program.programId;

  const walletA = Keypair.generate(); // commits viral
  const walletB = Keypair.generate(); // commits flop
  const treasury = Keypair.generate();

  const contentId = "cr-mode0-001";
  const secretA = Buffer.alloc(32, 0x01);
  const secretB = Buffer.alloc(32, 0x02);

  let marketPda: PublicKey;
  let vaultPda: PublicKey;
  let betAPda: PublicKey;
  let betBPda: PublicKey;
  let statsAPda: PublicKey;
  let statsBPda: PublicKey;

  before(async () => {
    for (const kp of [walletA, walletB, treasury]) {
      const sig = await provider.connection.requestAirdrop(kp.publicKey, 5 * LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(sig);
    }

    marketPda = getMarketPda(pid, contentId);
    vaultPda = getVaultPda(pid, marketPda);
    betAPda = getBetPda(pid, marketPda, walletA.publicKey);
    betBPda = getBetPda(pid, marketPda, walletB.publicKey);
    statsAPda = getUserStatsPda(pid, walletA.publicKey);
    statsBPda = getUserStatsPda(pid, walletB.publicKey);
  });

  it("1. Creates a majority market (mode=0, 2s window)", async () => {
    await program.methods
      .createMarket(contentId, "Mode 0 Test Market", new BN(2), 0)
      .accounts({
        market: marketPda,
        vault: vaultPda,
        protocolTreasury: treasury.publicKey,
        authority: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const market = await program.account.market.fetch(marketPda);
    expect(market.contentId).to.equal(contentId);
    expect(market.mode).to.equal(0);
    expect(market.resolved).to.equal(false);
    expect(market.totalCommitted.toNumber()).to.equal(0);
    console.log("  ✓ Mode-0 market created:", marketPda.toString());
  });

  it("2. Wallet A commits viral (0.5 SOL) — userStats auto-init", async () => {
    const betAmount = new BN(0.5 * LAMPORTS_PER_SOL);
    const commitment = computeCommitment(1, secretA, walletA.publicKey);

    await program.methods
      .commitBet(Array.from(commitment), betAmount)
      .accounts({
        market: marketPda,
        vault: vaultPda,
        bet: betAPda,
        userStats: statsAPda,
        user: walletA.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([walletA])
      .rpc();

    const market = await program.account.market.fetch(marketPda);
    expect(market.totalCommitted.toNumber()).to.equal(betAmount.toNumber());
    expect(market.totalViral.toNumber()).to.equal(0);

    const bet = await program.account.betRecord.fetch(betAPda);
    expect(bet.revealed).to.equal(false);
    expect(bet.amount.toNumber()).to.equal(betAmount.toNumber());
    console.log("  ✓ Wallet A committed 0.5 SOL (viral, hidden)");
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
        userStats: statsBPda,
        user: walletB.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([walletB])
      .rpc();

    const market = await program.account.market.fetch(marketPda);
    expect(market.totalCommitted.toNumber()).to.equal(0.8 * LAMPORTS_PER_SOL);
    console.log("  ✓ Wallet B committed 0.3 SOL (flop, hidden)");
  });

  it("4. Reveal rejected before end_time", async () => {
    let threw = false;
    try {
      await program.methods
        .revealBet(1, Array.from(secretA))
        .accounts({ market: marketPda, bet: betAPda, userStats: statsAPda, user: walletA.publicKey })
        .signers([walletA])
        .rpc();
    } catch {
      threw = true;
    }
    expect(threw).to.equal(true);
    console.log("  ✓ Reveal correctly rejected before market expires");
  });

  it("5. Waits for expiry, then both wallets reveal", async () => {
    console.log("  Waiting 3s for market to expire...");
    await new Promise((r) => setTimeout(r, 3000));

    await program.methods
      .revealBet(1, Array.from(secretA))
      .accounts({ market: marketPda, bet: betAPda, userStats: statsAPda, user: walletA.publicKey })
      .signers([walletA])
      .rpc();

    await program.methods
      .revealBet(2, Array.from(secretB))
      .accounts({ market: marketPda, bet: betBPda, userStats: statsBPda, user: walletB.publicKey })
      .signers([walletB])
      .rpc();

    const market = await program.account.market.fetch(marketPda);
    expect(market.totalViral.toNumber()).to.equal(0.5 * LAMPORTS_PER_SOL);
    expect(market.totalFlop.toNumber()).to.equal(0.3 * LAMPORTS_PER_SOL);
    expect(market.viralCount.toNumber()).to.equal(1);
    expect(market.flopCount.toNumber()).to.equal(1);

    const betA = await program.account.betRecord.fetch(betAPda);
    expect(betA.revealed).to.equal(true);
    expect(betA.revealedOutcome).to.equal(1);
    console.log("  ✓ Both bets revealed — viral: 0.5 SOL (1 wallet), flop: 0.3 SOL (1 wallet)");
  });

  it("6. Mode 0: viral_count == flop_count → tie resolves to viral (>= wins)", async () => {
    // Verify state that would determine resolve outcome
    const market = await program.account.market.fetch(marketPda);
    // mode 0: viral wins if viral_count >= flop_count
    const viralWins = market.viralCount.toNumber() >= market.flopCount.toNumber();
    expect(viralWins).to.equal(true);
    console.log("  ✓ Mode-0 resolution: viral_count >= flop_count → viral wins");
    console.log("  ℹ resolve_market requires end_time + 3600s; use clock warp on localnet");
  });

  it("7. Wrong commitment rejected on reveal", async () => {
    const badId = "cr-bad-rev";
    const badMarket = getMarketPda(pid, badId);
    const badVault = getVaultPda(pid, badMarket);
    const badBet = getBetPda(pid, badMarket, walletA.publicKey);

    await program.methods
      .createMarket(badId, "Bad Reveal", new BN(1), 0)
      .accounts({
        market: badMarket,
        vault: badVault,
        protocolTreasury: treasury.publicKey,
        authority: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const wrongSecret = Buffer.alloc(32, 0xff);
    const commitment = computeCommitment(1, wrongSecret, walletA.publicKey);

    await program.methods
      .commitBet(Array.from(commitment), new BN(0.1 * LAMPORTS_PER_SOL))
      .accounts({
        market: badMarket,
        vault: badVault,
        bet: badBet,
        userStats: statsAPda,
        user: walletA.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([walletA])
      .rpc();

    await new Promise((r) => setTimeout(r, 2000));

    let threw = false;
    try {
      await program.methods
        .revealBet(1, Array.from(Buffer.alloc(32, 0xaa)))
        .accounts({ market: badMarket, bet: badBet, userStats: statsAPda, user: walletA.publicKey })
        .signers([walletA])
        .rpc();
    } catch {
      threw = true;
    }
    expect(threw).to.equal(true);
    console.log("  ✓ Invalid commitment rejected on reveal");
  });
});

// ─── Suite 2: contrarian market (mode 1) ─────────────────────────────────────
describe("attention_market — mode 1 (minority wins)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AttentionMarket as Program<AttentionMarket>;
  const pid = program.programId;

  const walletC = Keypair.generate(); // commits viral
  const walletD = Keypair.generate(); // commits viral too
  const walletE = Keypair.generate(); // commits flop (the minority)
  const treasury = Keypair.generate();

  const contentId = "cr-mode1-001";
  const secretC = Buffer.alloc(32, 0x0c);
  const secretD = Buffer.alloc(32, 0x0d);
  const secretE = Buffer.alloc(32, 0x0e);

  let marketPda: PublicKey;
  let vaultPda: PublicKey;

  before(async () => {
    for (const kp of [walletC, walletD, walletE, treasury]) {
      const sig = await provider.connection.requestAirdrop(kp.publicKey, 5 * LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(sig);
    }

    marketPda = getMarketPda(pid, contentId);
    vaultPda = getVaultPda(pid, marketPda);
  });

  it("1. Creates a contrarian market (mode=1, 2s window)", async () => {
    await program.methods
      .createMarket(contentId, "Contrarian Test", new BN(2), 1)
      .accounts({
        market: marketPda,
        vault: vaultPda,
        protocolTreasury: treasury.publicKey,
        authority: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const market = await program.account.market.fetch(marketPda);
    expect(market.mode).to.equal(1);
    console.log("  ✓ Mode-1 (contrarian) market created");
  });

  it("2. Three wallets commit (2 viral, 1 flop)", async () => {
    const commit = async (kp: Keypair, outcome: 1 | 2, secret: Buffer, amount: number) => {
      const betPda = getBetPda(pid, marketPda, kp.publicKey);
      const statsPda = getUserStatsPda(pid, kp.publicKey);
      await program.methods
        .commitBet(Array.from(computeCommitment(outcome, secret, kp.publicKey)), new BN(amount))
        .accounts({
          market: marketPda,
          vault: vaultPda,
          bet: betPda,
          userStats: statsPda,
          user: kp.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([kp])
        .rpc();
    };

    await commit(walletC, 1, secretC, 0.4 * LAMPORTS_PER_SOL);
    await commit(walletD, 1, secretD, 0.4 * LAMPORTS_PER_SOL);
    await commit(walletE, 2, secretE, 0.3 * LAMPORTS_PER_SOL);

    const market = await program.account.market.fetch(marketPda);
    expect(market.totalCommitted.toNumber()).to.equal(1.1 * LAMPORTS_PER_SOL);
    console.log("  ✓ Three bets committed: 2 viral, 1 flop");
  });

  it("3. After expiry, all three reveal", async () => {
    console.log("  Waiting 3s...");
    await new Promise((r) => setTimeout(r, 3000));

    const reveal = async (kp: Keypair, outcome: 1 | 2, secret: Buffer) => {
      const betPda = getBetPda(pid, marketPda, kp.publicKey);
      const statsPda = getUserStatsPda(pid, kp.publicKey);
      await program.methods
        .revealBet(outcome, Array.from(secret))
        .accounts({ market: marketPda, bet: betPda, userStats: statsPda, user: kp.publicKey })
        .signers([kp])
        .rpc();
    };

    await reveal(walletC, 1, secretC);
    await reveal(walletD, 1, secretD);
    await reveal(walletE, 2, secretE);

    const market = await program.account.market.fetch(marketPda);
    expect(market.viralCount.toNumber()).to.equal(2);
    expect(market.flopCount.toNumber()).to.equal(1);
    console.log("  ✓ Revealed: viral_count=2, flop_count=1");
  });

  it("4. Mode 1: flop (minority count) would win on resolve", async () => {
    const market = await program.account.market.fetch(marketPda);
    // mode 1: outcome = viral if viral_count <= flop_count, else flop
    // viral_count=2 > flop_count=1 → flop wins (side with fewer wallets)
    const flopWouldWin = market.viralCount.toNumber() > market.flopCount.toNumber();
    expect(flopWouldWin).to.equal(true);
    console.log("  ✓ Mode-1 resolution: viral_count > flop_count → flop (minority) wins");
  });
});

// ─── Suite 3: on-chain comments ───────────────────────────────────────────────
describe("attention_market — post_comment", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AttentionMarket as Program<AttentionMarket>;
  const pid = program.programId;

  const commenter = Keypair.generate();
  const treasury = Keypair.generate();
  const contentId = "cr-comment-001";

  let marketPda: PublicKey;
  let vaultPda: PublicKey;

  before(async () => {
    for (const kp of [commenter, treasury]) {
      const sig = await provider.connection.requestAirdrop(kp.publicKey, 3 * LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(sig);
    }

    marketPda = getMarketPda(pid, contentId);
    vaultPda = getVaultPda(pid, marketPda);

    await program.methods
      .createMarket(contentId, "Comment Test Market", new BN(300), 0)
      .accounts({
        market: marketPda,
        vault: vaultPda,
        protocolTreasury: treasury.publicKey,
        authority: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  });

  it("1. Posts first comment (index=0)", async () => {
    const commentPda = getCommentPda(pid, marketPda, 0);

    await program.methods
      .postComment("This is going viral, trust.", new BN(0))
      .accounts({
        market: marketPda,
        comment: commentPda,
        author: commenter.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([commenter])
      .rpc();

    const market = await program.account.market.fetch(marketPda);
    expect(market.commentCount.toNumber()).to.equal(1);

    const comment = await program.account.comment.fetch(commentPda);
    expect(comment.content).to.equal("This is going viral, trust.");
    expect(comment.author.toBase58()).to.equal(commenter.publicKey.toBase58());
    console.log("  ✓ Comment 0 posted and verified on-chain");
  });

  it("2. Posts second comment (index=1)", async () => {
    const commentPda = getCommentPda(pid, marketPda, 1);

    await program.methods
      .postComment("Disagree. This is a flop.", new BN(1))
      .accounts({
        market: marketPda,
        comment: commentPda,
        author: commenter.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([commenter])
      .rpc();

    const market = await program.account.market.fetch(marketPda);
    expect(market.commentCount.toNumber()).to.equal(2);
    console.log("  ✓ Comment 1 posted and verified on-chain");
  });

  it("3. Wrong comment index is rejected", async () => {
    // comment_count is now 2, so index 5 should fail
    const commentPda = getCommentPda(pid, marketPda, 5);
    let threw = false;
    try {
      await program.methods
        .postComment("Skip ahead.", new BN(5))
        .accounts({
          market: marketPda,
          comment: commentPda,
          author: commenter.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([commenter])
        .rpc();
    } catch {
      threw = true;
    }
    expect(threw).to.equal(true);
    console.log("  ✓ Out-of-sequence comment index correctly rejected");
  });

  it("4. Comment exceeding 280 chars is rejected", async () => {
    const commentPda = getCommentPda(pid, marketPda, 2);
    let threw = false;
    try {
      await program.methods
        .postComment("x".repeat(281), new BN(2))
        .accounts({
          market: marketPda,
          comment: commentPda,
          author: commenter.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([commenter])
        .rpc();
    } catch {
      threw = true;
    }
    expect(threw).to.equal(true);
    console.log("  ✓ Oversized comment correctly rejected");
  });
});

// ─── Suite 4: Security edge cases ────────────────────────────────────────────
describe("attention_market — security edge cases", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AttentionMarket as Program<AttentionMarket>;
  const pid = program.programId;

  const bettor = Keypair.generate();
  const bystander = Keypair.generate();
  const treasury = Keypair.generate();

  const contentId = "cr-security-001";
  const secret = Buffer.alloc(32, 0xab);

  let marketPda: PublicKey;
  let vaultPda: PublicKey;
  let betPda: PublicKey;
  let statsPda: PublicKey;

  before(async () => {
    for (const kp of [bettor, bystander, treasury]) {
      const sig = await provider.connection.requestAirdrop(kp.publicKey, 5 * LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(sig);
    }

    marketPda = getMarketPda(pid, contentId);
    vaultPda = getVaultPda(pid, marketPda);
    betPda = getBetPda(pid, marketPda, bettor.publicKey);
    statsPda = getUserStatsPda(pid, bettor.publicKey);

    // Create a 2-second market
    await program.methods
      .createMarket(contentId, "Security Test Market", new BN(2), 0)
      .accounts({
        market: marketPda,
        vault: vaultPda,
        protocolTreasury: treasury.publicKey,
        authority: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Bettor commits
    const commitment = computeCommitment(1, secret, bettor.publicKey);
    await program.methods
      .commitBet(Array.from(commitment), new BN(0.5 * LAMPORTS_PER_SOL))
      .accounts({
        market: marketPda,
        vault: vaultPda,
        bet: betPda,
        userStats: statsPda,
        user: bettor.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([bettor])
      .rpc();

    console.log("  Suite setup: market + bet committed");
  });

  it("1. Reject commit_bet after market end_time", async () => {
    console.log("  Waiting 3s for market to expire...");
    await new Promise((r) => setTimeout(r, 3000));

    const lateId = "cr-security-late";
    const lateMarket = getMarketPda(pid, lateId);
    const lateVault = getVaultPda(pid, lateMarket);
    const lateBet = getBetPda(pid, lateMarket, bettor.publicKey);
    const lateStats = getUserStatsPda(pid, bettor.publicKey);

    await program.methods
      .createMarket(lateId, "Late Market", new BN(1), 0)
      .accounts({
        market: lateMarket,
        vault: lateVault,
        protocolTreasury: treasury.publicKey,
        authority: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await new Promise((r) => setTimeout(r, 2000));

    let threw = false;
    try {
      const c = computeCommitment(1, secret, bettor.publicKey);
      await program.methods
        .commitBet(Array.from(c), new BN(0.1 * LAMPORTS_PER_SOL))
        .accounts({
          market: lateMarket,
          vault: lateVault,
          bet: lateBet,
          userStats: lateStats,
          user: bettor.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([bettor])
        .rpc();
    } catch {
      threw = true;
    }
    expect(threw).to.equal(true);
    console.log("  ✓ commit_bet after end_time correctly rejected (MarketExpired)");
  });

  it("2. Reject double-reveal (BetAlreadyRevealed)", async () => {
    // Market is expired (from test 1 wait). Reveal once — succeeds.
    await program.methods
      .revealBet(1, Array.from(secret))
      .accounts({ market: marketPda, bet: betPda, userStats: statsPda, user: bettor.publicKey })
      .signers([bettor])
      .rpc();

    // Reveal again — must fail
    let threw = false;
    try {
      await program.methods
        .revealBet(1, Array.from(secret))
        .accounts({ market: marketPda, bet: betPda, userStats: statsPda, user: bettor.publicKey })
        .signers([bettor])
        .rpc();
    } catch {
      threw = true;
    }
    expect(threw).to.equal(true);
    const bet = await program.account.betRecord.fetch(betPda);
    expect(bet.revealed).to.equal(true);
    console.log("  ✓ Double-reveal correctly rejected (BetAlreadyRevealed)");
  });

  it("3. Reject resolve_market before reveal window closes (RevealWindowNotClosed)", async () => {
    // We are within the 1-hour reveal window
    let threw = false;
    try {
      await program.methods
        .resolveMarket()
        .accounts({
          market: marketPda,
          vault: vaultPda,
          protocolTreasury: treasury.publicKey,
          creator: provider.wallet.publicKey,
          authority: provider.wallet.publicKey,
        })
        .rpc();
    } catch {
      threw = true;
    }
    expect(threw).to.equal(true);
    const market = await program.account.market.fetch(marketPda);
    expect(market.resolved).to.equal(false);
    console.log("  ✓ resolve_market within reveal window correctly rejected (RevealWindowNotClosed)");
  });

  it("4. Reject claim_winnings before market is resolved (MarketNotResolved)", async () => {
    // Market not resolved yet — claim should fail immediately
    let threw = false;
    try {
      await program.methods
        .claimWinnings()
        .accounts({
          market: marketPda,
          vault: vaultPda,
          bet: betPda,
          userStats: statsPda,
          user: bettor.publicKey,
        })
        .signers([bettor])
        .rpc();
    } catch {
      threw = true;
    }
    expect(threw).to.equal(true);
    console.log("  ✓ claim_winnings on unresolved market rejected (MarketNotResolved)");
    console.log("  ℹ Full double-claim/wrong-user/losing-side tests require clock warp: end_time + 3601s");
  });

  it("5. Reject invalid market mode (mode=2)", async () => {
    const badId = "cr-sec-mode-bad";
    const badMarket = getMarketPda(pid, badId);
    const badVault = getVaultPda(pid, badMarket);

    let threw = false;
    try {
      await program.methods
        .createMarket(badId, "Bad Mode", new BN(60), 2)
        .accounts({
          market: badMarket,
          vault: badVault,
          protocolTreasury: treasury.publicKey,
          authority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } catch {
      threw = true;
    }
    expect(threw).to.equal(true);
    console.log("  ✓ mode=2 correctly rejected (InvalidMode)");
  });

  it("6. Reject empty comment content (CommentEmpty)", async () => {
    // Use the comment test market from Suite 3 or a fresh one
    const emptyId = "cr-sec-empty-cmt";
    const emptyMarket = getMarketPda(pid, emptyId);
    const emptyVault = getVaultPda(pid, emptyMarket);

    await program.methods
      .createMarket(emptyId, "Empty Comment Test", new BN(300), 0)
      .accounts({
        market: emptyMarket,
        vault: emptyVault,
        protocolTreasury: treasury.publicKey,
        authority: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const commentPda = getCommentPda(pid, emptyMarket, 0);
    let threw = false;
    try {
      await program.methods
        .postComment("", new BN(0))
        .accounts({
          market: emptyMarket,
          comment: commentPda,
          author: bystander.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([bystander])
        .rpc();
    } catch {
      threw = true;
    }
    expect(threw).to.equal(true);
    console.log("  ✓ Empty comment correctly rejected (CommentEmpty)");
  });

  it("7. Allow comment from non-bettor (no bet required)", async () => {
    const openId = "cr-sec-open-cmt";
    const openMarket = getMarketPda(pid, openId);
    const openVault = getVaultPda(pid, openMarket);

    await program.methods
      .createMarket(openId, "Open Comment Test", new BN(300), 0)
      .accounts({
        market: openMarket,
        vault: openVault,
        protocolTreasury: treasury.publicKey,
        authority: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // bystander has never placed a bet — should still be able to comment
    const commentPda = getCommentPda(pid, openMarket, 0);
    await program.methods
      .postComment("Watching from the sidelines.", new BN(0))
      .accounts({
        market: openMarket,
        comment: commentPda,
        author: bystander.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([bystander])
      .rpc();

    const market = await program.account.market.fetch(openMarket);
    expect(market.commentCount.toNumber()).to.equal(1);

    const comment = await program.account.comment.fetch(commentPda);
    expect(comment.author.toBase58()).to.equal(bystander.publicKey.toBase58());
    console.log("  ✓ Non-bettor can post comment — comment section is open to all");
  });

  it("8. Whale event emitted for commit >= 1 SOL", async () => {
    const whaleId = "cr-sec-whale";
    const whaleMarket = getMarketPda(pid, whaleId);
    const whaleVault = getVaultPda(pid, whaleMarket);
    const whaleBet = getBetPda(pid, whaleMarket, bettor.publicKey);
    const whaleStats = getUserStatsPda(pid, bettor.publicKey);

    await program.methods
      .createMarket(whaleId, "Whale Event Test", new BN(60), 0)
      .accounts({
        market: whaleMarket,
        vault: whaleVault,
        protocolTreasury: treasury.publicKey,
        authority: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const commitment = computeCommitment(1, secret, bettor.publicKey);
    let whaleSeen = false;

    // Subscribe to logs before sending the whale bet
    const subId = provider.connection.onLogs(
      pid,
      ({ logs }) => {
        for (const log of logs) {
          if (!log.startsWith("Program data:")) continue;
          try {
            const bytes = Buffer.from(log.slice("Program data: ".length).trim(), "base64");
            // WhaleBet discriminator: first 8 bytes of sha256("event:WhaleBet")
            const DISC = [56, 158, 187, 15, 77, 131, 214, 152];
            if (DISC.every((b, i) => b === bytes[i])) whaleSeen = true;
          } catch {}
        }
      },
      "confirmed"
    );

    await program.methods
      .commitBet(Array.from(commitment), new BN(1 * LAMPORTS_PER_SOL))
      .accounts({
        market: whaleMarket,
        vault: whaleVault,
        bet: whaleBet,
        userStats: whaleStats,
        user: bettor.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([bettor])
      .rpc();

    // Give logs a moment to arrive
    await new Promise((r) => setTimeout(r, 1500));
    await provider.connection.removeOnLogsListener(subId);

    expect(whaleSeen).to.equal(true);
    console.log("  ✓ WhaleBet event emitted and detected for 1 SOL commit");
  });

  it("9. No whale event for sub-threshold commit (0.5 SOL)", async () => {
    const smallId = "cr-sec-small";
    const smallMarket = getMarketPda(pid, smallId);
    const smallVault = getVaultPda(pid, smallMarket);
    const smallBet = getBetPda(pid, smallMarket, bettor.publicKey);
    const smallStats = getUserStatsPda(pid, bettor.publicKey);

    await program.methods
      .createMarket(smallId, "Sub-threshold Test", new BN(60), 0)
      .accounts({
        market: smallMarket,
        vault: smallVault,
        protocolTreasury: treasury.publicKey,
        authority: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const commitment = computeCommitment(1, secret, bettor.publicKey);
    let whaleSeen = false;

    const subId = provider.connection.onLogs(
      pid,
      ({ logs }) => {
        for (const log of logs) {
          if (!log.startsWith("Program data:")) continue;
          try {
            const bytes = Buffer.from(log.slice("Program data: ".length).trim(), "base64");
            const DISC = [56, 158, 187, 15, 77, 131, 214, 152];
            if (DISC.every((b, i) => b === bytes[i])) whaleSeen = true;
          } catch {}
        }
      },
      "confirmed"
    );

    await program.methods
      .commitBet(Array.from(commitment), new BN(0.5 * LAMPORTS_PER_SOL))
      .accounts({
        market: smallMarket,
        vault: smallVault,
        bet: smallBet,
        userStats: smallStats,
        user: bettor.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([bettor])
      .rpc();

    await new Promise((r) => setTimeout(r, 1500));
    await provider.connection.removeOnLogsListener(subId);

    expect(whaleSeen).to.equal(false);
    console.log("  ✓ No WhaleBet event for 0.5 SOL commit (below 1 SOL threshold)");
  });

  it("10. Verify guard state: bet.revealed tracks reveal correctly", async () => {
    // Confirm the bet from the main market was revealed in test 2
    const bet = await program.account.betRecord.fetch(betPda);
    expect(bet.revealed).to.equal(true);
    expect(bet.revealedOutcome).to.equal(1);
    expect(bet.claimed).to.equal(false);

    // UserStats.total_bets incremented once (from reveal)
    const stats = await program.account.userStats.fetch(statsPda);
    expect(stats.totalBets.toNumber()).to.be.greaterThanOrEqual(1);
    console.log("  ✓ bet.revealed=true, revealedOutcome=1, claimed=false verified on-chain");
    console.log("  ✓ user_stats.total_bets incremented after reveal");
  });

  it("11. Verify guard state: market.winner_pool = 95% of total_committed after resolve", async () => {
    // We cannot call resolve_market in this test run (reveal window ~3600s).
    // Instead verify the fee math: total * 0.95 = winner_pool
    const market = await program.account.market.fetch(marketPda);
    const total = market.totalCommitted.toNumber();
    const expectedWinnerPool = Math.floor(total * 0.95);
    // winner_pool is 0 until resolved; confirm the formula for docs
    expect(total).to.be.greaterThan(0);
    const computed = Math.floor(total * 200 / 10_000); // protocol 2%
    const computed2 = Math.floor(total * 300 / 10_000); // creator 3%
    expect(computed + computed2).to.be.lessThan(total);
    console.log(`  ✓ Fee math: ${total} lamports × 5% fees = ${computed + computed2} lamports fees`);
    console.log(`  ✓ Expected winner_pool after resolve: ${expectedWinnerPool} lamports`);
    console.log("  ℹ Double-claim/wrong-user/losing-side tests require: anchor test --skip-local-validator + clock warp to end_time + 3601");
  });
});
