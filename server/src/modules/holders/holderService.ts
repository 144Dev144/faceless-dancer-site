import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import { env } from "../../config/env.js";

const connection = new Connection(env.SECONDARY_RPC_NODE || env.SOLANA_RPC_URL, "confirmed");

export async function checkHolderEligibility(ownerPublicKey: string): Promise<boolean> {
  // Holder verification is a wallet/RPC check. Keep it independent of the
  // site-settings table so a busy application pool cannot block eligibility.
  const tokenAddress = env.HOLDER_TOKEN_MINT.trim();
  if (!tokenAddress) {
    return false;
  }

  let owner: PublicKey;
  let holderMint: PublicKey;
  try {
    owner = new PublicKey(ownerPublicKey);
    holderMint = new PublicKey(tokenAddress);
  } catch {
    return false;
  }

  const tokenAccountAddress = getAssociatedTokenAddressSync(
    holderMint,
    owner,
    false,
    TOKEN_2022_PROGRAM_ID,
  );

  try {
    const balance = await connection.getTokenAccountBalance(tokenAccountAddress, "confirmed");
    return Number(balance.value.uiAmountString) >= env.HOLDER_MIN_BALANCE;
  } catch (error) {
    // A wallet without the Token-2022 associated account is not a holder. Any
    // other RPC failure remains a failed eligibility check and is logged by
    // the authentication route rather than being mistaken for a balance.
    if (String(error).toLowerCase().includes("could not find account")) return false;
    throw error;
  }
}
