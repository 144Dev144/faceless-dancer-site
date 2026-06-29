import { useEffect, useRef, useState } from "preact/hooks";
import { ChevronDown, Gamepad2, LogOut, Share2, UserRound, WandSparkles } from "lucide-preact";
import logoImage from "../../assets/hero/logo.png";
import { api, type AuthSessionResponse } from "../../lib/api";
import type { SessionState } from "../../hooks/useSession";
import {
  getPreferredWallet,
  getProvider,
  setPreferredWallet,
  type SupportedWallet,
} from "../../lib/walletConnection";
import bs58 from "bs58";

const navLinks = [
  { href: "/game", label: "Dance Stage", Icon: Gamepad2 },
  { href: "/library", label: "Library", Icon: Share2 },
  { href: "/dance-station", label: "Dance Station", Icon: WandSparkles },
];

const walletLabels: Record<SupportedWallet, string> = {
  phantom: "Phantom",
  solflare: "Solflare",
  backpack: "Backpack",
  metamask: "MetaMask",
};

const signedOutSession: SessionState = {
  loading: false,
  authenticated: false,
  publicKey: "",
  isHolder: false,
  isAdmin: false,
  creatorProfile: null,
};

interface Props {
  session: SessionState;
  setSession: (next: SessionState) => void;
}

function shortAddress(value: string): string {
  return value ? `${value.slice(0, 6)}...${value.slice(-4)}` : "";
}

function profileLabel(session: SessionState): string {
  const displayName = session.creatorProfile?.displayName?.trim();
  return displayName || shortAddress(session.publicKey);
}

function profileBadge(session: SessionState): string {
  const displayName = session.creatorProfile?.displayName?.trim();
  if (displayName) return displayName.slice(0, 1).toUpperCase();
  return session.publicKey.slice(0, 2).toUpperCase();
}

export function HomeTopNav({ session, setSession }: Props): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const [wallet, setWallet] = useState<SupportedWallet>(() => getPreferredWallet() ?? "phantom");
  const [authStatus, setAuthStatus] = useState("");
  const [displayName, setDisplayName] = useState(session.creatorProfile?.displayName ?? "");
  const [profileStatus, setProfileStatus] = useState("");
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setDisplayName(session.creatorProfile?.displayName ?? "");
  }, [session.creatorProfile?.displayName]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [menuOpen]);

  const signAndVerify = async () => {
    const provider = getProvider(wallet);
    if (!provider) {
      throw new Error(`${walletLabels[wallet]} wallet not found. Install or unlock it before signing.`);
    }

    const connectResult = await provider.connect();
    const publicKey = connectResult.publicKey?.toString();
    if (!publicKey) {
      throw new Error("Missing public key");
    }
    setPreferredWallet(wallet);

    setAuthStatus("Requesting nonce...");
    const noncePayload = await api.nonce(publicKey);

    setAuthStatus("Signing message...");
    const encoded = new TextEncoder().encode(noncePayload.message);
    const signed = await provider.signMessage(encoded, "utf8");
    const signatureBase58 = bs58.encode(signed.signature);

    setAuthStatus("Verifying...");
    const verified = await api.verify({
      publicKey,
      nonce: noncePayload.nonce,
      message: noncePayload.message,
      signature: signatureBase58,
    });

    setSession({ loading: false, ...verified });
    setDisplayName(verified.creatorProfile?.displayName ?? "");
    setAuthStatus("");
    setMenuOpen(false);
  };

  const saveDisplayName = async () => {
    const value = displayName.trim();
    setProfileStatus("Saving...");
    const next = await api.saveCreatorProfile({ displayName: value || null });
    setSession({ loading: false, ...next });
    setDisplayName(next.creatorProfile?.displayName ?? "");
    setProfileStatus("Saved");
    window.setTimeout(() => setProfileStatus(""), 1800);
  };

  const logout = async () => {
    await api.logout();
    setSession(signedOutSession);
    setMenuOpen(false);
    setAuthStatus("");
    setProfileStatus("");
  };

  return (
    <header className="home-v2-nav">
      <a className="home-v2-nav__brand" href="/">
        <img src={logoImage} alt="The Faceless Dancer logo" />
        <span>The Faceless Dancer</span>
      </a>

      <nav className="home-v2-nav__links" aria-label="Primary">
        {navLinks.map(({ href, label, Icon }) => (
          <a key={href} href={href} aria-label={label} title={label}>
            <Icon aria-hidden="true" size={17} strokeWidth={2.1} />
            <span>{label}</span>
          </a>
        ))}
      </nav>

      <div className="home-v2-nav__auth" ref={menuRef}>
        <button
          type="button"
          className="home-v2-nav__cta"
          onClick={() => setMenuOpen((value) => !value)}
        >
          {session.authenticated ? (
            <>
              <span className="home-v2-nav__avatar">
                {session.creatorProfile?.avatarUrl ? <img src={session.creatorProfile.avatarUrl} alt="" /> : profileBadge(session)}
              </span>
              <span>{profileLabel(session)}</span>
              <ChevronDown aria-hidden="true" size={15} strokeWidth={2.2} />
            </>
          ) : (
            <>
              <UserRound aria-hidden="true" size={16} strokeWidth={2.1} />
              <span>Login / Sign In</span>
            </>
          )}
        </button>

        {menuOpen ? (
          <div className="home-v2-nav__menu">
            {session.authenticated ? (
              <>
                <div className="home-v2-nav__menu-head">
                  <strong>{profileLabel(session)}</strong>
                  <span>{session.isHolder ? "Verified holder" : "Authenticated user"}</span>
                </div>
                <label className="home-v2-nav__menu-field">
                  <span>Display Name</span>
                  <input
                    type="text"
                    value={displayName}
                    onInput={(event) => setDisplayName((event.currentTarget as HTMLInputElement).value)}
                    placeholder="Add display name"
                  />
                </label>
                <button type="button" className="home-v2-nav__menu-action" onClick={() => saveDisplayName().catch((error) => setProfileStatus(error.message))}>
                  Update Display Name
                </button>
                <button type="button" className="home-v2-nav__menu-action home-v2-nav__menu-action--danger" onClick={() => logout().catch((error) => setProfileStatus(error.message))}>
                  <LogOut aria-hidden="true" size={15} strokeWidth={2.1} />
                  <span>Logout</span>
                </button>
                {profileStatus ? <p className="home-v2-nav__menu-status">{profileStatus}</p> : null}
              </>
            ) : (
              <>
                <label className="home-v2-nav__menu-field">
                  <span>Wallet</span>
                  <select
                    value={wallet}
                    onInput={(event) => {
                      const nextWallet = (event.currentTarget as HTMLSelectElement).value as SupportedWallet;
                      setWallet(nextWallet);
                      setPreferredWallet(nextWallet);
                    }}
                  >
                    <option value="phantom">Phantom</option>
                    <option value="solflare">Solflare</option>
                    <option value="backpack">Backpack</option>
                    <option value="metamask">MetaMask</option>
                  </select>
                </label>
                <button type="button" className="home-v2-nav__menu-action" onClick={() => signAndVerify().catch((error) => setAuthStatus(error.message))}>
                  Connect + Verify
                </button>
                <p className="home-v2-nav__menu-note">Sign a wallet nonce to authenticate your account.</p>
                {authStatus ? <p className="home-v2-nav__menu-status">{authStatus}</p> : null}
              </>
            )}
          </div>
        ) : null}
      </div>
    </header>
  );
}
