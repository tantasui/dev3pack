import { FC, ReactNode, useMemo } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";

// Backpack may not export a named adapter — use dynamic import fallback
let BackpackWalletAdapter: any;
try {
  BackpackWalletAdapter = require("@solana/wallet-adapter-backpack").BackpackWalletAdapter;
} catch {
  BackpackWalletAdapter = null;
}

require("@solana/wallet-adapter-react-ui/styles.css");

const DEVNET_RPC = "https://api.devnet.solana.com";

interface Props {
  children: ReactNode;
}

const AppWalletProvider: FC<Props> = ({ children }) => {
  const wallets = useMemo(() => {
    const adapters: any[] = [new PhantomWalletAdapter()];
    if (BackpackWalletAdapter) {
      adapters.push(new BackpackWalletAdapter());
    }
    return adapters;
  }, []);

  return (
    <ConnectionProvider endpoint={DEVNET_RPC}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
};

export default AppWalletProvider;
