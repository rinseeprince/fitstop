import { supabaseAdmin } from "./supabase-admin";

// Generate a unique token for check-in link (256 bits of entropy, URL-safe)
export const generateCheckInToken = (): string => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

// Create a check-in token for a client
export const createCheckInToken = async (
  clientId: string
): Promise<{ token: string; expiresAt: string }> => {
  const token = generateCheckInToken();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7); // Expires in 7 days

  const { data, error } = await supabaseAdmin
    .from("check_in_tokens")
    .insert({
      client_id: clientId,
      token,
      expires_at: expiresAt.toISOString(),
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create check-in token: ${error.message}`);
  }

  return {
    token: data.token,
    expiresAt: data.expires_at,
  };
};

// Validate a check-in token
export const validateCheckInToken = async (
  token: string
): Promise<{ valid: boolean; clientId?: string; tokenId?: string }> => {
  const { data, error } = await supabaseAdmin
    .from("check_in_tokens")
    .select("*")
    .eq("token", token)
    .single();

  if (error || !data) {
    return { valid: false };
  }

  // Check if token is expired
  const now = new Date();
  const expiresAt = new Date(data.expires_at);
  if (now > expiresAt) {
    return { valid: false };
  }

  // Check if token was already used
  if (data.used_at) {
    return { valid: false };
  }

  return {
    valid: true,
    clientId: data.client_id,
    tokenId: data.id,
  };
};

/**
 * Atomically claim a token for processing to prevent race conditions.
 * Uses a conditional update to ensure only one request can claim the token.
 * @returns true if token was claimed, false if already claimed by another request
 */
export const claimTokenForProcessing = async (
  tokenId: string
): Promise<boolean> => {
  // Only claim if used_at is null (not already used)
  const { data, error } = await supabaseAdmin
    .from("check_in_tokens")
    .update({
      used_at: new Date().toISOString(),
    })
    .eq("id", tokenId)
    .is("used_at", null)
    .select("id");

  if (error) {
    throw new Error(`Failed to claim token: ${error.message}`);
  }

  // If data is empty, token was already claimed by another request
  return data && data.length > 0;
};

/**
 * Update a claimed token with the check-in ID after successful submission.
 */
export const updateTokenWithCheckInId = async (
  tokenId: string,
  checkInId: string
): Promise<void> => {
  const { error } = await supabaseAdmin
    .from("check_in_tokens")
    .update({
      check_in_id: checkInId,
    })
    .eq("id", tokenId);

  if (error) {
    throw new Error(`Failed to update token with check-in ID: ${error.message}`);
  }
};

/**
 * Release a claimed token if check-in submission fails.
 * This allows the user to retry.
 */
export const releaseToken = async (tokenId: string): Promise<void> => {
  const { error } = await supabaseAdmin
    .from("check_in_tokens")
    .update({
      used_at: null,
      check_in_id: null,
    })
    .eq("id", tokenId);

  if (error) {
    console.error(`Failed to release token: ${error.message}`);
    // Don't throw - this is a cleanup operation
  }
};

// Mark token as used (kept for backward compatibility)
export const markTokenAsUsed = async (
  tokenId: string,
  checkInId: string
): Promise<void> => {
  const { error } = await supabaseAdmin
    .from("check_in_tokens")
    .update({
      used_at: new Date().toISOString(),
      check_in_id: checkInId,
    })
    .eq("id", tokenId);

  if (error) {
    throw new Error(`Failed to mark token as used: ${error.message}`);
  }
};
