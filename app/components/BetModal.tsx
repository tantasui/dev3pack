import { FC, useState } from "react";
import { motion } from "framer-motion";
import { BetSide } from "../hooks/useMarket";

interface Props {
  side: BetSide;
  onClose: () => void;
  /** Secret is generated automatically inside the hook — caller just needs amount */
  onConfirm: (amountSOL: number) => Promise<void>;
  loading: boolean;
}

const BetModal: FC<Props> = ({ side, onClose, onConfirm, loading }) => {
  const [amount, setAmount] = useState("0.1");
  const [error, setError] = useState("");

  const isViral = side === "viral";
  const accentColor = isViral ? "#7C3AED" : "#EC4899";
  const label = isViral ? "🚀 VIRAL" : "💀 FLOP";

  async function handleConfirm() {
    setError("");
    const n = parseFloat(amount);
    if (isNaN(n) || n < 0.01) {
      setError("Minimum bet is 0.01 SOL");
      return;
    }
    try {
      await onConfirm(n);
    } catch (e: any) {
      setError(e?.message ?? "Transaction failed");
    }
  }

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Sheet */}
      <motion.div
        initial={{ y: "100%", opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: "100%", opacity: 0 }}
        transition={{ type: "spring", damping: 30, stiffness: 400 }}
        className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[390px] z-50 rounded-t-3xl p-6"
        style={{ background: "#111", border: `1px solid ${accentColor}40` }}
      >
        {/* Handle */}
        <div className="w-10 h-1 bg-white/20 rounded-full mx-auto mb-5" />

        <h2 className="text-xl font-bold mb-1">
          Bet <span style={{ color: accentColor }}>{label}</span>
        </h2>

        {/* Commit-reveal explanation */}
        <div
          className="rounded-xl px-3 py-2.5 mb-5 text-xs"
          style={{ background: "rgba(124,58,237,0.1)", border: "1px solid rgba(124,58,237,0.2)" }}
        >
          <p className="text-white/70 leading-relaxed">
            🔒 <strong className="text-white">Blind bet:</strong> Your choice is sealed until the
            timer ends. No one can see which side you're on — including us.
            Reveal your bet during the 1hr reveal window after the timer.
          </p>
        </div>

        {/* Amount input */}
        <label className="block text-xs text-white/60 font-medium mb-1 uppercase tracking-wider">
          Amount (SOL)
        </label>
        <div
          className="flex items-center rounded-2xl px-4 py-3 mb-2"
          style={{ background: "#1a1a1a", border: `1px solid ${accentColor}40` }}
        >
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            min="0.01"
            step="0.01"
            className="flex-1 bg-transparent text-white text-xl font-bold outline-none"
            placeholder="0.00"
          />
          <span className="text-white/40 text-sm font-medium ml-2">SOL</span>
        </div>

        {/* Quick amount buttons */}
        <div className="flex gap-2 mb-6">
          {["0.1", "0.25", "0.5", "1"].map((v) => (
            <button
              key={v}
              onClick={() => setAmount(v)}
              className="flex-1 py-1.5 rounded-xl text-xs font-semibold transition-all"
              style={{
                background: amount === v ? accentColor : "#1a1a1a",
                color: amount === v ? "#fff" : "#888",
                border: `1px solid ${amount === v ? accentColor : "#333"}`,
              }}
            >
              {v}
            </button>
          ))}
        </div>

        {error && (
          <p className="text-red-400 text-xs mb-3 text-center">{error}</p>
        )}

        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={handleConfirm}
          disabled={loading}
          className="w-full py-4 rounded-2xl font-bold text-white text-base transition-all"
          style={{
            background: loading
              ? "#333"
              : `linear-gradient(135deg, ${accentColor}, ${isViral ? "#EC4899" : "#7C3AED"})`,
          }}
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Sealing bet...
            </span>
          ) : (
            `Seal Bet — ${amount || "0"} SOL`
          )}
        </motion.button>

        <p className="text-white/30 text-xs text-center mt-3">
          You'll need to reveal your bet within 1hr of the timer ending or it's forfeited.
        </p>
      </motion.div>
    </>
  );
};

export default BetModal;
