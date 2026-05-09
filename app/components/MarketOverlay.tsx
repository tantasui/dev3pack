import { FC, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { BetSide, MarketAccount, BetRecord, MarketOdds } from "../hooks/useMarket";
import BetModal from "./BetModal";

interface Props {
  market: MarketAccount | null;
  userBet: BetRecord | null;
  /** null during active betting / reveal window; only set after reveal window closes */
  odds: MarketOdds | null;
  totalCommittedSOL: number;
  bettingClosed: boolean;
  revealWindowClosed: boolean;
  canReveal: boolean;
  loading: boolean;
  onCommitBet: (side: BetSide, amount: number) => Promise<void>;
  onReveal: () => Promise<void>;
  onClaim: () => Promise<void>;
  /** Auto-resolves — no outcome arg needed */
  onResolve?: () => Promise<void>;
  isAuthority?: boolean;
}

function useCountdown(targetSec: number | null): string {
  const [display, setDisplay] = useState("--:--");
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);

  if (targetSec !== null) {
    if (ref.current === null) {
      const tick = () => {
        const diff = targetSec - Math.floor(Date.now() / 1000);
        if (diff <= 0) {
          setDisplay("ENDED");
          if (ref.current) clearInterval(ref.current);
          return;
        }
        const m = Math.floor(diff / 60).toString().padStart(2, "0");
        const s = (diff % 60).toString().padStart(2, "0");
        setDisplay(`${m}:${s}`);
      };
      tick();
      ref.current = setInterval(tick, 1000);
    }
  }

  return display;
}

const MarketOverlay: FC<Props> = ({
  market,
  userBet,
  odds,
  totalCommittedSOL,
  bettingClosed,
  revealWindowClosed,
  canReveal,
  loading,
  onCommitBet,
  onReveal,
  onClaim,
  onResolve,
  isAuthority,
}) => {
  const { connected } = useWallet();
  const { setVisible } = useWalletModal();
  const [betSide, setBetSide] = useState<BetSide | null>(null);

  const isResolved = market?.resolved ?? false;
  const userWon = isResolved && userBet && market && userBet.revealedOutcome === market.outcome;
  const canClaim = userWon && userBet && !userBet.claimed;

  const endTime = market?.endTime?.toNumber() ?? null;
  const revealEndTime = endTime !== null ? endTime + 3600 : null;

  const bettingCountdown = useCountdown(!bettingClosed ? endTime : null);
  const revealCountdown = useCountdown(
    bettingClosed && !revealWindowClosed ? revealEndTime : null
  );

  function formatSOL(lamports: any): string {
    if (!lamports) return "0";
    const n = typeof lamports.toNumber === "function" ? lamports.toNumber() : Number(lamports);
    return (n / LAMPORTS_PER_SOL).toFixed(3);
  }

  return (
    <>
      <div className="flex flex-col gap-2 w-full">

        {/* ── Phase A: Active betting ── */}
        {!bettingClosed && (
          <motion.div
            key="phase-active"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col gap-2"
          >
            {/* Locked pot */}
            <div
              className="rounded-2xl p-3 text-center backdrop-blur-sm"
              style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)" }}
            >
              <div className="text-xs text-white/50 mb-0.5">SOL Locked</div>
              <div className="text-lg font-black text-white">
                {totalCommittedSOL.toFixed(3)}
              </div>
              <div className="text-xs font-medium mt-1" style={{ color: "#a78bfa" }}>
                🔒 Odds reveal when timer ends
              </div>
            </div>

            {/* User's existing bet (amount only, no side) */}
            <AnimatePresence>
              {userBet && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-xl px-3 py-2 text-xs font-medium text-center"
                  style={{ background: "rgba(124,58,237,0.2)", border: "1px solid rgba(124,58,237,0.4)" }}
                >
                  Bet committed: {formatSOL(userBet.amount)} SOL
                </motion.div>
              )}
            </AnimatePresence>

            {/* Bet or connect */}
            {!connected ? (
              <button
                onClick={() => setVisible(true)}
                className="w-full py-3 rounded-2xl text-sm font-bold text-white"
                style={{ background: "linear-gradient(135deg, #7C3AED, #EC4899)" }}
              >
                Connect Wallet to Bet
              </button>
            ) : !userBet ? (
              <div className="flex gap-2">
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setBetSide("viral")}
                  disabled={loading}
                  className="flex-1 py-3 rounded-2xl text-sm font-bold text-white"
                  style={{ background: "#7C3AED" }}
                >
                  🚀 Viral
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setBetSide("flop")}
                  disabled={loading}
                  className="flex-1 py-3 rounded-2xl text-sm font-bold text-white"
                  style={{ background: "#EC4899" }}
                >
                  💀 Flop
                </motion.button>
              </div>
            ) : null}
          </motion.div>
        )}

        {/* ── Phase B: Reveal window ── */}
        {bettingClosed && !revealWindowClosed && (
          <motion.div
            key="phase-reveal"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col gap-2"
          >
            <div
              className="rounded-2xl p-3 text-center"
              style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)" }}
            >
              <div className="text-xs text-white/50 mb-0.5">Total Committed</div>
              <div className="text-lg font-black text-white">{totalCommittedSOL.toFixed(3)} SOL</div>
              <div className="text-xs text-white/50 mt-1.5">
                Reveal window closes in{" "}
                <span className="font-mono font-bold" style={{ color: "#f59e0b" }}>
                  {revealCountdown}
                </span>
              </div>
            </div>

            {canReveal && (
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={onReveal}
                disabled={loading}
                className="w-full py-3 rounded-2xl text-sm font-bold text-white"
                style={{ background: "linear-gradient(135deg, #7C3AED, #EC4899)" }}
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Revealing...
                  </span>
                ) : "👁 Reveal Your Bet"}
              </motion.button>
            )}

            {userBet?.revealed && (
              <div
                className="rounded-xl px-3 py-2 text-xs text-center font-medium"
                style={{ background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.4)", color: "#6ee7b7" }}
              >
                ✅ Revealed — waiting for window to close
              </div>
            )}

            {!userBet && connected && (
              <div className="text-xs text-white/30 text-center">
                Betting period ended
              </div>
            )}
          </motion.div>
        )}

        {/* ── Phase C: After reveal window ── */}
        {revealWindowClosed && (
          <motion.div
            key="phase-post"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col gap-2"
          >
            {/* Dramatic odds reveal */}
            {odds && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4 }}
                className="rounded-2xl p-3 backdrop-blur-sm"
                style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)" }}
              >
                <div className="flex justify-between text-xs font-semibold mb-2">
                  <span style={{ color: "#7C3AED" }}>🚀 VIRAL {odds.viralPercent}%</span>
                  <span style={{ color: "#EC4899" }}>💀 FLOP {odds.flopPercent}%</span>
                </div>
                <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: "linear-gradient(90deg, #7C3AED, #EC4899)" }}
                    initial={{ width: "50%" }}
                    animate={{ width: `${odds.viralPercent}%` }}
                    transition={{ duration: 1.2, ease: [0.34, 1.56, 0.64, 1] }}
                  />
                </div>
                <div className="mt-2 text-center text-xs text-white/50">
                  Final pot:{" "}
                  <span className="text-white font-semibold">{odds.totalSOL.toFixed(3)} SOL</span>
                </div>
              </motion.div>
            )}

            {/* Result banner */}
            {isResolved && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.6 }}
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

            {/* Claim button */}
            {canClaim && (
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={onClaim}
                disabled={loading}
                className="w-full py-3 rounded-2xl text-sm font-bold text-white"
                style={{ background: "linear-gradient(135deg, #059669, #10b981)" }}
              >
                {loading ? "Claiming..." : "💰 Claim Winnings"}
              </motion.button>
            )}

            {/* Authority: resolve button (no side choice — auto-computed) */}
            {isAuthority && !isResolved && onResolve && (
              <button
                onClick={onResolve}
                disabled={loading}
                className="w-full text-xs py-2 rounded-xl border border-purple-500/50 text-purple-400 hover:bg-purple-900/20"
              >
                {loading ? "Resolving..." : "⚡ Resolve Market"}
              </button>
            )}

            {/* No odds yet (no bets revealed) */}
            {!odds && !isResolved && (
              <div className="text-xs text-white/30 text-center py-2">
                No bets were revealed
              </div>
            )}
          </motion.div>
        )}
      </div>

      {/* Bet Modal */}
      <AnimatePresence>
        {betSide && (
          <BetModal
            side={betSide}
            onClose={() => setBetSide(null)}
            onConfirm={async (amount) => {
              await onCommitBet(betSide, amount);
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
