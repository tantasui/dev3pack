import { FC, useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  BetSide,
  MarketAccount,
  BetRecord,
  MarketOdds,
  FeeBreakdown,
} from "../hooks/useMarket";
import BetModal from "./BetModal";

interface Props {
  market: MarketAccount | null;
  userBet: BetRecord | null;
  odds: MarketOdds | null;
  totalCommittedSOL: number;
  feeBreakdown: FeeBreakdown;
  bettingClosed: boolean;
  revealWindowClosed: boolean;
  isEarlyWindow: boolean;
  earlyWindowSecondsLeft: number;
  canReveal: boolean;
  whaleCount: number;
  recentWhaleAt: number | null;
  loading: boolean;
  onCommitBet: (side: BetSide, amount: number) => Promise<void>;
  onReveal: () => Promise<void>;
  onClaim: () => Promise<void>;
  onResolve?: () => Promise<void>;
  isAuthority?: boolean;
}

function fmtCountdown(sec: number): string {
  const h = Math.floor(sec / 3600).toString().padStart(2, "0");
  const m = Math.floor((sec % 3600) / 60).toString().padStart(2, "0");
  const s = (sec % 60).toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function useCountdown(targetSec: number | null): string {
  const [display, setDisplay] = useState("--:--");
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (targetSec === null) return;
    const tick = () => {
      const diff = targetSec - Math.floor(Date.now() / 1000);
      setDisplay(diff <= 0 ? "ENDED" : fmtCountdown(diff));
    };
    tick();
    ref.current = setInterval(tick, 1000);
    return () => { if (ref.current) clearInterval(ref.current); };
  }, [targetSec]);

  return display;
}

const MarketOverlay: FC<Props> = ({
  market,
  userBet,
  odds,
  totalCommittedSOL,
  feeBreakdown,
  bettingClosed,
  revealWindowClosed,
  isEarlyWindow,
  earlyWindowSecondsLeft,
  canReveal,
  whaleCount,
  recentWhaleAt,
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
  const [showWhaleBanner, setShowWhaleBanner] = useState(false);

  const isResolved = market?.resolved ?? false;
  const mode = market?.mode ?? 0;
  const userWon = isResolved && userBet && market && userBet.revealedOutcome === market.outcome;
  const canClaim = userWon && userBet && !userBet.claimed;

  const endTime = market?.endTime?.toNumber() ?? null;
  const revealEndTime = endTime !== null ? endTime + 3600 : null;
  const revealCountdown = useCountdown(
    bettingClosed && !revealWindowClosed ? revealEndTime : null
  );

  // Show whale banner when recentWhaleAt changes
  useEffect(() => {
    if (!recentWhaleAt) return;
    setShowWhaleBanner(true);
    const t = setTimeout(() => setShowWhaleBanner(false), 5000);
    return () => clearTimeout(t);
  }, [recentWhaleAt]);

  function formatSOL(lamports: any): string {
    const n = typeof lamports?.toNumber === "function" ? lamports.toNumber() : Number(lamports ?? 0);
    return (n / LAMPORTS_PER_SOL).toFixed(3);
  }

  const modeBadge =
    mode === 1 ? (
      <div
        className="text-xs font-bold px-2 py-0.5 rounded-full mb-2 text-center"
        style={{ background: "rgba(220,38,38,0.2)", border: "1px solid rgba(220,38,38,0.5)", color: "#fca5a5" }}
      >
        ☠️ Contrarian Market
      </div>
    ) : (
      <div
        className="text-xs font-medium px-2 py-0.5 rounded-full mb-2 text-center"
        style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.15)", color: "#9ca3af" }}
      >
        🏆 Majority Wins
      </div>
    );

  return (
    <>
      <div className="flex flex-col gap-2 w-full">
        {modeBadge}

        {/* Whale banner */}
        <AnimatePresence>
          {showWhaleBanner && whaleCount > 0 && (
            <motion.div
              key="whale"
              initial={{ opacity: 0, y: -8, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="rounded-xl px-3 py-2 text-xs font-bold text-center"
              style={{ background: "#854D0E", border: "1px solid #92400e" }}
            >
              {"🐋".repeat(Math.min(whaleCount, 3))}{" "}
              {whaleCount === 1 ? "A whale just entered" : `${whaleCount} whales in this market`}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Phase A: Active betting ── */}
        {!bettingClosed && (
          <motion.div key="phase-a" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col gap-2">
            {/* Early bonus badge */}
            <AnimatePresence>
              {isEarlyWindow && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: [1, 0.7, 1], scale: 1 }}
                  transition={{ opacity: { duration: 2, repeat: Infinity }, scale: { duration: 0.2 } }}
                  exit={{ opacity: 0 }}
                  className="rounded-xl px-2 py-1.5 text-xs font-bold text-center"
                  style={{ background: "rgba(234,179,8,0.2)", border: "1px solid rgba(234,179,8,0.5)", color: "#fde047" }}
                >
                  ⚡ Early bonus active — 1.2x · ends in {fmtCountdown(earlyWindowSecondsLeft)}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Locked pot */}
            <div
              className="rounded-2xl p-3 text-center backdrop-blur-sm"
              style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)" }}
            >
              <div className="text-xs text-white/50 mb-0.5">SOL Locked</div>
              <div className="text-lg font-black text-white">{totalCommittedSOL.toFixed(3)}</div>
              <div className="text-xs font-medium mt-1" style={{ color: "#a78bfa" }}>
                🔒 Odds reveal when timer ends
              </div>
              <div className="text-xs text-white/30 mt-0.5">3% goes to creator on resolution</div>
            </div>

            {/* User's committed bet */}
            <AnimatePresence>
              {userBet && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-xl px-3 py-2 text-xs font-medium text-center"
                  style={{ background: "rgba(124,58,237,0.2)", border: "1px solid rgba(124,58,237,0.4)" }}
                >
                  Bet committed: {formatSOL(userBet.amount)} SOL
                  {userBet.isEarly && (
                    <span className="ml-1.5" style={{ color: "#fde047" }}>⚡ early</span>
                  )}
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
                <motion.button whileTap={{ scale: 0.95 }} onClick={() => setBetSide("viral")}
                  disabled={loading}
                  className="flex-1 py-3 rounded-2xl text-sm font-bold text-white"
                  style={{ background: "#7C3AED" }}
                >
                  🚀 Viral
                </motion.button>
                <motion.button whileTap={{ scale: 0.95 }} onClick={() => setBetSide("flop")}
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
          <motion.div key="phase-b" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-2">
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
                whileTap={{ scale: 0.95 }} onClick={onReveal} disabled={loading}
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
          </motion.div>
        )}

        {/* ── Phase C: Post-reveal ── */}
        {revealWindowClosed && (
          <motion.div key="phase-c" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-2">
            {odds && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="rounded-2xl p-3"
                style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)" }}
              >
                <div className="text-xs text-white/40 mb-1.5 text-center">
                  {mode === 0 ? "Most wallets voted" : "Fewest wallets voted wins"}
                </div>
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

            {isResolved && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.5 }}
                className="rounded-xl px-3 py-2 text-center text-sm font-bold"
                style={{
                  background: market?.outcome === 1
                    ? "linear-gradient(135deg, rgba(124,58,237,0.4), rgba(139,92,246,0.2))"
                    : "linear-gradient(135deg, rgba(236,72,153,0.4), rgba(244,114,182,0.2))",
                  border: `1px solid ${market?.outcome === 1 ? "#7C3AED" : "#EC4899"}`,
                }}
              >
                {market?.outcome === 1 ? "🚀 VIRAL WON!" : "💀 FLOP WON!"}
              </motion.div>
            )}

            {canClaim && (
              <motion.button
                whileTap={{ scale: 0.95 }} onClick={onClaim} disabled={loading}
                className="w-full py-3 rounded-2xl text-sm font-bold text-white"
                style={{ background: "linear-gradient(135deg, #059669, #10b981)" }}
              >
                {loading ? "Claiming..." : "💰 Claim Winnings"}
              </motion.button>
            )}

            {isAuthority && !isResolved && onResolve && (
              <button
                onClick={onResolve} disabled={loading}
                className="w-full text-xs py-2 rounded-xl border border-purple-500/50 text-purple-400 hover:bg-purple-900/20"
              >
                {loading ? "Resolving..." : "⚡ Resolve Market"}
              </button>
            )}
          </motion.div>
        )}
      </div>

      {/* Bet Modal */}
      <AnimatePresence>
        {betSide && (
          <BetModal
            side={betSide}
            isEarlyWindow={isEarlyWindow}
            feeBreakdown={feeBreakdown}
            totalCommittedSOL={totalCommittedSOL}
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
