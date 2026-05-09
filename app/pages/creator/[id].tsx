import { NextPage, GetServerSideProps } from "next";
import Head from "next/head";
import Link from "next/link";
import { motion } from "framer-motion";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { VIDEOS, CREATOR_VIDEOS, getMockCreatorHistory, VideoEntry } from "../../lib/mockData";

interface Props {
  creatorHandle: string;
  videos: VideoEntry[];
  crowdScore: number;
  history: { date: string; score: number }[];
  totalEarned: number;
  marketsCreated: number;
  totalVolume: number;
}

// Mini SVG line chart
function LineChart({ data }: { data: { date: string; score: number }[] }) {
  const W = 320;
  const H = 80;
  const pad = 10;

  const scores = data.map((d) => d.score);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = max - min || 1;

  const points = data.map((d, i) => {
    const x = pad + ((W - pad * 2) / (data.length - 1)) * i;
    const y = H - pad - ((d.score - min) / range) * (H - pad * 2);
    return `${x},${y}`;
  });

  const polyline = points.join(" ");
  const area = `${pad},${H - pad} ${polyline} ${W - pad},${H - pad}`;

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
      <defs>
        <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7C3AED" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#7C3AED" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill="url(#chartGrad)" />
      <polyline
        points={polyline}
        fill="none"
        stroke="#7C3AED"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {data.map((d, i) => {
        const [x, y] = points[i].split(",").map(Number);
        return (
          <circle
            key={i}
            cx={x}
            cy={y}
            r="3"
            fill="#7C3AED"
            stroke="#000"
            strokeWidth="1.5"
          />
        );
      })}
    </svg>
  );
}

const CreatorPage: NextPage<Props> = ({ creatorHandle, videos, crowdScore, history, totalEarned, marketsCreated, totalVolume }) => {
  const lastScore = history[history.length - 1]?.score ?? 50;
  const prevScore = history[history.length - 2]?.score ?? lastScore;
  const trend = lastScore - prevScore;

  return (
    <>
      <Head>
        <title>{creatorHandle} — CrowdCast</title>
      </Head>

      <main className="min-h-screen bg-black text-white">
        {/* Nav */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <Link href="/" className="text-white/60 hover:text-white transition-colors text-sm">
            ← Feed
          </Link>
          <span
            className="text-base font-black"
            style={{
              background: "linear-gradient(90deg, #7C3AED, #EC4899)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            ⚡ CrowdCast
          </span>
          <WalletMultiButton style={{ height: 32, fontSize: 12, padding: "0 12px" }} />
        </div>

        <div className="max-w-[390px] mx-auto px-4 py-6">
          {/* Creator header */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6"
          >
            {/* Avatar placeholder */}
            <div
              className="w-16 h-16 rounded-full mb-3 flex items-center justify-center text-2xl font-black"
              style={{
                background: "linear-gradient(135deg, #7C3AED, #EC4899)",
              }}
            >
              {creatorHandle.charAt(1).toUpperCase()}
            </div>

            <h1 className="text-2xl font-black">{creatorHandle}</h1>
            <p className="text-white/50 text-sm mt-1">
              {videos.length} content piece{videos.length !== 1 ? "s" : ""} on CrowdCast
            </p>
          </motion.div>

          {/* Crowd Score card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="rounded-2xl p-4 mb-5"
            style={{
              background: "linear-gradient(135deg, rgba(124,58,237,0.2), rgba(236,72,153,0.1))",
              border: "1px solid rgba(124,58,237,0.3)",
            }}
          >
            <p className="text-xs text-white/50 uppercase tracking-wider mb-1">Crowd Score</p>
            <div className="flex items-end gap-3">
              <span className="text-5xl font-black" style={{ color: "#7C3AED" }}>
                {crowdScore}
              </span>
              <span className="text-sm mb-2" style={{ color: trend >= 0 ? "#10b981" : "#ef4444" }}>
                {trend >= 0 ? "↑" : "↓"} {Math.abs(trend).toFixed(0)} pts
              </span>
            </div>
            <p className="text-white/40 text-xs mt-1">
              Viral wins ratio — higher = crowd loves their content
            </p>
          </motion.div>

          {/* Creator stats row */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="grid grid-cols-3 gap-2 mb-5"
          >
            {[
              { label: "Earned", value: `${totalEarned.toFixed(3)} SOL`, sub: "3% creator fee" },
              { label: "Markets", value: String(marketsCreated), sub: "created" },
              { label: "Volume", value: `${totalVolume.toFixed(2)} SOL`, sub: "total pot" },
            ].map((stat) => (
              <div
                key={stat.label}
                className="rounded-2xl p-3 text-center"
                style={{ background: "#0a0a0a", border: "1px solid #1a1a1a" }}
              >
                <p className="text-xs text-white/40 mb-1">{stat.label}</p>
                <p className="text-sm font-bold text-white leading-tight">{stat.value}</p>
                <p className="text-xs text-white/25 mt-0.5">{stat.sub}</p>
              </div>
            ))}
          </motion.div>

          {/* Chart */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="rounded-2xl p-4 mb-6"
            style={{ background: "#0a0a0a", border: "1px solid #1a1a1a" }}
          >
            <p className="text-xs text-white/50 uppercase tracking-wider mb-3">
              Score History (12 weeks)
            </p>
            <LineChart data={history} />
            <div className="flex justify-between text-xs text-white/30 mt-2">
              <span>{history[0]?.date}</span>
              <span>{history[history.length - 1]?.date}</span>
            </div>
          </motion.div>

          {/* Content cards */}
          <div>
            <p className="text-xs text-white/50 uppercase tracking-wider mb-3">Content</p>
            <div className="flex flex-col gap-3">
              {videos.map((video, i) => (
                <motion.div
                  key={video.id}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 + i * 0.05 }}
                  className="rounded-2xl overflow-hidden flex items-center gap-3 p-3"
                  style={{ background: "#0a0a0a", border: "1px solid #1a1a1a" }}
                >
                  {/* Thumbnail gradient */}
                  <div
                    className="w-14 h-14 rounded-xl flex-shrink-0"
                    style={{ background: video.gradient }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">
                      {video.title}
                    </p>
                    <p className="text-xs text-white/40 mt-0.5">
                      {Math.floor(video.duration / 60)}m {video.duration % 60}s
                    </p>
                  </div>
                  <Link
                    href="/"
                    className="text-xs font-semibold px-3 py-1.5 rounded-full flex-shrink-0"
                    style={{ background: "rgba(124,58,237,0.2)", color: "#a78bfa" }}
                  >
                    View
                  </Link>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </>
  );
};

export const getServerSideProps: GetServerSideProps = async ({ params }) => {
  const creatorHandle = decodeURIComponent(params?.id as string);
  const videos = CREATOR_VIDEOS[creatorHandle] ?? VIDEOS.filter((v) => v.creator === creatorHandle);
  const history = getMockCreatorHistory(creatorHandle);
  const crowdScore = history[history.length - 1]?.score ?? 50;

  // Deterministic mock creator stats (falls back from on-chain for demo)
  const seed = creatorHandle.charCodeAt(1) % 10;
  const marketsCreated = Math.max(1, videos.length);
  const totalVolume = parseFloat((marketsCreated * (1.5 + seed * 0.4)).toFixed(2));
  const totalEarned = parseFloat((totalVolume * 0.03).toFixed(4));

  return {
    props: {
      creatorHandle,
      videos,
      crowdScore,
      history,
      totalEarned,
      marketsCreated,
      totalVolume,
    },
  };
};

export default CreatorPage;
