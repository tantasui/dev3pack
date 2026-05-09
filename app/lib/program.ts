// Re-export everything from the SDK for use within the Next.js app.
// The path alias "@crowdcast/sdk" → "../sdk/index.ts" is defined in tsconfig.json.

export {
  IDL,
  PROGRAM_ID,
  getMarketPda,
  getVaultPda,
  getBetPda,
  createMarket,
  placeBet,
  resolveMarket,
  claimWinnings,
  getMarket,
  getMarketByContentId,
  getUserBet,
  computeOdds,
  useMarket,
} from "@crowdcast/sdk";

export type {
  MarketAccount,
  BetRecord,
  MarketOdds,
  BetSide,
} from "@crowdcast/sdk";
