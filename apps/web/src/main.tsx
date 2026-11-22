import { Buffer } from "buffer";
(globalThis as any).Buffer = Buffer;

import React, { useMemo } from "react";
import ReactDOM from "react-dom/client";
import { ConnectionProvider as CP, WalletProvider as WP } from "@solana/wallet-adapter-react";
import { WalletModalProvider as WMP } from "@solana/wallet-adapter-react-ui";

// wallet-adapter ships React 19 typings; cast for React 18.
const ConnectionProvider = CP as any;
const WalletProvider = WP as any;
const WalletModalProvider = WMP as any;
import "@solana/wallet-adapter-react-ui/styles.css";
import "./styles.css";
import { App } from "./App";
import { installPixelKit } from "./ui/pixelKit";
installPixelKit();
import { BASE_RPC } from "./chain/config";

function Root() {
  // Wallet Standard auto-detects Phantom, Solflare, Backpack, etc.
  const wallets = useMemo(() => [], []);
  return (
    <ConnectionProvider endpoint={BASE_RPC}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <App />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
