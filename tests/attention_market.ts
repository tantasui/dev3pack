import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { PublicKey, Keypair, LAMPORTS_PER_SOL, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";

// Inline IDL type reference (generated after anchor build)
// We cast to any for flexibility during tests
type AttentionMarket = any;

describe("attention_market", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AttentionMarket as Program<AttentionMarket>;

  // Two separate test wallets
  const walletA = Keypair.generate(); // bets viral
  const walletB = Keypair.generate(); // bets flop

  const contentId = "test-001";
  const title = "Test Market";
  const durationSeconds = new BN(2); // 2s so we can resolve quickly

  let marketPda: PublicKey;
  let marketBump: number;
  let vaultPda: PublicKey;
  let betAPda: PublicKey;
  let betBPda: PublicKey;

  before(async () => {
    // Airdrop SOL to both test wallets
    const airdropA = await provider.connection.requestAirdrop(
      walletA.publicKey,
      5 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropA);

    const airdropB = await provider.connection.requestAirdrop(
      walletB.publicKey,
      5 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropB);

    // Derive PDAs
    [marketPda, marketBump] = PublicKey.findProgramAddressSync(
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

  it("1. Creates a market", async () => {
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
    expect(market.title).to.equal(title);
    expect(market.resolved).to.equal(false);
    expect(market.outcome).to.equal(0);
    console.log("  ✓ Market created:", marketPda.toString());
  });

  it("2. Wallet A bets viral (0.5 SOL)", async () => {
    const betAmount = new BN(0.5 * LAMPORTS_PER_SOL);

    await program.methods
      .placeBet(1, betAmount) // outcome 1 = viral
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
    expect(market.totalViral.toNumber()).to.equal(betAmount.toNumber());
    expect(market.totalFlop.toNumber()).to.equal(0);
    console.log("  ✓ Wallet A bet viral:", betAmount.toNumber() / LAMPORTS_PER_SOL, "SOL");
  });

  it("3. Wallet B bets flop (0.3 SOL)", async () => {
    const betAmount = new BN(0.3 * LAMPORTS_PER_SOL);

    await program.methods
      .placeBet(2, betAmount) // outcome 2 = flop
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
    expect(market.totalFlop.toNumber()).to.equal(betAmount.toNumber());
    console.log("  ✓ Wallet B bet flop:", betAmount.toNumber() / LAMPORTS_PER_SOL, "SOL");
  });

  it("4. Resolves as viral after expiry", async () => {
    // Wait for market to expire (duration = 2s)
    console.log("  Waiting 3 seconds for market to expire...");
    await new Promise((resolve) => setTimeout(resolve, 3000));

    await program.methods
      .resolveMarket(1) // 1 = viral wins
      .accounts({
        market: marketPda,
        authority: provider.wallet.publicKey,
      })
      .rpc();

    const market = await program.account.market.fetch(marketPda);
    expect(market.resolved).to.equal(true);
    expect(market.outcome).to.equal(1);
    console.log("  ✓ Market resolved as viral");
  });

  it("5. Wallet A claims winnings and receives correct SOL", async () => {
    const balanceBefore = await provider.connection.getBalance(walletA.publicKey);

    await program.methods
      .claimWinnings()
      .accounts({
        market: marketPda,
        vault: vaultPda,
        bet: betAPda,
        user: walletA.publicKey,
      })
      .signers([walletA])
      .rpc();

    const balanceAfter = await provider.connection.getBalance(walletA.publicKey);
    const received = balanceAfter - balanceBefore;

    // Total pot = 0.5 + 0.3 = 0.8 SOL, viral side = 0.5 SOL → payout = 0.8 SOL
    const expectedPayout = 0.8 * LAMPORTS_PER_SOL;
    // Allow 0.001 SOL tolerance for tx fees
    expect(received).to.be.closeTo(expectedPayout, 0.001 * LAMPORTS_PER_SOL);

    const bet = await program.account.betRecord.fetch(betAPda);
    expect(bet.claimed).to.equal(true);

    console.log(
      "  ✓ Wallet A received:",
      received / LAMPORTS_PER_SOL,
      "SOL (expected ~0.8 SOL)"
    );
  });
});
