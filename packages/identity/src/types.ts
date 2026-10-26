export type IdentityUser = {
  id: string;
  email: string | null;
  phone: string | null;
  displayName: string;
  avatarUrl: string | null;
};

export type IdentitySession = {
  user: IdentityUser;
  expiresAt: string;
};

export type LoginParams = {
  email?: string;
  phone?: string;
  displayName?: string;
  nextPath?: string;
};

export type IdentityProvider = {
  getSession(request: Request): Promise<IdentitySession | null>;
  login(params: LoginParams): Promise<IdentitySession>;
  logout(request: Request): Promise<void>;
};

export type DevIdentityInput = {
  email?: string;
  phone?: string;
  displayName?: string;
};
