import type { NextPage } from "next";
import dynamic from "next/dynamic";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

// Feed uses browser APIs (IntersectionObserver) so disable SSR
const Feed = dynamic(() => import("../components/Feed"), { ssr: false });

const Home: NextPage = () => {
  return (
    <main className="relative bg-black min-h-screen">
      {/* Top nav — floats above feed */}
      <div
        className="fixed top-0 left-1/2 -translate-x-1/2 w-full max-w-[390px] z-30 flex items-center justify-between px-4 py-3"
        style={{
          background: "linear-gradient(to bottom, rgba(0,0,0,0.8) 0%, transparent 100%)",
        }}
      >
        <span
          className="text-lg font-black tracking-tight"
          style={{ background: "linear-gradient(90deg, #7C3AED, #EC4899)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}
        >
          ⚡ CrowdCast
        </span>
        <WalletMultiButton style={{ height: 36, fontSize: 13, padding: "0 16px" }} />
      </div>

      <Feed />
    </main>
  );
};

export default Home;
