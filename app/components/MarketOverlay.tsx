import { FC, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { BetSide, MarketAccount, BetRecord, MarketOdds } from "../hooks/useMarket";
import BetModal from "./BetModal";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

interface Props {
  market: MarketAccount | null;
  userBet: BetRecord | null;
  odds: MarketOdds;
  loading: boolean;
  onPlaceBet: (side: BetSide, amount: number) => Promise<void>;
  onClaim: () => Promise<void>;
  onResolve?: (side: BetSide) => Promise<void>;
  isAuthority?: boolean;
}

const MarketOverlay: FC<Props> = ({
  market,
  userBet,
  odds,
  loading,
  onPlaceBet,
  onClaim,
  onResolve,
  isAuthority,
}) => {
  const { connected } = useWallet();
  const { setVisible } = useWalletModal();
  const [betSide, setBetSide] = useState<BetSide | null>(null);

  const isResolved = market?.resolved ?? false;
  const userWon =
    isResolved && userBet && market && userBet.outcome === market.outcome;
  const canClaim = userWon && userBet && !userBet.claimed;

  const now = Math.floor(Date.now() / 1000);
  const expired = market ? now >= market.endTime.toNumber() : false;

  function formatSOL(lamports: any): string {
    if (!lamports) return "0";
    const n = typeof lamports.toNumber === "function" ? lamports.toNumber() : Number(lamports);
    return (n / LAMPORTS_PER_SOL).toFixed(3);
  }

  return (
    <>
      <div className="flex flex-col gap-3 w-full">
        {/* Odds bar */}
        <div className="bg-white/10 rounded-2xl p-3 backdrop-blur-sm">
          <div className="flex justify-between text-xs font-semibold mb-2">
            <span style={{ color: "#7C3AED" }}>🚀 VIRAL {odds.viralPercent}%</span>
            <span style={{ color: "#EC4899" }}>💀 FLOP {odds.flopPercent}%</span>
          </div>
          <div className="h-2 bg-white/10 rounded-full overflow-hidden">
            <motion.div
              className="h-full rounded-full odds-bar-fill"
              style={{
                background: "linear-gradient(90deg, #7C3AED, #EC4899)",
              }}
              animate={{ width: `${odds.viralPercent}%` }}
              transition={{ duration: 0.6, ease: "easeInOut" }}
            />
          </div>
          <div className="mt-2 text-center text-xs text-white/50">
            Pot: <span className="text-white font-semibold">{odds.totalSOL.toFixed(3)} SOL</span>
          </div>
        </div>

        {/* User's current bet */}
        <AnimatePresence>
          {userBet && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="rounded-xl px-3 py-2 text-xs font-medium text-center"
              style={{
                background: userBet.outcome === 1 ? "rgba(124,58,237,0.25)" : "rgba(236,72,153,0.25)",
                border: `1px solid ${userBet.outcome === 1 ? "#7C3AED" : "#EC4899"}`,
              }}
            >
              Your bet: {formatSOL(userBet.amount)} SOL on{" "}
              <span style={{ color: userBet.outcome === 1 ? "#8B5CF6" : "#F472B6" }}>
                {userBet.outcome === 1 ? "VIRAL 🚀" : "FLOP 💀"}
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Resolved banner */}
        <AnimatePresence>
          {isResolved && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="rounded-xl px-3 py-2 text-center text-sm font-bold"
              style={{
                background:
                  market?.outcome === 1
                    ? "linear-gradient(135deg, rgba(124,58,237,0.4), rgba(139,92,246,0.2))"
                    : "linear-gradient(135deg, rgba(236,72,153,0.4), rgba(244,114,182,0.2))",
                border: `1px solid ${market?.outcome === 1 ? "#7C3AED" : "#EC4899"}`,
              }}
            >
              {market?.outcome === 1 ? "🚀 VIRAL WON!" : "💀 FLOP WON!"}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Action buttons */}
        {!connected ? (
          <button
            onClick={() => setVisible(true)}
            className="w-full py-3 rounded-2xl text-sm font-bold text-white transition-all active:scale-95"
            style={{ background: "linear-gradient(135deg, #7C3AED, #EC4899)" }}
          >
            Connect Wallet to Bet
          </button>
        ) : canClaim ? (
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={onClaim}
            disabled={loading}
            className="w-full py-3 rounded-2xl text-sm font-bold text-white"
            style={{ background: "linear-gradient(135deg, #059669, #10b981)" }}
          >
            {loading ? "Claiming..." : "💰 Claim Winnings"}
          </motion.button>
        ) : !isResolved && !userBet ? (
          <div className="flex gap-2">
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => setBetSide("viral")}
              disabled={loading || expired}
              className="flex-1 py-3 rounded-2xl text-sm font-bold text-white transition-all"
              style={{ background: expired ? "#333" : "#7C3AED" }}
            >
              🚀 Viral
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => setBetSide("flop")}
              disabled={loading || expired}
              className="flex-1 py-3 rounded-2xl text-sm font-bold text-white transition-all"
              style={{ background: expired ? "#333" : "#EC4899" }}
            >
              💀 Flop
            </motion.button>
          </div>
        ) : null}

        {/* Dev: Resolve button (only authority, only after expiry) */}
        {isAuthority && !isResolved && expired && onResolve && (
          <div className="flex gap-2 mt-1">
            <button
              onClick={() => onResolve("viral")}
              className="flex-1 text-xs py-2 rounded-xl border border-purple-500/50 text-purple-400 hover:bg-purple-900/20"
            >
              Resolve Viral
            </button>
            <button
              onClick={() => onResolve("flop")}
              className="flex-1 text-xs py-2 rounded-xl border border-pink-500/50 text-pink-400 hover:bg-pink-900/20"
            >
              Resolve Flop
            </button>
          </div>
        )}
      </div>

      {/* Bet Modal */}
      <AnimatePresence>
        {betSide && (
          <BetModal
            side={betSide}
            odds={odds}
            onClose={() => setBetSide(null)}
            onConfirm={async (amount) => {
              await onPlaceBet(betSide, amount);
              setBetSide(null);
            }}
            loading={loading}
          />
        )}
      </AnimatePresence>
    </>
  );
};

export default MarketOverlay;
