export interface VideoEntry {
  id: string;
  title: string;
  creator: string;
  duration: number; // seconds
  gradient: string; // CSS gradient string
}

export const VIDEOS: VideoEntry[] = [
  {
    id: "v001",
    title: "This beat goes insane 🔥",
    creator: "@wavemakr",
    duration: 300,
    gradient: "linear-gradient(135deg, #0f0c29, #302b63, #24243e)",
  },
  {
    id: "v002",
    title: "POV: You discovered alpha early",
    creator: "@cryptonative",
    duration: 180,
    gradient: "linear-gradient(135deg, #200122, #6f0000)",
  },
  {
    id: "v003",
    title: "Built this in 24hrs on Solana",
    creator: "@tantasui",
    duration: 420,
    gradient: "linear-gradient(135deg, #0a3d62, #1e3799)",
  },
  {
    id: "v004",
    title: "The crowd never lies",
    creator: "@crowdtheory",
    duration: 240,
    gradient: "linear-gradient(135deg, #1a1a2e, #16213e, #0f3460)",
  },
  {
    id: "v005",
    title: "Why everyone is wrong about this",
    creator: "@contrarian",
    duration: 360,
    gradient: "linear-gradient(135deg, #0d0d0d, #1a0533, #2d0060)",
  },
  {
    id: "v006",
    title: "What the algo doesn't want you to see",
    creator: "@redpillweb3",
    duration: 300,
    gradient: "linear-gradient(135deg, #1a0000, #3d0000, #200122)",
  },
];

export const CREATOR_VIDEOS: Record<string, VideoEntry[]> = {
  "@wavemakr": [VIDEOS[0]],
  "@cryptonative": [VIDEOS[1]],
  "@tantasui": [VIDEOS[2]],
  "@crowdtheory": [VIDEOS[3]],
  "@contrarian": [VIDEOS[4]],
  "@redpillweb3": [VIDEOS[5]],
};

// Mock creator crowd scores over time (for the line chart)
export function getMockCreatorHistory(creator: string): { date: string; score: number }[] {
  const seed = creator.charCodeAt(1) % 10;
  return Array.from({ length: 12 }, (_, i) => ({
    date: new Date(Date.now() - (11 - i) * 7 * 24 * 3600 * 1000)
      .toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    score: Math.min(100, Math.max(10, 45 + seed * 3 + i * 2 + Math.round(Math.sin(i + seed) * 15))),
  }));
}
