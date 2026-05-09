import type { AppProps } from "next/app";
import Head from "next/head";
import AppWalletProvider from "../components/WalletProvider";
import "../styles/globals.css";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <title>CrowdCast — Attention Markets</title>
        <meta name="description" content="Bet SOL on viral or flop — TikTok-style attention prediction markets on Solana" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#000000" />
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚡</text></svg>" />
      </Head>
      <AppWalletProvider>
        <Component {...pageProps} />
      </AppWalletProvider>
    </>
  );
}
