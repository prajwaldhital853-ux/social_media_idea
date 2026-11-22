export type Role = 'superadmin' | 'admin' | 'moderator';

export type GateCode =
  | 'sign_in_required'
  | 'staff_only'
  | 'staff_disabled'
  | 'two_factor_enrolment'
  | 'two_factor_required'
  | 'two_factor_locked'
  | 'permission_required'
  | 'code_rejected'
  | 'session_expired'
  | 'locked'
  | 'code_required';

export interface Enrolment {
  secret: string;
  otpauth_url: string;
  issuer: string;
  account: string;
  digits: number;
  period: number;
}

export interface Session {
  user: { id: number; username: string; name: string; email: string };
  role: Role;
  permissions: string[];
  /** Same keys, labelled — the server only sends the ones this seat holds. */
  permission_keys?: PermissionEntry[];
  enrolled: boolean;
  recovery_left: number;
  admin_expires_at: number | null;
  last_admin_login_at?: string | null;
}

export interface SignInChallenge {
  detail: string;
  code: GateCode;
  username: string;
  totp?: Enrolment;
  recovery_left?: number;
  retry_in?: number;
}

export interface SignedIn extends Session {
  amr: string[];
  recovery_codes: string[] | null;
}

export interface Seat {
  username: string;
  name: string;
  email: string;
  role: Role;
  is_enabled: boolean;
  enrolled: boolean;
  granted_keys: string[];
  denied_keys: string[];
  permissions: string[];
  granted_by: string | null;
  granted_at: string;
  revoked_at: string | null;
  last_admin_login_at: string | null;
  recovery_left: number;
  codes_locked_until: string | null;
}

export interface PermissionEntry {
  key: string;
  label: string;
  group: string;
  group_label?: string;
  roles: Role[];
}

export interface Catalogue {
  groups: { id: string; label: string }[];
  permissions: PermissionEntry[];
}
