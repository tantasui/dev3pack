import { Elysia, t } from "elysia";
import { PublicKey } from "@solana/web3.js";
import { desc, eq } from "drizzle-orm";
import {
  getAllMarkets,
  getMarketByPubkey,
  getComments,
  getCreatorStats,
  resolveMarket,
} from "./solana";
import { db } from "./db";
import { creatorSnapshots, cronLog, markets as marketsTable } from "./db/schema";
import { startCron } from "./cron";

const PORT = Number(process.env.PORT ?? 3001);
const RESOLVER_SECRET = process.env.RESOLVER_SECRET ?? "";

// ─── Bearer auth helper ───────────────────────────────────────────────────────

function checkAuth(headers: Record<string, string | undefined>): boolean {
  if (!RESOLVER_SECRET) return true; // open in dev if unset
  const auth = headers["authorization"] ?? "";
  return auth === `Bearer ${RESOLVER_SECRET}`;
}

// ─── App ──────────────────────────────────────────────────────────────────────

const app = new Elysia()
  .onError(({ code, error, set }) => {
    if (code === "VALIDATION") {
      set.status = 400;
      return { error: "Bad request", details: error.message };
    }
    set.status = 500;
    console.error(error);
    return { error: "Internal server error" };
  })

  // ── GET /markets ─────────────────────────────────────────────────────────────
  .get(
    "/markets",
    async ({ query }) => {
      const all = await getAllMarkets();
      if (query.active === "true") {
        const nowSec = Math.floor(Date.now() / 1000);
        return all.filter((m) => !m.resolved && m.endTime > nowSec);
      }
      return all;
    },
    {
      query: t.Object({
        active: t.Optional(t.String()),
      }),
    }
  )

  // ── GET /markets/:pubkey ──────────────────────────────────────────────────────
  .get(
    "/markets/:pubkey",
    async ({ params, set }) => {
      let key: PublicKey;
      try {
        key = new PublicKey(params.pubkey);
      } catch {
        set.status = 400;
        return { error: "Invalid pubkey" };
      }
      const market = await getMarketByPubkey(key);
      if (!market) {
        set.status = 404;
        return { error: "Market not found" };
      }
      return market;
    }
  )

  // ── GET /markets/:pubkey/comments ─────────────────────────────────────────────
  .get(
    "/markets/:pubkey/comments",
    async ({ params, query, set }) => {
      let key: PublicKey;
      try {
        key = new PublicKey(params.pubkey);
      } catch {
        set.status = 400;
        return { error: "Invalid pubkey" };
      }
      const limit = Math.min(Number(query.limit ?? 20), 100);
      const offset = Number(query.offset ?? 0);
      return getComments(key, limit, offset);
    },
    {
      query: t.Object({
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
      }),
    }
  )

  // ── GET /creator/:pubkey ──────────────────────────────────────────────────────
  .get(
    "/creator/:pubkey",
    async ({ params, set }) => {
      let key: PublicKey;
      try {
        key = new PublicKey(params.pubkey);
      } catch {
        set.status = 400;
        return { error: "Invalid pubkey" };
      }

      const [stats, history] = await Promise.all([
        getCreatorStats(key),
        db
          .select()
          .from(creatorSnapshots)
          .where(eq(creatorSnapshots.creatorPubkey, key.toBase58()))
          .orderBy(desc(creatorSnapshots.snappedAt))
          .limit(12),
      ]);

      return {
        ...stats,
        history: history.reverse().map((row) => ({
          snappedAt: row.snappedAt,
          crowdScore: row.crowdScore,
          totalVolumeSol: row.totalVolumeSol,
          totalEarnedSol: row.totalEarnedSol,
        })),
      };
    }
  )

  // ── POST /resolve ─────────────────────────────────────────────────────────────
  .post(
    "/resolve",
    async ({ body, headers, set }) => {
      if (!checkAuth(headers as any)) {
        set.status = 401;
        return { error: "Unauthorized" };
      }

      let key: PublicKey;
      try {
        key = new PublicKey(body.marketPubkey);
      } catch {
        set.status = 400;
        return { error: "Invalid marketPubkey" };
      }

      const market = await getMarketByPubkey(key);
      if (!market) {
        set.status = 404;
        return { error: "Market not found" };
      }
      if (market.resolved) {
        set.status = 409;
        return { error: "Market already resolved" };
      }

      const nowSec = Math.floor(Date.now() / 1000);
      if (nowSec < market.endTime) {
        set.status = 422;
        return { error: "Market betting window has not closed yet" };
      }

      let txSig: string;
      try {
        txSig = await resolveMarket(key);
      } catch (e: any) {
        const errorMsg = String(e?.message ?? e);
        await db.insert(cronLog).values({
          marketPubkey: key.toBase58(),
          success: false,
          errorMsg,
        });
        set.status = 500;
        return { error: errorMsg };
      }

      await db.insert(cronLog).values({
        marketPubkey: key.toBase58(),
        success: true,
        txSig,
      });

      return { success: true, txSig };
    },
    {
      body: t.Object({
        marketPubkey: t.String(),
      }),
    }
  )

  // ── GET /health ───────────────────────────────────────────────────────────────
  .get("/health", () => ({ ok: true, ts: Date.now() }))

  .listen(PORT);

startCron();

console.log(`[server] CrowdCast API running on http://localhost:${PORT}`);
