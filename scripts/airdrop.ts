import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const DEVNET_RPC = "https://api.devnet.solana.com";
const AIRDROP_AMOUNT = 2; // SOL

async function airdrop(targetAddress?: string) {
  const connection = new Connection(DEVNET_RPC, "confirmed");

  let publicKey: PublicKey;

  if (targetAddress) {
    publicKey = new PublicKey(targetAddress);
    console.log(`Airdropping to provided address: ${publicKey.toBase58()}`);
  } else {
    // Load default Solana keypair
    const keypairPath = path.join(os.homedir(), ".config", "solana", "id.json");
    if (!fs.existsSync(keypairPath)) {
      console.error(
        "No keypair found at ~/.config/solana/id.json\n" +
        "Generate one with: solana-keygen new\n" +
        "Or pass a public key as argument: yarn airdrop <PUBKEY>"
      );
      process.exit(1);
    }
    const raw = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
    const keypair = Keypair.fromSecretKey(new Uint8Array(raw));
    publicKey = keypair.publicKey;
    console.log(`Airdropping to wallet: ${publicKey.toBase58()}`);
  }

  const balanceBefore = await connection.getBalance(publicKey);
  console.log(`Balance before: ${(balanceBefore / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

  console.log(`Requesting ${AIRDROP_AMOUNT} SOL airdrop on devnet...`);

  const sig = await connection.requestAirdrop(
    publicKey,
    AIRDROP_AMOUNT * LAMPORTS_PER_SOL
  );

  const latestBlockhash = await connection.getLatestBlockhash();
  await connection.confirmTransaction({
    signature: sig,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  });

  const balanceAfter = await connection.getBalance(publicKey);
  console.log(`Balance after:  ${(balanceAfter / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  console.log(`Transaction: https://explorer.solana.com/tx/${sig}?cluster=devnet`);
}

const args = process.argv.slice(2);
airdrop(args[0]).catch((err) => {
  console.error("Airdrop failed:", err.message);
  process.exit(1);
});
