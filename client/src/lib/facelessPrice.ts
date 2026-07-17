export const DEFAULT_FACELESS_TOKEN_MINT = "RNpE75BGjNfZ6EwUhkDfiPaTxDaPWiGssfb1Wo9pump";
export const DEFAULT_FACELESS_TOKEN_DECIMALS = 6;

// These are kept in the small balance helper because wallet balances still
// need a default before the remote pricing configuration has loaded.
export const FACELESS_TOKEN_MINT = (import.meta.env.VITE_FACELESS_PRICE_TOKEN_MINT as string | undefined)?.trim() || DEFAULT_FACELESS_TOKEN_MINT;
export const FACELESS_TOKEN_DECIMALS = Number(import.meta.env.VITE_FACELESS_TOKEN_DECIMALS ?? DEFAULT_FACELESS_TOKEN_DECIMALS);
