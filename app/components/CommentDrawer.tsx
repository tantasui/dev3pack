import { FC, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Comment, UserStats } from "../hooks/useMarket";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  comments: Comment[];
  commentStats: Record<string, UserStats>;
  whaleCount: number;
  recentWhaleAt: number | null;
  loading: boolean;
  onPost: (content: string) => Promise<void>;
}

function relativeTime(timestamp: number): string {
  const diff = Math.floor(Date.now() / 1000) - timestamp;
  if (diff < 10) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function truncateAddress(pubkey: PublicKey): string {
  const s = pubkey.toBase58();
  return `${s.slice(0, 4)}...${s.slice(-4)}`;
}

const WinBadge: FC<{ stats: UserStats | undefined }> = ({ stats }) => {
  if (!stats || stats.totalBets < 3) {
    return (
      <span
        title="Less than 3 bets — new player"
        className="text-xs font-bold px-1.5 py-0.5 rounded-full"
        style={{ background: "rgba(59,130,246,0.2)", color: "#93c5fd", border: "1px solid rgba(59,130,246,0.3)" }}
      >
        NEW
      </span>
    );
  }
  const label = `${stats.totalWins}/${stats.totalBets}`;
  const title = `${stats.totalWins} correct predictions out of ${stats.totalBets} total`;
  if (stats.winRate > 0.6) {
    return (
      <span
        title={title}
        className="text-xs font-bold px-1.5 py-0.5 rounded-full"
        style={{ background: "rgba(16,185,129,0.2)", color: "#6ee7b7", border: "1px solid rgba(16,185,129,0.3)" }}
      >
        {label} ✓
      </span>
    );
  }
  return (
    <span
      title={title}
      className="text-xs font-medium px-1.5 py-0.5 rounded-full"
      style={{ background: "rgba(255,255,255,0.06)", color: "#6b7280", border: "1px solid rgba(255,255,255,0.1)" }}
    >
      {label}
    </span>
  );
};

interface SystemMessage {
  id: number;
  type: "whale";
  text: string;
  ts: number;
}

const CommentDrawer: FC<Props> = ({
  isOpen,
  onClose,
  comments,
  commentStats,
  whaleCount,
  recentWhaleAt,
  loading,
  onPost,
}) => {
  const { connected } = useWallet();
  const { setVisible } = useWalletModal();
  const [input, setInput] = useState("");
  const [postError, setPostError] = useState("");
  const [posting, setPosting] = useState(false);
  const [systemMessages, setSystemMessages] = useState<SystemMessage[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Add system message on whale event
  useEffect(() => {
    if (!recentWhaleAt) return;
    setSystemMessages((prev) => [
      ...prev,
      {
        id: recentWhaleAt,
        type: "whale",
        text: "🐋 A whale entered the market. Nobody knows which side.",
        ts: Math.floor(Date.now() / 1000),
      },
    ]);
  }, [recentWhaleAt]);

  // Auto-scroll on new comments or system messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [comments.length, systemMessages.length]);

  async function handlePost() {
    if (!input.trim()) return;
    setPostError("");
    setPosting(true);
    try {
      await onPost(input.trim());
      setInput("");
    } catch (e: any) {
      setPostError(e?.message ?? "Post failed");
    } finally {
      setPosting(false);
    }
  }

  // Merge comments and system messages sorted by time
  type AnyMessage =
    | { kind: "comment"; data: Comment; ts: number }
    | { kind: "system"; data: SystemMessage; ts: number };

  const merged: AnyMessage[] = [
    ...comments.map((c) => ({ kind: "comment" as const, data: c, ts: c.timestamp })),
    ...systemMessages.map((s) => ({ kind: "system" as const, data: s, ts: s.ts })),
  ].sort((a, b) => a.ts - b.ts);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-30"
            onClick={onClose}
          />

          {/* Drawer */}
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 35, stiffness: 450 }}
            className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[390px] z-40 rounded-t-3xl flex flex-col"
            style={{ background: "#0a0a0a", border: "1px solid #1a1a1a", height: "70dvh" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Handle */}
            <div className="flex-shrink-0 pt-3 pb-2 px-4">
              <div className="w-10 h-1 bg-white/20 rounded-full mx-auto mb-3" />
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-white">🎙 Market Chat</h3>
                <button onClick={onClose} className="text-white/40 hover:text-white text-xl leading-none">×</button>
              </div>
              <p className="text-xs italic mt-1" style={{ color: "#854D0E" }}>
                Comments may be deceptive. Trust no one.
              </p>
            </div>

            <div className="h-px bg-white/5 flex-shrink-0" />

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
              {merged.length === 0 && (
                <div className="text-center text-white/30 text-sm pt-8">
                  No comments yet.<br />
                  <span className="text-xs">Be the first to sow confusion.</span>
                </div>
              )}

              {merged.map((item) => {
                if (item.kind === "system") {
                  return (
                    <motion.div
                      key={`sys-${item.data.id}`}
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="rounded-xl px-3 py-2 text-xs text-center font-medium"
                      style={{ background: "rgba(133,77,14,0.3)", border: "1px solid rgba(133,77,14,0.5)", color: "#fcd34d" }}
                    >
                      {item.data.text}
                    </motion.div>
                  );
                }

                const comment = item.data;
                const stats = commentStats[comment.author.toBase58()];

                return (
                  <motion.div
                    key={comment.publicKey.toBase58()}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex gap-2.5"
                  >
                    {/* Avatar */}
                    <div
                      className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold"
                      style={{ background: `hsl(${parseInt(comment.author.toBase58().slice(0, 4), 36) % 360}, 60%, 40%)` }}
                    >
                      {comment.author.toBase58().charAt(0).toUpperCase()}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                        <span className="text-xs font-semibold text-white/70 font-mono">
                          {truncateAddress(comment.author)}
                        </span>
                        <WinBadge stats={stats} />
                        <span className="text-xs text-white/30">{relativeTime(comment.timestamp)}</span>
                      </div>
                      <p className="text-sm text-white/90 leading-snug break-words">
                        {comment.content}
                      </p>
                    </div>
                  </motion.div>
                );
              })}

              <div ref={bottomRef} />
            </div>

            {/* Input bar */}
            <div className="flex-shrink-0 border-t border-white/5 p-3">
              {postError && (
                <p className="text-red-400 text-xs mb-2 px-1">{postError}</p>
              )}
              {!connected ? (
                <button
                  onClick={() => setVisible(true)}
                  className="w-full py-2.5 rounded-2xl text-sm font-semibold text-white"
                  style={{ background: "linear-gradient(135deg, #7C3AED, #EC4899)" }}
                >
                  Connect wallet to comment
                </button>
              ) : (
                <div className="flex gap-2">
                  <input
                    value={input}
                    onChange={(e) => setInput(e.target.value.slice(0, 280))}
                    onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handlePost()}
                    placeholder="Say something... or don't. Either helps."
                    className="flex-1 rounded-2xl px-4 py-2.5 text-sm text-white outline-none"
                    style={{ background: "#1a1a1a", border: "1px solid #2a2a2a" }}
                    maxLength={280}
                  />
                  <motion.button
                    whileTap={{ scale: 0.93 }}
                    onClick={handlePost}
                    disabled={posting || !input.trim()}
                    className="px-4 py-2.5 rounded-2xl text-sm font-bold text-white flex-shrink-0"
                    style={{
                      background: posting || !input.trim()
                        ? "#2a2a2a"
                        : "linear-gradient(135deg, #7C3AED, #EC4899)",
                    }}
                  >
                    {posting ? "..." : "Post"}
                  </motion.button>
                </div>
              )}
              <p className="text-white/20 text-xs text-center mt-2">
                Comments are permanent and public on-chain.
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default CommentDrawer;
