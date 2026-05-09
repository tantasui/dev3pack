import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  bigint,
  real,
} from "drizzle-orm/pg-core";

// Snapshot written after each successful market resolution
export const markets = pgTable("markets", {
  id: serial("id").primaryKey(),
  contentId: text("content_id").unique().notNull(),
  pubkey: text("pubkey").notNull(),
  title: text("title"),
  mode: integer("mode"),              // 0=majority, 1=minority
  outcome: integer("outcome"),        // 1=viral, 2=flop
  totalCommittedLamports: bigint("total_committed_lamports", { mode: "bigint" }),
  winnerPoolLamports: bigint("winner_pool_lamports", { mode: "bigint" }),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Weekly creator score snapshots (powers the 12-week history chart)
export const creatorSnapshots = pgTable("creator_snapshots", {
  id: serial("id").primaryKey(),
  creatorPubkey: text("creator_pubkey").notNull(),
  totalEarnedSol: real("total_earned_sol"),
  marketsCreated: integer("markets_created"),
  totalVolumeSol: real("total_volume_sol"),
  crowdScore: integer("crowd_score"),   // 0–100, derived from market win ratio
  snappedAt: timestamp("snapped_at").defaultNow(),
});

// One row per cron resolve attempt
export const cronLog = pgTable("cron_log", {
  id: serial("id").primaryKey(),
  marketPubkey: text("market_pubkey").notNull(),
  attemptedAt: timestamp("attempted_at").defaultNow(),
  success: boolean("success"),
  txSig: text("tx_sig"),
  errorMsg: text("error_msg"),
});
