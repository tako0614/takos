export type PrincipalKind =
  | "user"
  | "space_agent"
  | "service"
  | "system"
  | "tenant_worker";

export interface Principal {
  id: string;
  type: PrincipalKind;
  display_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: string;
  principal_id?: string;
  email: string;
  name: string;
  username: string;
  principal_kind?: PrincipalKind;
  bio: string | null;
  picture: string | null;
  trust_tier: string;
  setup_completed: boolean;
  created_at: string;
  updated_at: string;
}

export interface Session {
  id: string;
  user_id: string;
  expires_at: number;
  created_at: number;
  /**
   * Wall-clock millisecond timestamp of the most recent session ID rotation.
   * Used by the auth middleware to decide when to mint a fresh session ID
   * (1h cadence) and re-issue the cookie. When absent, the auth middleware
   * treats the session as eligible for rotation immediately.
   */
  last_rotated_at?: number;
}

export interface OIDCState {
  state: string;
  nonce: string;
  code_verifier: string;
  return_to: string;
  expires_at: number;
  cli_callback?: string;
}
