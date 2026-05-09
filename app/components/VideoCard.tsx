import { FC, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { VideoEntry } from "../lib/mockData";
import { useMarket } from "../hooks/useMarket";
import { createMarket, DEVNET_TREASURY } from "../lib/program";
import { useConnection } from "@solana/wallet-adapter-react";
import MarketOverlay from "./MarketOverlay";
import CommentDrawer from "./CommentDrawer";

interface Props {
  video: VideoEntry;
  isActive: boolean;
}

function useCountdown(endTimeSec: number | null): string {
  const [display, setDisplay] = useState("--:--");

  useEffect(() => {
    if (!endTimeSec) return;
    const tick = () => {
      const diff = endTimeSec - Math.floor(Date.now() / 1000);
      if (diff <= 0) { setDisplay("ENDED"); return; }
      const m = Math.floor(diff / 60).toString().padStart(2, "0");
      const s = (diff % 60).toString().padStart(2, "0");
      setDisplay(`${m}:${s}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [endTimeSec]);

  return display;
}

const VideoCard: FC<Props> = ({ video, isActive }) => {
  const { connection } = useConnection();
  const wallet = useWallet();
  const cardRef = useRef<HTMLDivElement>(null);
  const [creating, setCreating] = useState(false);
  const [showComments, setShowComments] = useState(false);

  const videoMode = (video.mode ?? 0) as 0 | 1;

  const {
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
    comments,
    commentStats,
    loading,
    commitBet,
    revealBet,
    claimWinnings,
    resolveMarket,
    postComment,
  } = useMarket(video.id, videoMode);

  const countdown = useCountdown(market?.endTime?.toNumber() ?? null);

  const isAuthority =
    !!wallet.publicKey &&
    !!market?.authority &&
    wallet.publicKey.toBase58() === market.authority.toBase58();

  // Auto-create market on devnet when card becomes active
  useEffect(() => {
    if (!isActive || !wallet.publicKey || market || creating) return;
    setCreating(true);
    createMarket(
      connection, wallet, video.id, video.title, video.duration, videoMode, DEVNET_TREASURY
    )
      .catch(() => {})
      .finally(() => setCreating(false));
  }, [isActive, wallet.publicKey, market, creating, connection, video, videoMode]);

  const isContrarian = (market?.mode ?? videoMode) === 1;

  return (
    <div
      ref={cardRef}
      className="feed-card flex items-center justify-center"
      style={{ background: "#000" }}
    >
      <div
        className="relative w-full max-w-[390px] h-full overflow-hidden"
        style={{ background: video.gradient }}
      >
        {/* Animated overlays */}
        <motion.div
          className="absolute inset-0"
          animate={isActive ? { opacity: [0.3, 0.6, 0.3] } : { opacity: 0.3 }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          style={{ background: "radial-gradient(ellipse at 30% 40%, rgba(124,58,237,0.3) 0%, transparent 60%)" }}
        />
        <motion.div
          className="absolute inset-0"
          animate={isActive ? { opacity: [0.2, 0.5, 0.2] } : { opacity: 0.2 }}
          transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 1 }}
          style={{
            background: isContrarian
              ? "radial-gradient(ellipse at 70% 60%, rgba(220,38,38,0.3) 0%, transparent 60%)"
              : "radial-gradient(ellipse at 70% 60%, rgba(236,72,153,0.25) 0%, transparent 60%)",
          }}
        />

        {/* Title */}
        <div className="absolute inset-0 flex items-center justify-center px-8">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: isActive ? 1 : 0.4, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-3xl font-black text-white text-center leading-tight drop-shadow-2xl"
          >
            {video.title}
          </motion.h2>
        </div>

        {/* Bottom strip */}
        <div
          className="absolute bottom-0 left-0 right-0 p-4 pb-6"
          style={{ background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 100%)" }}
        >
          <div className="flex items-end gap-3">
            {/* Left: creator + timer + comment button */}
            <div className="flex-1 min-w-0">
              <Link href={`/creator/${encodeURIComponent(video.creator)}`}>
                <span className="text-white font-bold text-base hover:text-purple-300 transition-colors cursor-pointer">
                  {video.creator}
                </span>
              </Link>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-white/50 text-xs">⏱</span>
                <span
                  className="text-xs font-mono font-semibold"
                  style={{
                    color: countdown === "ENDED" ? "#EC4899" : countdown === "--:--" ? "#888" : "#a78bfa",
                  }}
                >
                  {creating ? "Creating..." : countdown}
                </span>
              </div>
              {/* Comment button */}
              <button
                onClick={() => setShowComments(true)}
                className="flex items-center gap-1.5 mt-2 text-xs text-white/50 hover:text-white/80 transition-colors"
              >
                <span>💬</span>
                <span>{comments.length > 0 ? `${comments.length} comments` : "Chat"}</span>
              </button>
            </div>

            {/* Right: market overlay */}
            <div className="w-[165px] flex-shrink-0">
              <MarketOverlay
                market={market}
                userBet={userBet}
                odds={odds}
                totalCommittedSOL={totalCommittedSOL}
                feeBreakdown={feeBreakdown}
                bettingClosed={bettingClosed}
                revealWindowClosed={revealWindowClosed}
                isEarlyWindow={isEarlyWindow}
                earlyWindowSecondsLeft={earlyWindowSecondsLeft}
                canReveal={canReveal}
                whaleCount={whaleCount}
                recentWhaleAt={recentWhaleAt}
                loading={loading}
                onCommitBet={commitBet}
                onReveal={revealBet}
                onClaim={claimWinnings}
                onResolve={resolveMarket}
                isAuthority={isAuthority}
              />
            </div>
          </div>
        </div>

        {/* Badges */}
        <div className="absolute top-4 left-4 flex items-center gap-2">
          <span
            className="text-xs font-bold px-2 py-1 rounded-full"
            style={{
              background: "rgba(124,58,237,0.3)",
              border: "1px solid rgba(124,58,237,0.5)",
              color: "#c4b5fd",
            }}
          >
            ⚡ CROWDCAST
          </span>
          {isContrarian && (
            <span
              className="text-xs font-bold px-2 py-1 rounded-full"
              style={{ background: "rgba(220,38,38,0.3)", border: "1px solid rgba(220,38,38,0.5)", color: "#fca5a5" }}
            >
              ☠️
            </span>
          )}
        </div>
      </div>

      {/* Comment drawer */}
      <CommentDrawer
        isOpen={showComments}
        onClose={() => setShowComments(false)}
        comments={comments}
        commentStats={commentStats}
        whaleCount={whaleCount}
        recentWhaleAt={recentWhaleAt}
        loading={loading}
        onPost={postComment}
      />
    </div>
  );
};

export default VideoCard;
