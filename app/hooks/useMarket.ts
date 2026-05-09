// Re-export useMarket from SDK — keeps the hook co-located with the app
// while the actual implementation lives in the SDK layer.
export { useMarket } from "../lib/program";
export type { MarketAccount, BetRecord, MarketOdds, BetSide } from "../lib/program";
