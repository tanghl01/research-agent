import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import DypnsapiClient, { CheckSmsVerifyCodeRequest, SendSmsVerifyCodeRequest } from "@alicloud/dypnsapi20170525";
import { $OpenApiUtil } from "@alicloud/openapi-core";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { getDatabase, organizationMemberships, phoneLoginChallenges, userIdentities, userSessions, users } from "@operator/db";
import {
  clearSessionCookieHeader,
  createOidcJwtIdentityProviderFromEnv,
  createSessionCookieValue,
  parseSessionCookieHeader,
  parseSessionCookieValue,
  sessionCookieHeader,
  tokenFromRequest,
  type IdentityUser
} from "@operator/identity";
import { getOperatorBackendRuntimeStatus, isUnverifiedEmailLoginAllowed } from "./config";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const GUEST_SESSION_TTL_SECONDS = 60 * 60 * 24 * 90;
const EMAIL_PROVIDER = "email";
const PHONE_PROVIDER = "phone";
const GUEST_PROVIDER = "guest";
const OIDC_PROVIDER_PREFIX = "oidc";
const PHONE_LOGIN_CODE_TTL_SECONDS = 60 * 10;
const PHONE_LOGIN_MAX_ATTEMPTS = 5;
const PHONE_LOGIN_PURPOSE_LOCAL = "login";
const PHONE_LOGIN_PURPOSE_ALIYUN_DYPNS = "login:aliyun-dypns";
const ALIYUN_DYPNS_CODE_PREFIX = "aliyun-dypns:";
const ALIYUN_DYPNS_OFFICIAL_SIGN_NAME = "速通互联验证码";
const ALIYUN_DYPNS_OFFICIAL_TEMPLATE_CODE = "100001";

export type OperatorSessionUser = {
  id: string;
  email: string | null;
  phone: string | null;
  displayName: string;
  avatarUrl: string | null;
  isGuest: boolean;
};

export type OperatorSessionUserResult =
  | {
      enabled: false;
      authenticated: false;
      user: null;
      error: null;
    }
  | {
      enabled: true;
      authenticated: false;
      user: null;
      error: string | null;
    }
  | {
      enabled: true;
      authenticated: true;
      user: OperatorSessionUser;
      error: null;
    };

export type OperatorLoginResult = {
  session: Extract<OperatorSessionUserResult, { authenticated: true }>;
  cookie: string;
};

export type OperatorPhoneLoginCodeResult = {
  phone: string;
  expiresAt: string;
  debugCode: string | null;
};

type OidcSessionResolution = {
  attempted: boolean;
  user: OperatorSessionUser | null;
};

export async function loginOperatorUserWithEmail(params: {
  email: string;
  displayName?: string;
  request?: Request;
}): Promise<OperatorLoginResult> {
  const status = getOperatorBackendRuntimeStatus();
  if (!status.enabled) {
    throw new Error("Operator account backend is not configured.");
  }
  if (!isUnverifiedEmailLoginAllowed()) {
    throw new Error(
      "Email login requires a verified identity provider. Set OPERATOR_ALLOW_UNVERIFIED_EMAIL_LOGIN=true only for trusted development deployments."
    );
  }

  const email = normalizeEmail(params.email);
  if (!email) throw new Error("A valid email address is required.");

  const displayName = params.displayName?.trim() || email.split("@")[0] || "Operator User";
  const current = params.request ? await getOperatorSessionUser(params.request) : await getOperatorSessionUser();
  const user =
    current.authenticated && current.user.isGuest
      ? await promoteOrAttachGuestUser({ guestUserId: current.user.id, email, displayName })
      : await findOrCreateEmailUser(email, displayName);

  const result = await createSessionForUser(user, { isGuest: false, ttlSeconds: SESSION_TTL_SECONDS, request: params.request });

  return {
    session: result.session,
    cookie: result.cookie
  };
}

export async function requestOperatorPhoneLoginCode(params: { phone: string }): Promise<OperatorPhoneLoginCodeResult> {
  const status = getOperatorBackendRuntimeStatus();
  if (!status.enabled) {
    throw new Error("Operator account backend is not configured.");
  }
  assertLocalSessionSecretConfigured();

  const phone = normalizePhoneForLogin(params.phone);
  if (!phone) throw new Error("A valid phone number is required.");

  const ttlSeconds = phoneLoginCodeTtlSeconds();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  const provider = phoneLoginProvider();
  if (provider === "aliyun-dypns") {
    const delivery = await deliverAliyunDypnsPhoneLoginCode({ phone, ttlSeconds });
    await getDatabase()
      .insert(phoneLoginChallenges)
      .values({
        phone,
        codeHash: `${ALIYUN_DYPNS_CODE_PREFIX}${delivery.outId}`,
        purpose: PHONE_LOGIN_PURPOSE_ALIYUN_DYPNS,
        maxAttempts: PHONE_LOGIN_MAX_ATTEMPTS,
        expiresAt
      });
    return {
      phone,
      expiresAt: expiresAt.toISOString(),
      debugCode: delivery.debugCode
    };
  }

  const code = generatePhoneLoginCode();
  await getDatabase()
    .insert(phoneLoginChallenges)
    .values({
      phone,
      codeHash: hashPhoneLoginCode(phone, code),
      purpose: PHONE_LOGIN_PURPOSE_LOCAL,
      maxAttempts: PHONE_LOGIN_MAX_ATTEMPTS,
      expiresAt
    });

  const delivery = await deliverPhoneLoginCode({ phone, code, expiresAt });
  return {
    phone,
    expiresAt: expiresAt.toISOString(),
    debugCode: delivery.debugCode ?? null
  };
}

export async function loginOperatorUserWithPhone(params: {
  phone: string;
  code: string;
  email?: string | null;
  displayName?: string;
  request?: Request;
}): Promise<OperatorLoginResult> {
  const status = getOperatorBackendRuntimeStatus();
  if (!status.enabled) {
    throw new Error("Operator account backend is not configured.");
  }
  assertLocalSessionSecretConfigured();

  const phone = normalizePhoneForLogin(params.phone);
  if (!phone) throw new Error("A valid phone number is required.");

  const email = normalizeOptionalEmail(params.email);
  if (params.email?.trim() && !email) throw new Error("A valid safety email address is required.");

  await consumePhoneLoginCode(phone, params.code);

  const displayName = params.displayName?.trim() || email?.split("@")[0] || phone;
  const current = params.request ? await getOperatorSessionUser(params.request) : await getOperatorSessionUser();
  const user =
    current.authenticated && current.user.isGuest
      ? await promoteOrAttachGuestUserWithPhone({ guestUserId: current.user.id, phone, email, displayName })
      : await findOrCreatePhoneUser(phone, displayName, email);

  const result = await createSessionForUser(user, { isGuest: false, ttlSeconds: SESSION_TTL_SECONDS, request: params.request });

  return {
    session: result.session,
    cookie: result.cookie
  };
}

export async function createOperatorSessionForUser(
  user: typeof users.$inferSelect,
  options?: { isGuest?: boolean; ttlSeconds?: number; request?: Request }
): Promise<OperatorLoginResult> {
  return createSessionForUser(user, {
    isGuest: options?.isGuest ?? false,
    ttlSeconds: options?.ttlSeconds ?? SESSION_TTL_SECONDS,
    request: options?.request
  });
}

export async function getOperatorSessionUser(request?: Request): Promise<OperatorSessionUserResult> {
  const status = getOperatorBackendRuntimeStatus();
  if (!status.enabled) {
    return { enabled: false, authenticated: false, user: null, error: null };
  }

  let oidcResolution: OidcSessionResolution;
  try {
    oidcResolution = await resolveOidcOperatorSessionUser(request);
  } catch (error) {
    console.error("[operator] OIDC identity verification failed.", error);
    return { enabled: true, authenticated: false, user: null, error: "OIDC identity verification failed." };
  }
  if (oidcResolution.user) {
    return {
      enabled: true,
      authenticated: true,
      user: oidcResolution.user,
      error: null
    };
  }
  if (oidcResolution.attempted || isOidcIdentityRequired()) {
    return { enabled: true, authenticated: false, user: null, error: "OIDC identity is required." };
  }

  const value = await readSessionCookie(request);
  const sessionToken = parseSessionCookieValue(value);
  if (!sessionToken) {
    return { enabled: true, authenticated: false, user: null, error: null };
  }

  const db = getDatabase();
  const sessionHash = hashSessionToken(sessionToken);
  const [session] = await db
    .select()
    .from(userSessions)
    .where(and(eq(userSessions.sessionHash, sessionHash), isNull(userSessions.revokedAt), gt(userSessions.expiresAt, new Date())))
    .limit(1);

  if (!session) {
    return { enabled: true, authenticated: false, user: null, error: null };
  }

  const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
  if (user?.status !== "active") {
    return { enabled: true, authenticated: false, user: null, error: null };
  }
  const isGuest = await isGuestUser(user);

  return {
    enabled: true,
    authenticated: true,
    user: serializeOperatorUser(user, { isGuest }),
    error: null
  };
}

export async function getOrCreateOperatorSessionUser(
  request?: Request
): Promise<OperatorSessionUserResult & { setCookie?: string | null }> {
  const existing = await getOperatorSessionUser(request);
  if (existing.authenticated || !existing.enabled) {
    return { ...existing, setCookie: null };
  }

  const guest = await createGuestOperatorUser();
  const created = await createSessionForUser(guest, { isGuest: true, ttlSeconds: GUEST_SESSION_TTL_SECONDS, request });
  return { ...created.session, setCookie: created.cookie };
}

export async function signOutOperatorSession(request?: Request): Promise<string> {
  const status = getOperatorBackendRuntimeStatus();
  if (!status.enabled) return clearSessionCookieHeader();

  const sessionToken = parseSessionCookieValue(await readSessionCookie(request));
  if (sessionToken) {
    await getDatabase()
      .update(userSessions)
      .set({ revokedAt: new Date() })
      .where(eq(userSessions.sessionHash, hashSessionToken(sessionToken)))
      .catch((error) => {
        console.error("[operator] failed to revoke local session during sign out.", error);
      });
  }

  return clearSessionCookieHeader();
}

export async function updateOperatorUserProfile(
  request: Request,
  params: { displayName: string; safetyEmail?: string | null }
): Promise<OperatorSessionUser> {
  const status = getOperatorBackendRuntimeStatus();
  if (!status.enabled) {
    throw new Error("Operator account backend is not configured.");
  }

  const session = await getOperatorSessionUser(request);
  if (!session.authenticated) throw new Error("Authentication is required.");
  if (session.user.isGuest) throw new Error("Please log in before managing account settings.");

  const displayName = params.displayName.trim();
  if (!displayName) throw new Error("Display name is required.");

  const safetyEmailInput = params.safetyEmail?.trim();
  const safetyEmail = safetyEmailInput ? normalizeEmail(safetyEmailInput) : null;
  if (safetyEmailInput && !safetyEmail) throw new Error("A valid safety email address is required.");

  if (safetyEmail) await attachSafetyEmailIdentity(session.user.id, safetyEmail);

  const [updated] = await getDatabase()
    .update(users)
    .set({
      displayName,
      ...(safetyEmail ? { primaryEmail: safetyEmail } : {}),
      updatedAt: new Date()
    })
    .where(eq(users.id, session.user.id))
    .returning();

  if (!updated) throw new Error("Account profile no longer exists.");
  return serializeOperatorUser(updated, { isGuest: false });
}

export function serializeOperatorUser(user: typeof users.$inferSelect, options?: { isGuest?: boolean }): OperatorSessionUser {
  return {
    id: user.id,
    email: user.primaryEmail ?? null,
    phone: user.primaryPhone ?? null,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl ?? null,
    isGuest: options?.isGuest ?? false
  };
}

async function findOrCreateEmailUser(email: string, displayName: string): Promise<typeof users.$inferSelect> {
  const db = getDatabase();
  const existing = await findEmailUser(email);
  if (existing) return existing;

  try {
    return await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          primaryEmail: email,
          displayName,
          status: "active"
        })
        .returning();
      if (!user) throw new Error("Failed to create user.");
      await tx.insert(userIdentities).values({
        userId: user.id,
        provider: EMAIL_PROVIDER,
        providerSubject: email,
        email,
        rawProfile: {}
      });
      return user;
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const createdByConcurrentRequest = await findEmailUser(email);
    if (createdByConcurrentRequest) return createdByConcurrentRequest;
    throw error;
  }
}

async function findOrCreatePhoneUser(phone: string, displayName: string, email: string | null): Promise<typeof users.$inferSelect> {
  const db = getDatabase();
  const existing = await findPhoneUser(phone);
  if (existing) return syncPhoneUserSafetyEmail(existing, { phone, email });

  try {
    return await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          primaryEmail: email,
          primaryPhone: phone,
          displayName,
          status: "active"
        })
        .returning();
      if (!user) throw new Error("Failed to create user.");
      await tx.insert(userIdentities).values({
        userId: user.id,
        provider: PHONE_PROVIDER,
        providerSubject: phone,
        phone,
        rawProfile: {
          verified: true
        }
      });
      if (email) {
        await tx.insert(userIdentities).values({
          userId: user.id,
          provider: EMAIL_PROVIDER,
          providerSubject: email,
          email,
          rawProfile: {
            safetyBinding: true
          }
        });
      }
      return user;
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const createdByConcurrentRequest = await findPhoneUser(phone);
    if (createdByConcurrentRequest) return syncPhoneUserSafetyEmail(createdByConcurrentRequest, { phone, email });
    if (email && (await findEmailUser(email))) {
      throw new Error("This safety email is already bound to another account.");
    }
    throw error;
  }
}

async function resolveOidcOperatorSessionUser(request?: Request): Promise<OidcSessionResolution> {
  const provider = createOidcJwtIdentityProviderFromEnv();
  if (!provider) return { attempted: false, user: null };
  const identityRequest = request ?? (await requestFromNextCookies());
  if (!oidcTokenFromRequest(identityRequest)) return { attempted: false, user: null };
  const identitySession = await provider.getSession(identityRequest);
  if (!identitySession) return { attempted: true, user: null };
  const user = await findOrCreateOidcUser(identitySession.user);
  return { attempted: true, user: serializeOperatorUser(user, { isGuest: false }) };
}

function oidcTokenFromRequest(request: Request): string | undefined {
  const cookieName = process.env.OPERATOR_OIDC_COOKIE_NAME?.trim();
  return cookieName ? tokenFromRequest(request, cookieName) : tokenFromRequest(request);
}

async function findOrCreateOidcUser(identity: IdentityUser): Promise<typeof users.$inferSelect> {
  const provider = oidcProviderKey();
  const subject = identity.id.trim();
  if (!subject) throw new Error("OIDC subject is required.");

  const existing = await findIdentityUser(provider, subject);
  if (existing) return syncVerifiedIdentityProfile(existing, identity);

  const displayName = identity.displayName?.trim() || identity.email?.split("@")[0] || identity.phone || "Operator User";
  try {
    return await getDatabase().transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          primaryEmail: normalizeOptionalEmail(identity.email),
          primaryPhone: normalizeOptionalString(identity.phone),
          displayName,
          avatarUrl: normalizeOptionalString(identity.avatarUrl),
          status: "active"
        })
        .returning();
      if (!user) throw new Error("Failed to create OIDC user.");
      await tx.insert(userIdentities).values({
        userId: user.id,
        provider,
        providerSubject: subject,
        email: normalizeOptionalEmail(identity.email),
        phone: normalizeOptionalString(identity.phone),
        rawProfile: {
          standard: "oidc"
        }
      });
      return user;
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const createdByConcurrentRequest = await findIdentityUser(provider, subject);
    if (createdByConcurrentRequest) return syncVerifiedIdentityProfile(createdByConcurrentRequest, identity);
    throw error;
  }
}

async function syncVerifiedIdentityProfile(user: typeof users.$inferSelect, identity: IdentityUser): Promise<typeof users.$inferSelect> {
  const nextEmail = normalizeOptionalEmail(identity.email);
  const nextPhone = normalizeOptionalString(identity.phone);
  const nextDisplayName = identity.displayName?.trim() || user.displayName;
  const nextAvatarUrl = normalizeOptionalString(identity.avatarUrl);
  if (
    user.primaryEmail === nextEmail &&
    user.primaryPhone === nextPhone &&
    user.displayName === nextDisplayName &&
    (user.avatarUrl ?? null) === nextAvatarUrl
  ) {
    return user;
  }

  const [updated] = await getDatabase()
    .update(users)
    .set({
      primaryEmail: nextEmail,
      primaryPhone: nextPhone,
      displayName: nextDisplayName,
      avatarUrl: nextAvatarUrl,
      updatedAt: new Date()
    })
    .where(eq(users.id, user.id))
    .returning();
  return updated ?? user;
}

async function findIdentityUser(provider: string, providerSubject: string): Promise<typeof users.$inferSelect | null> {
  const [row] = await getDatabase()
    .select({ user: users })
    .from(userIdentities)
    .innerJoin(users, eq(userIdentities.userId, users.id))
    .where(and(eq(userIdentities.provider, provider), eq(userIdentities.providerSubject, providerSubject)))
    .limit(1);
  return row?.user ?? null;
}

async function createGuestOperatorUser(): Promise<typeof users.$inferSelect> {
  const db = getDatabase();
  const providerSubject = `guest_${randomBytes(18).toString("base64url")}`;
  const displayName = `访客 ${providerSubject.slice(-6)}`;

  try {
    return await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          primaryEmail: null,
          primaryPhone: null,
          displayName,
          status: "active"
        })
        .returning();
      if (!user) throw new Error("Failed to create guest user.");
      await tx.insert(userIdentities).values({
        userId: user.id,
        provider: GUEST_PROVIDER,
        providerSubject,
        rawProfile: {
          guest: true
        }
      });
      return user;
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return createGuestOperatorUser();
  }
}

async function promoteOrAttachGuestUser(params: {
  guestUserId: string;
  email: string;
  displayName: string;
}): Promise<typeof users.$inferSelect> {
  const existing = await findEmailUser(params.email);
  if (!existing) return promoteGuestUserToEmailUser(params);
  if (existing.id !== params.guestUserId) await attachGuestOrganizationsToUser(params.guestUserId, existing.id);
  return existing;
}

async function promoteOrAttachGuestUserWithPhone(params: {
  guestUserId: string;
  phone: string;
  email: string | null;
  displayName: string;
}): Promise<typeof users.$inferSelect> {
  const existing = await findPhoneUser(params.phone);
  if (!existing) return promoteGuestUserToPhoneUser(params);
  if (existing.id !== params.guestUserId) await attachGuestOrganizationsToUser(params.guestUserId, existing.id);
  return syncPhoneUserSafetyEmail(existing, { phone: params.phone, email: params.email });
}

async function promoteGuestUserToEmailUser(params: {
  guestUserId: string;
  email: string;
  displayName: string;
}): Promise<typeof users.$inferSelect> {
  const db = getDatabase();
  try {
    return await db.transaction(async (tx) => {
      const [user] = await tx
        .update(users)
        .set({
          primaryEmail: params.email,
          displayName: params.displayName,
          updatedAt: new Date()
        })
        .where(eq(users.id, params.guestUserId))
        .returning();
      if (!user) throw new Error("Guest user no longer exists.");
      await tx.insert(userIdentities).values({
        userId: user.id,
        provider: EMAIL_PROVIDER,
        providerSubject: params.email,
        email: params.email,
        rawProfile: {}
      });
      return user;
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const existing = await findEmailUser(params.email);
    if (!existing) throw error;
    await attachGuestOrganizationsToUser(params.guestUserId, existing.id);
    return existing;
  }
}

async function promoteGuestUserToPhoneUser(params: {
  guestUserId: string;
  phone: string;
  email: string | null;
  displayName: string;
}): Promise<typeof users.$inferSelect> {
  const db = getDatabase();
  try {
    return await db.transaction(async (tx) => {
      const [user] = await tx
        .update(users)
        .set({
          primaryEmail: params.email,
          primaryPhone: params.phone,
          displayName: params.displayName,
          updatedAt: new Date()
        })
        .where(eq(users.id, params.guestUserId))
        .returning();
      if (!user) throw new Error("Guest user no longer exists.");
      await tx.insert(userIdentities).values({
        userId: user.id,
        provider: PHONE_PROVIDER,
        providerSubject: params.phone,
        phone: params.phone,
        rawProfile: {
          verified: true
        }
      });
      if (params.email) {
        await tx.insert(userIdentities).values({
          userId: user.id,
          provider: EMAIL_PROVIDER,
          providerSubject: params.email,
          email: params.email,
          rawProfile: {
            safetyBinding: true
          }
        });
      }
      return user;
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const existing = await findPhoneUser(params.phone);
    if (existing) {
      await attachGuestOrganizationsToUser(params.guestUserId, existing.id);
      return syncPhoneUserSafetyEmail(existing, { phone: params.phone, email: params.email });
    }
    if (params.email && (await findEmailUser(params.email))) {
      throw new Error("This safety email is already bound to another account.");
    }
    throw error;
  }
}

async function syncPhoneUserSafetyEmail(
  user: typeof users.$inferSelect,
  params: { phone: string; email: string | null }
): Promise<typeof users.$inferSelect> {
  if (params.email) await attachSafetyEmailIdentity(user.id, params.email);
  const nextEmail = params.email ?? user.primaryEmail;
  if (user.primaryPhone === params.phone && user.primaryEmail === nextEmail) return user;

  const [updated] = await getDatabase()
    .update(users)
    .set({
      primaryPhone: params.phone,
      primaryEmail: nextEmail,
      updatedAt: new Date()
    })
    .where(eq(users.id, user.id))
    .returning();
  return updated ?? user;
}

async function attachSafetyEmailIdentity(userId: string, email: string): Promise<void> {
  const existing = await findEmailUser(email);
  if (existing) {
    if (existing.id !== userId) throw new Error("This safety email is already bound to another account.");
    return;
  }

  try {
    await getDatabase()
      .insert(userIdentities)
      .values({
        userId,
        provider: EMAIL_PROVIDER,
        providerSubject: email,
        email,
        rawProfile: {
          safetyBinding: true
        }
      });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const createdByConcurrentRequest = await findEmailUser(email);
    if (!createdByConcurrentRequest || createdByConcurrentRequest.id === userId) return;
    throw new Error("This safety email is already bound to another account.");
  }
}

async function attachGuestOrganizationsToUser(guestUserId: string, targetUserId: string): Promise<void> {
  if (guestUserId === targetUserId) return;
  const db = getDatabase();
  const memberships = await db
    .select({ orgId: organizationMemberships.orgId })
    .from(organizationMemberships)
    .where(and(eq(organizationMemberships.userId, guestUserId), eq(organizationMemberships.status, "active")));
  for (const membership of memberships) {
    await db
      .insert(organizationMemberships)
      .values({
        orgId: membership.orgId,
        userId: targetUserId,
        role: "owner",
        status: "active"
      })
      .onConflictDoUpdate({
        target: [organizationMemberships.orgId, organizationMemberships.userId],
        set: {
          role: "owner",
          status: "active",
          updatedAt: new Date()
        }
      });
  }
}

async function createSessionForUser(
  user: typeof users.$inferSelect,
  options: { isGuest: boolean; ttlSeconds: number; request?: Request }
): Promise<OperatorLoginResult> {
  const db = getDatabase();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + options.ttlSeconds * 1000);
  const [session] = await db
    .insert(userSessions)
    .values({
      userId: user.id,
      sessionHash: hashSessionToken(token),
      expiresAt
    })
    .returning();
  if (!session) throw new Error("Failed to create session.");

  const cookieValue = createSessionCookieValue(token);

  return {
    session: {
      enabled: true,
      authenticated: true,
      user: serializeOperatorUser(user, { isGuest: options.isGuest }),
      error: null
    },
    cookie: sessionCookieHeader(cookieValue, {
      maxAgeSeconds: options.ttlSeconds,
      secure: shouldUseSecureSessionCookie(options.request)
    })
  };
}

async function findEmailUser(email: string): Promise<typeof users.$inferSelect | null> {
  const [row] = await getDatabase()
    .select({ user: users })
    .from(userIdentities)
    .innerJoin(users, eq(userIdentities.userId, users.id))
    .where(and(eq(userIdentities.provider, EMAIL_PROVIDER), eq(userIdentities.providerSubject, email)))
    .limit(1);
  return row?.user ?? null;
}

async function findPhoneUser(phone: string): Promise<typeof users.$inferSelect | null> {
  const [row] = await getDatabase()
    .select({ user: users })
    .from(userIdentities)
    .innerJoin(users, eq(userIdentities.userId, users.id))
    .where(and(eq(userIdentities.provider, PHONE_PROVIDER), eq(userIdentities.providerSubject, phone)))
    .limit(1);
  return row?.user ?? null;
}

async function consumePhoneLoginCode(phone: string, codeInput: string): Promise<void> {
  const code = normalizePhoneLoginCode(codeInput);
  if (!code) throw new Error("A valid verification code is required.");

  const [challenge] = await getDatabase()
    .select()
    .from(phoneLoginChallenges)
    .where(
      and(eq(phoneLoginChallenges.phone, phone), isNull(phoneLoginChallenges.consumedAt), gt(phoneLoginChallenges.expiresAt, new Date()))
    )
    .orderBy(desc(phoneLoginChallenges.createdAt))
    .limit(1);

  if (!challenge) throw new Error("Verification code expired. Request a new code.");
  if (challenge.attempts >= challenge.maxAttempts) {
    await getDatabase().update(phoneLoginChallenges).set({ consumedAt: new Date() }).where(eq(phoneLoginChallenges.id, challenge.id));
    throw new Error("Verification code attempts exceeded. Request a new code.");
  }

  if (challenge.purpose === PHONE_LOGIN_PURPOSE_ALIYUN_DYPNS) {
    const outId = challenge.codeHash.startsWith(ALIYUN_DYPNS_CODE_PREFIX) ? challenge.codeHash.slice(ALIYUN_DYPNS_CODE_PREFIX.length) : "";
    const passed = await checkAliyunDypnsPhoneLoginCode({ phone, code, outId });
    if (!passed) {
      await getDatabase()
        .update(phoneLoginChallenges)
        .set({ attempts: challenge.attempts + 1 })
        .where(eq(phoneLoginChallenges.id, challenge.id));
      throw new Error("Verification code is incorrect.");
    }
    await getDatabase().update(phoneLoginChallenges).set({ consumedAt: new Date() }).where(eq(phoneLoginChallenges.id, challenge.id));
    return;
  }

  if (!safeHashEqual(challenge.codeHash, hashPhoneLoginCode(phone, code))) {
    await getDatabase()
      .update(phoneLoginChallenges)
      .set({ attempts: challenge.attempts + 1 })
      .where(eq(phoneLoginChallenges.id, challenge.id));
    throw new Error("Verification code is incorrect.");
  }

  await getDatabase().update(phoneLoginChallenges).set({ consumedAt: new Date() }).where(eq(phoneLoginChallenges.id, challenge.id));
}

async function isGuestUser(user: typeof users.$inferSelect): Promise<boolean> {
  if (user.primaryEmail || user.primaryPhone) return false;
  const [identity] = await getDatabase()
    .select({ id: userIdentities.id })
    .from(userIdentities)
    .where(and(eq(userIdentities.userId, user.id), eq(userIdentities.provider, GUEST_PROVIDER)))
    .limit(1);
  return Boolean(identity);
}

function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) ? email : "";
}

function normalizeOptionalEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  return normalizeEmail(value) || null;
}

export function normalizePhoneForLogin(value: string): string {
  const compact = value.trim().replace(/[\s().-]/gu, "");
  if (/^1[3-9]\d{9}$/u.test(compact)) return `+86${compact}`;
  if (/^861[3-9]\d{9}$/u.test(compact)) return `+${compact}`;
  if (/^\+\d{8,15}$/u.test(compact)) return compact;
  return "";
}

export function shouldUseSecureSessionCookie(request?: Request, env: Record<string, string | undefined> = process.env): boolean {
  if (booleanEnv(env.OPERATOR_TRUST_PROXY_HEADERS) === true) {
    const forwardedProto = request?.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
    if (forwardedProto === "https") return true;
    if (forwardedProto === "http") return false;
  }

  if (env.NODE_ENV === "production") return true;

  if (request) {
    try {
      return new URL(request.url).protocol === "https:";
    } catch {
      return false;
    }
  }

  return false;
}

function normalizePhoneLoginCode(value: string): string {
  const code = value.trim().replace(/\s/gu, "");
  return /^\d{6}$/u.test(code) ? code : "";
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function hashPhoneLoginCode(phone: string, code: string): string {
  return createHmac("sha256", getSessionSecret()).update(`${phone}:${code}`).digest("hex");
}

function safeHashEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function generatePhoneLoginCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

function phoneLoginCodeTtlSeconds(): number {
  const value = Number(process.env.OPERATOR_PHONE_LOGIN_CODE_TTL_SECONDS);
  if (!Number.isFinite(value)) return PHONE_LOGIN_CODE_TTL_SECONDS;
  return Math.min(60 * 30, Math.max(60, Math.floor(value)));
}

type PhoneLoginProvider = "aliyun-dypns" | "webhook" | "debug";

function phoneLoginProvider(): PhoneLoginProvider {
  const explicit = process.env.OPERATOR_PHONE_LOGIN_PROVIDER?.trim().toLowerCase();
  if (explicit === "aliyun-dypns" || explicit === "webhook" || explicit === "debug") return explicit;
  if (isAliyunDypnsConfigured()) return "aliyun-dypns";
  if (process.env.OPERATOR_SMS_WEBHOOK_URL?.trim()) return "webhook";
  return "debug";
}

async function deliverPhoneLoginCode(params: { phone: string; code: string; expiresAt: Date }): Promise<{ debugCode: string | null }> {
  if (phoneLoginProvider() === "webhook") {
    const webhookUrl = process.env.OPERATOR_SMS_WEBHOOK_URL?.trim();
    if (!webhookUrl) throw new Error("Phone login SMS webhook is not configured.");
    const token = process.env.OPERATOR_SMS_WEBHOOK_TOKEN?.trim();
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({
        type: "operator.phone_login_code",
        phone: params.phone,
        code: params.code,
        expiresAt: params.expiresAt.toISOString()
      })
    });
    if (!response.ok) throw new Error("Failed to send phone verification code.");
    return { debugCode: null };
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("Phone login SMS delivery is not configured.");
  }

  console.info(`[operator] phone login code for ${params.phone}: ${params.code}`);
  return {
    debugCode: process.env.OPERATOR_PHONE_LOGIN_DEBUG_CODE === "false" ? null : params.code
  };
}

async function deliverAliyunDypnsPhoneLoginCode(params: {
  phone: string;
  ttlSeconds: number;
}): Promise<{ outId: string; debugCode: string | null }> {
  const config = aliyunDypnsConfig();
  const outId = `operator_${randomBytes(12).toString("hex")}`;
  const response = await aliyunDypnsClient(config).sendSmsVerifyCode(
    new SendSmsVerifyCodeRequest({
      phoneNumber: aliyunDypnsPhoneNumber(params.phone),
      countryCode: "86",
      signName: config.signName,
      templateCode: config.templateCode,
      templateParam: config.templateParam,
      schemeName: config.schemeName,
      codeLength: config.codeLength,
      codeType: 1,
      duplicatePolicy: 1,
      interval: config.intervalSeconds,
      validTime: params.ttlSeconds,
      returnVerifyCode: config.returnVerifyCode,
      outId
    })
  );
  const body = response.body;
  if (!body?.success || body.code !== "OK") {
    throw new Error(body?.message || body?.code || "Failed to send Aliyun phone verification code.");
  }
  return {
    outId: body.model?.outId || outId,
    debugCode: config.returnVerifyCode ? (body.model?.verifyCode ?? null) : null
  };
}

async function checkAliyunDypnsPhoneLoginCode(params: { phone: string; code: string; outId: string }): Promise<boolean> {
  const config = aliyunDypnsConfig();
  const response = await aliyunDypnsClient(config).checkSmsVerifyCode(
    new CheckSmsVerifyCodeRequest({
      phoneNumber: aliyunDypnsPhoneNumber(params.phone),
      countryCode: "86",
      verifyCode: params.code,
      caseAuthPolicy: 1,
      schemeName: config.schemeName,
      outId: params.outId || undefined
    })
  );
  const body = response.body;
  if (!body?.success || body.code !== "OK") return false;
  return body.model?.verifyResult === "PASS";
}

type AliyunDypnsConfig = {
  accessKeyId: string;
  accessKeySecret: string;
  regionId: string;
  endpoint: string;
  signName: string;
  templateCode: string;
  templateParam: string;
  schemeName?: string;
  codeLength: number;
  intervalSeconds: number;
  returnVerifyCode: boolean;
};

export function aliyunDypnsConfig(): AliyunDypnsConfig {
  const accessKeyId = envValue("ALIYUN_ACCESS_KEY_ID") || envValue("OPERATOR_ALIYUN_ACCESS_KEY_ID");
  const accessKeySecret = envValue("ALIYUN_ACCESS_KEY_SECRET") || envValue("OPERATOR_ALIYUN_ACCESS_KEY_SECRET");
  if (!accessKeyId || !accessKeySecret) {
    throw new Error("Aliyun phone login requires access key configuration.");
  }
  const ttlMinutes = Math.max(1, Math.round(phoneLoginCodeTtlSeconds() / 60));
  return {
    accessKeyId,
    accessKeySecret,
    regionId: envValue("OPERATOR_ALIYUN_REGION_ID") || "cn-hangzhou",
    endpoint: envValue("OPERATOR_ALIYUN_DYPNS_ENDPOINT") || "dypnsapi.aliyuncs.com",
    signName: ALIYUN_DYPNS_OFFICIAL_SIGN_NAME,
    templateCode: ALIYUN_DYPNS_OFFICIAL_TEMPLATE_CODE,
    templateParam: envValue("OPERATOR_ALIYUN_DYPNS_TEMPLATE_PARAM") || JSON.stringify({ code: "##code##", min: String(ttlMinutes) }),
    schemeName: envValue("OPERATOR_ALIYUN_DYPNS_SCHEME_NAME") || undefined,
    codeLength: intEnv("OPERATOR_ALIYUN_DYPNS_CODE_LENGTH", 6, { min: 4, max: 8 }),
    intervalSeconds: intEnv("OPERATOR_ALIYUN_DYPNS_INTERVAL_SECONDS", 60, { min: 30, max: 600 }),
    returnVerifyCode:
      process.env.NODE_ENV === "production" ? false : (booleanEnv(envValue("OPERATOR_ALIYUN_DYPNS_RETURN_VERIFY_CODE")) ?? false)
  };
}

function aliyunDypnsClient(config: Pick<AliyunDypnsConfig, "accessKeyId" | "accessKeySecret" | "regionId" | "endpoint">): DypnsapiClient {
  return new DypnsapiClient(
    new $OpenApiUtil.Config({
      accessKeyId: config.accessKeyId,
      accessKeySecret: config.accessKeySecret,
      regionId: config.regionId,
      endpoint: config.endpoint
    })
  );
}

function isAliyunDypnsConfigured(): boolean {
  return Boolean(
    (envValue("ALIYUN_ACCESS_KEY_ID") || envValue("OPERATOR_ALIYUN_ACCESS_KEY_ID")) &&
      (envValue("ALIYUN_ACCESS_KEY_SECRET") || envValue("OPERATOR_ALIYUN_ACCESS_KEY_SECRET"))
  );
}

function aliyunDypnsPhoneNumber(phone: string): string {
  const match = /^\+86(1[3-9]\d{9})$/u.exec(phone);
  if (!match) throw new Error("Aliyun SMS authentication currently supports mainland China mobile numbers only.");
  return match[1];
}

function getSessionSecret(): string {
  return process.env.OPERATOR_SESSION_SECRET?.trim() ?? "";
}

function assertLocalSessionSecretConfigured(): void {
  if (getSessionSecret().length < 24) {
    throw new Error("OPERATOR_SESSION_SECRET must be at least 24 characters for local phone login.");
  }
}

async function readSessionCookie(request?: Request): Promise<string | undefined> {
  if (request) return parseSessionCookieHeader(request.headers.get("cookie"));
  const cookieStore = await cookies();
  return parseSessionCookieHeader(
    cookieStore
      .getAll()
      .map((cookie) => `${cookie.name}=${encodeURIComponent(cookie.value)}`)
      .join("; ")
  );
}

async function requestFromNextCookies(): Promise<Request> {
  const cookieStore = await cookies();
  const header = cookieStore
    .getAll()
    .map((cookie) => `${cookie.name}=${encodeURIComponent(cookie.value)}`)
    .join("; ");
  return new Request("https://operator.local", {
    headers: header ? { cookie: header } : undefined
  });
}

function oidcProviderKey(): string {
  return `${OIDC_PROVIDER_PREFIX}:${process.env.OPERATOR_OIDC_ISSUER?.trim() ?? "default"}`;
}

function isOidcIdentityRequired(): boolean {
  return booleanEnv(process.env.OPERATOR_REQUIRE_OIDC_IDENTITY) === true || envValue("OPERATOR_IDENTITY_MODE").toLowerCase() === "oidc";
}

function envValue(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function booleanEnv(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

function intEnv(name: string, fallback: number, options: { min: number; max: number }): number {
  const value = Number(envValue(name));
  if (!Number.isFinite(value)) return fallback;
  return Math.min(options.max, Math.max(options.min, Math.floor(value)));
}

function isUniqueViolation(error: unknown): boolean {
  return isRecord(error) && error.code === "23505";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
