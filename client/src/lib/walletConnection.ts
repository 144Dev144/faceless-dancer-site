export type SupportedWallet = "phantom" | "solflare" | "backpack" | "metamask";
const PREFERRED_WALLET_STORAGE_KEY = "faceless_preferred_wallet";

export interface SolanaProvider {
  isPhantom?: boolean;
  isSolflare?: boolean;
  isBackpack?: boolean;
  isMetaMask?: boolean;
  isConnected?: boolean;
  publicKey?: { toString(): string };
  connect: (options?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey?: { toString(): string } }>;
  signMessage: (message: Uint8Array, display?: string) => Promise<{ signature: Uint8Array }>;
  sendTransaction?: (transaction: unknown, connection: unknown) => Promise<string>;
  signAndSendTransaction?: (transaction: unknown, options?: unknown) => Promise<unknown>;
  signTransaction?: (transaction: unknown) => Promise<unknown>;
}

export function setPreferredWallet(wallet: SupportedWallet): void {
  window.localStorage.setItem(PREFERRED_WALLET_STORAGE_KEY, wallet);
}

export function getPreferredWallet(): SupportedWallet | null {
  const raw = String(window.localStorage.getItem(PREFERRED_WALLET_STORAGE_KEY) ?? "").trim();
  if (raw === "phantom" || raw === "solflare" || raw === "backpack" || raw === "metamask") {
    return raw;
  }
  return null;
}

export function getInjectedProviders(): SolanaProvider[] {
  const anyWindow = window as any;
  const providers = [
    anyWindow.phantom?.solana,
    anyWindow.solflare,
    anyWindow.backpack?.solana,
    anyWindow.solana,
    ...(Array.isArray(anyWindow.solana?.providers) ? anyWindow.solana.providers : []),
  ].filter(Boolean) as SolanaProvider[];

  return Array.from(new Set(providers));
}

export function getProvider(wallet: SupportedWallet): SolanaProvider | undefined {
  const providers = getInjectedProviders();
  switch (wallet) {
    case "phantom":
      return providers.find((provider) => provider.isPhantom);
    case "solflare":
      return providers.find((provider) => provider.isSolflare);
    case "backpack":
      return providers.find((provider) => provider.isBackpack);
    case "metamask":
      return providers.find((provider) => provider.isMetaMask);
    default:
      return undefined;
  }
}

function supportsProviderCapability(
  provider: SolanaProvider,
  capability: "signMessage" | "sendTransaction",
): boolean {
  if (capability === "signMessage") return typeof provider.signMessage === "function";
  return typeof provider.sendTransaction === "function"
    || typeof provider.signAndSendTransaction === "function"
    || typeof provider.signTransaction === "function";
}

function withTimeout<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("Wallet provider discovery timed out")), timeoutMs);
    task.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Resolve the provider that owns the authenticated address.
 *
 * Wallets can expose several wrapper objects for the same extension, and some
 * only populate `publicKey` after a trusted reconnect. Prefer the wrapper
 * selected during authentication, then probe the remaining wrappers silently.
 */
export async function resolveProviderForAddress(
  walletAddress: string,
  capability: "signMessage" | "sendTransaction",
): Promise<SolanaProvider | undefined> {
  const address = walletAddress.trim();
  if (!address) return undefined;

  const preferredWallet = getPreferredWallet();
  const preferredProvider = preferredWallet ? getProvider(preferredWallet) : undefined;
  const providers = Array.from(new Set([
    ...(preferredProvider ? [preferredProvider] : []),
    ...getInjectedProviders(),
  ]));

  const directMatch = providers.find((provider) =>
    provider.publicKey?.toString?.() === address && supportsProviderCapability(provider, capability),
  );
  if (directMatch) return directMatch;

  for (const provider of providers) {
    if (!supportsProviderCapability(provider, capability)) continue;
    try {
      const result = await withTimeout(provider.connect({ onlyIfTrusted: true }), 1500);
      const connectedAddress = result.publicKey?.toString?.() ?? provider.publicKey?.toString?.() ?? "";
      if (connectedAddress === address) return provider;
    } catch {
      // Silent reconnect is only a discovery probe. The explicit signing or
      // transaction call below remains responsible for user approval.
    }
  }

  // A restored site session can outlive the wallet extension's trusted
  // connection. Reconnect the wallet selected during authentication so the
  // payment flow can open the wallet normally instead of failing before the
  // transaction prompt is shown.
  if (preferredProvider && supportsProviderCapability(preferredProvider, capability)) {
    try {
      const result = await withTimeout(preferredProvider.connect(), 10_000);
      const connectedAddress = result.publicKey?.toString?.() ?? preferredProvider.publicKey?.toString?.() ?? "";
      if (connectedAddress === address) return preferredProvider;
    } catch {
      // The payment helper will present the user-facing reconnect error.
    }
  }

  return undefined;
}

export function detectConnectedWalletPublicKey(): string {
  for (const provider of getInjectedProviders()) {
    const key = provider.publicKey?.toString?.() ?? "";
    if (key) {
      return key;
    }
  }
  return "";
}

export async function refreshWalletConnectionStatus(): Promise<string> {
  const existingKey = detectConnectedWalletPublicKey();
  if (existingKey) {
    return existingKey;
  }

  const preferredWallet = getPreferredWallet();
  const preferredProvider = preferredWallet ? getProvider(preferredWallet) : undefined;
  const providers = [
    ...(preferredProvider ? [preferredProvider] : []),
    ...getInjectedProviders().filter((provider) => provider !== preferredProvider),
  ];

  for (const provider of providers) {
    try {
      await provider.connect({ onlyIfTrusted: true });
    } catch {
      // Ignore providers that reject silent reconnect.
    }
    const key = provider.publicKey?.toString?.() ?? "";
    if (key) {
      return key;
    }
  }

  return "";
}
