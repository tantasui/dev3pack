import cron from "node-cron";
import { PublicKey } from "@solana/web3.js";
import {
  getAllMarkets,
  resolveMarket,
  REVEAL_WINDOW_SECONDS,
} from "./solana";
import { db } from "./db";
import { cronLog } from "./db/schema";

export function startCron() {
  cron.schedule("* * * * *", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    let markets;
    try {
      markets = await getAllMarkets();
    } catch (e) {
      console.error("[cron] failed to fetch markets:", e);
      return;
    }

    const eligible = markets.filter(
      (m) =>
        !m.resolved &&
        nowSec >= m.endTime + REVEAL_WINDOW_SECONDS
    );

    if (eligible.length === 0) return;
    console.log(`[cron] ${eligible.length} market(s) eligible for resolution`);

    for (const market of eligible) {
      const pubkey = new PublicKey(market.pubkey);
      let success = false;
      let txSig: string | undefined;
      let errorMsg: string | undefined;

      try {
        txSig = await resolveMarket(pubkey);
        success = true;
        console.log(`[cron] resolved ${market.contentId} — tx: ${txSig}`);
      } catch (e: any) {
        errorMsg = String(e?.message ?? e);
        console.error(`[cron] failed to resolve ${market.contentId}:`, errorMsg);
      }

      try {
        await db.insert(cronLog).values({
          marketPubkey: market.pubkey,
          success,
          txSig: txSig ?? null,
          errorMsg: errorMsg ?? null,
        });
      } catch (dbErr) {
        console.error("[cron] failed to write cron_log:", dbErr);
      }
    }
  });

  console.log("[cron] auto-resolver started (runs every minute)");
}
