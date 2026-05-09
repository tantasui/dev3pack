import { FC, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { VideoEntry } from "../lib/mockData";
import { useMarket } from "../hooks/useMarket";
import { createMarket, getMarketPda } from "../lib/program";
import { useConnection } from "@solana/wallet-adapter-react";
import MarketOverlay from "./MarketOverlay";

interface Props {
  video: VideoEntry;
  isActive: boolean;
}

function useCountdown(endTime: number | null): string {
  const [display, setDisplay] = useState("--:--");

  useEffect(() => {
    if (!endTime) return;
    const tick = () => {
      const diff = endTime - Math.floor(Date.now() / 1000);
      if (diff <= 0) {
        setDisplay("ENDED");
        return;
      }
      const m = Math.floor(diff / 60).toString().padStart(2, "0");
      const s = (diff % 60).toString().padStart(2, "0");
      setDisplay(`${m}:${s}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [endTime]);

  return display;
}

const VideoCard: FC<Props> = ({ video, isActive }) => {
  const { connection } = useConnection();
  const wallet = useWallet();
  const cardRef = useRef<HTMLDivElement>(null);
  const [creating, setCreating] = useState(false);

  const { market, userBet, odds, loading, placeBet, claimWinnings, resolveMarket } =
    useMarket(video.id);

  const countdown = useCountdown(market?.endTime?.toNumber() ?? null);

  const isAuthority =
    wallet.publicKey?.toBase58() === market?.authority?.toBase58();

  // Auto-create market on devnet when card becomes active
  useEffect(() => {
    if (!isActive || !wallet.publicKey || market || creating) return;
    setCreating(true);
    createMarket(connection, wallet, video.id, video.title, video.duration)
      .catch(() => {}) // ignore if already exists
      .finally(() => setCreating(false));
  }, [isActive, wallet.publicKey, market, creating, connection, video]);

  return (
    <div
      ref={cardRef}
      className="feed-card flex items-center justify-center"
      style={{ background: "#000" }}
    >
      {/* Centered card */}
      <div
        className="relative w-full max-w-[390px] h-full overflow-hidden"
        style={{ background: video.gradient }}
      >
        {/* Animated gradient overlay for visual interest */}
        <motion.div
          className="absolute inset-0"
          animate={
            isActive
              ? { opacity: [0.3, 0.6, 0.3] }
              : { opacity: 0.3 }
          }
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          style={{
            background:
              "radial-gradient(ellipse at 30% 40%, rgba(124,58,237,0.3) 0%, transparent 60%)",
          }}
        />
        <motion.div
          className="absolute inset-0"
          animate={
            isActive
              ? { opacity: [0.2, 0.5, 0.2] }
              : { opacity: 0.2 }
          }
          transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 1 }}
          style={{
            background:
              "radial-gradient(ellipse at 70% 60%, rgba(236,72,153,0.25) 0%, transparent 60%)",
          }}
        />

        {/* Content title (mock "video") */}
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

        {/* Bottom info strip */}
        <div className="absolute bottom-0 left-0 right-0 p-4 pb-6"
          style={{
            background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 100%)",
          }}
        >
          <div className="flex items-end gap-3">
            {/* Left: creator + timer */}
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
                    color:
                      countdown === "ENDED"
                        ? "#EC4899"
                        : countdown === "--:--"
                        ? "#888"
                        : "#a78bfa",
                  }}
                >
                  {creating ? "Creating market..." : countdown}
                </span>
              </div>
            </div>

            {/* Right: market overlay */}
            <div className="w-[160px] flex-shrink-0">
              <MarketOverlay
                market={market}
                userBet={userBet}
                odds={odds}
                loading={loading}
                onPlaceBet={placeBet}
                onClaim={claimWinnings}
                onResolve={resolveMarket}
                isAuthority={isAuthority}
              />
            </div>
          </div>
        </div>

        {/* CrowdCast badge */}
        <div className="absolute top-4 left-4">
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
        </div>
      </div>
    </div>
  );
};

export default VideoCard;
