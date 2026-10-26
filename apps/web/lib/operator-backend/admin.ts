import { and, desc, eq, gt, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import {
  agentRuns,
  auditEvents,
  conversations,
  creditAccounts,
  creditLedger,
  getDatabase,
  messages,
  platformUserRoles,
  userIdentities,
  userSessions,
  users
} from "@operator/db";
import type { OperatorDatabase } from "@operator/db";
import { getOperatorBackendRuntimeStatus, isUnverifiedEmailLoginAllowed, type OperatorBackendRuntimeStatus } from "./config";
import { createOperatorSessionForUser, getOperatorSessionUser, type OperatorLoginResult, type OperatorSessionUser } from "./session";

const EMAIL_PROVIDER = "email";
const OWNER_ROLE = "owner";
const POINTS_CURRENCY = "points";
type AdminTransaction = Parameters<Parameters<OperatorDatabase["transaction"]>[0]>[0];

export type AdminSessionResult = {
  backend: OperatorBackendRuntimeStatus;
  authenticated: boolean;
  owner: boolean;
  user: OperatorSessionUser | null;
  error: string | null;
};

export type AdminContext = {
  user: OperatorSessionUser;
};

export type AdminDashboardSummary = {
  users: {
    total: number;
    active: number;
    registered: number;
    guests: number;
    disabled: number;
  };
  sessions: {
    active: number;
  };
  work: {
    conversations: number;
    messages: number;
    agentRuns: number;
    failedAgentRuns24h: number;
  };
  credits: {
    totalBalance: number;
    totalGranted: number;
    totalConsumed: number;
  };
};

export type AdminUserListItem = {
  id: string;
  status: string;
  primaryEmail: string | null;
  primaryPhone: string | null;
  displayName: string;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
  isOwner: boolean;
  creditBalance: number;
  conversationCount: number;
  messageCount: number;
  lastSessionAt: string | null;
};

export type AdminUserListResult = {
  users: AdminUserListItem[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
  };
};

export type AdminCreditLedgerItem = {
  id: string;
  accountId: string;
  delta: number;
  balanceAfter: number;
  reason: string;
  createdBy: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type AdminUserDetail = {
  user: AdminUserListItem;
  creditAccount: {
    id: string;
    balance: number;
    currency: string;
    status: string;
    updatedAt: string;
  } | null;
  ledger: AdminCreditLedgerItem[];
  conversations: Array<{
    id: string;
    title: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  }>;
};

export class AdminBackendError extends Error {
  status: number;
  code: string;

  constructor(message: string, options: { status: number; code: string; cause?: unknown }) {
    super(message, { cause: options.cause });
    this.name = "AdminBackendError";
    this.status = options.status;
    this.code = options.code;
  }
}

export async function getAdminSession(request?: Request): Promise<AdminSessionResult> {
  const backend = getOperatorBackendRuntimeStatus();
  if (!backend.enabled) {
    return {
      backend,
      authenticated: false,
      owner: false,
      user: null,
      error: "Operator backend is not available."
    };
  }

  const session = await getOperatorSessionUser(request);
  if (!session.authenticated) {
    return {
      backend,
      authenticated: false,
      owner: false,
      user: null,
      error: session.error
    };
  }

  const owner = !session.user.isGuest && (await hasActivePlatformRole(session.user.id, OWNER_ROLE));
  return {
    backend,
    authenticated: true,
    owner,
    user: session.user,
    error: owner ? null : "The current user is not a platform owner."
  };
}

export async function requirePlatformOwner(request?: Request): Promise<AdminContext> {
  const session = await getAdminSession(request);
  if (!session.backend.enabled) {
    throw new AdminBackendError("Operator backend is not available.", { status: 503, code: "BACKEND_UNAVAILABLE" });
  }
  if (!session.authenticated || !session.user) {
    throw new AdminBackendError("Admin login is required.", { status: 401, code: "ADMIN_LOGIN_REQUIRED" });
  }
  if (!session.owner) {
    throw new AdminBackendError("Platform owner permission is required.", { status: 403, code: "OWNER_REQUIRED" });
  }
  return { user: session.user };
}

export async function loginPlatformOwnerWithEmail(emailInput: string): Promise<OperatorLoginResult> {
  const backend = getOperatorBackendRuntimeStatus();
  if (!backend.enabled) {
    throw new AdminBackendError("Operator backend is not available.", { status: 503, code: "BACKEND_UNAVAILABLE" });
  }
  if (!isUnverifiedEmailLoginAllowed()) {
    throw new AdminBackendError("Admin email login requires a verified identity provider.", {
      status: 503,
      code: "VERIFIED_IDENTITY_REQUIRED"
    });
  }

  const email = normalizeEmail(emailInput);
  if (!email) {
    throw new AdminBackendError("A valid owner email is required.", { status: 400, code: "INVALID_EMAIL" });
  }

  const user = await findEmailUser(email);
  if (user?.status !== "active") {
    throw new AdminBackendError("This account does not have owner permission.", { status: 403, code: "OWNER_REQUIRED" });
  }
  const owner = await hasActivePlatformRole(user.id, OWNER_ROLE);
  if (!owner) {
    throw new AdminBackendError("This account does not have owner permission.", { status: 403, code: "OWNER_REQUIRED" });
  }

  return createOperatorSessionForUser(user, { isGuest: false });
}

export async function getAdminDashboardSummary(): Promise<AdminDashboardSummary> {
  const db = getDatabase();
  const [userCounts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where ${users.status} = 'active')::int`,
      registered: sql<number>`count(*) filter (where ${users.primaryEmail} is not null or ${users.primaryPhone} is not null)::int`,
      disabled: sql<number>`count(*) filter (where ${users.status} = 'disabled')::int`
    })
    .from(users);

  const [sessionCounts] = await db
    .select({
      active: sql<number>`count(*)::int`
    })
    .from(userSessions)
    .where(and(isNull(userSessions.revokedAt), gt(userSessions.expiresAt, new Date())));

  const [workCounts] = await db
    .select({
      conversations: sql<number>`count(distinct ${conversations.id})::int`,
      messages: sql<number>`count(distinct ${messages.id})::int`
    })
    .from(conversations)
    .leftJoin(messages, eq(messages.conversationId, conversations.id));

  const [agentRunCounts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      failed24h: sql<number>`count(*) filter (where ${agentRuns.status} = 'failed' and ${agentRuns.createdAt} >= now() - interval '24 hours')::int`
    })
    .from(agentRuns);

  const [creditBalance] = await db
    .select({
      total: sql<string>`coalesce(sum(${creditAccounts.balance}), 0)::bigint`
    })
    .from(creditAccounts);

  const [creditFlow] = await db
    .select({
      granted: sql<string>`coalesce(sum(case when ${creditLedger.delta} > 0 then ${creditLedger.delta} else 0 end), 0)::bigint`,
      consumed: sql<string>`coalesce(sum(case when ${creditLedger.delta} < 0 then abs(${creditLedger.delta}) else 0 end), 0)::bigint`
    })
    .from(creditLedger);

  const totalUsers = numberFromUnknown(userCounts?.total);
  const registered = numberFromUnknown(userCounts?.registered);
  return {
    users: {
      total: totalUsers,
      active: numberFromUnknown(userCounts?.active),
      registered,
      guests: Math.max(0, totalUsers - registered),
      disabled: numberFromUnknown(userCounts?.disabled)
    },
    sessions: {
      active: numberFromUnknown(sessionCounts?.active)
    },
    work: {
      conversations: numberFromUnknown(workCounts?.conversations),
      messages: numberFromUnknown(workCounts?.messages),
      agentRuns: numberFromUnknown(agentRunCounts?.total),
      failedAgentRuns24h: numberFromUnknown(agentRunCounts?.failed24h)
    },
    credits: {
      totalBalance: numberFromUnknown(creditBalance?.total),
      totalGranted: numberFromUnknown(creditFlow?.granted),
      totalConsumed: numberFromUnknown(creditFlow?.consumed)
    }
  };
}

export async function listAdminUsers(params?: { query?: string; limit?: number; offset?: number }): Promise<AdminUserListResult> {
  const limit = clampInteger(params?.limit, 1, 100, 30);
  const offset = clampInteger(params?.offset, 0, 100_000, 0);
  const query = params?.query?.trim() ?? "";
  const where = query
    ? or(ilike(users.displayName, `%${query}%`), ilike(users.primaryEmail, `%${query}%`), ilike(users.primaryPhone, `%${query}%`))
    : sql`true`;

  const db = getDatabase();
  const rows = await db
    .select({
      id: users.id,
      status: users.status,
      primaryEmail: users.primaryEmail,
      primaryPhone: users.primaryPhone,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
      conversationCount: sql<number>`coalesce((
        select count(*)::int from conversations where conversations.created_by = ${users.id}
      ), 0)`,
      messageCount: sql<number>`coalesce((
        select count(*)::int from messages where messages.created_by = ${users.id}
      ), 0)`,
      lastSessionAt: sql<Date | null>`(
        select max(user_sessions.created_at) from user_sessions where user_sessions.user_id = ${users.id}
      )`
    })
    .from(users)
    .where(where)
    .orderBy(desc(users.createdAt))
    .limit(limit)
    .offset(offset);

  const [countRow] = await db.select({ total: sql<number>`count(*)::int` }).from(users).where(where);

  return {
    users: await adminUsersFromRows(rows),
    pagination: {
      limit,
      offset,
      total: numberFromUnknown(countRow?.total)
    }
  };
}

export async function getAdminUserDetail(userId: string): Promise<AdminUserDetail> {
  assertUuid(userId, "Invalid user id.");
  const db = getDatabase();
  const [userRow] = await db
    .select({
      id: users.id,
      status: users.status,
      primaryEmail: users.primaryEmail,
      primaryPhone: users.primaryPhone,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
      conversationCount: sql<number>`coalesce((
        select count(*)::int from conversations where conversations.created_by = ${users.id}
      ), 0)`,
      messageCount: sql<number>`coalesce((
        select count(*)::int from messages where messages.created_by = ${users.id}
      ), 0)`,
      lastSessionAt: sql<Date | null>`(
        select max(user_sessions.created_at) from user_sessions where user_sessions.user_id = ${users.id}
      )`
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!userRow) {
    throw new AdminBackendError("User not found.", { status: 404, code: "USER_NOT_FOUND" });
  }

  const [account] = await db
    .select()
    .from(creditAccounts)
    .where(and(eq(creditAccounts.ownerType, "user"), eq(creditAccounts.ownerUserId, userId), eq(creditAccounts.currency, POINTS_CURRENCY)))
    .limit(1);

  const ledger = account
    ? await db
        .select({
          id: creditLedger.id,
          accountId: creditLedger.accountId,
          delta: creditLedger.delta,
          balanceAfter: creditLedger.balanceAfter,
          reason: creditLedger.reason,
          createdBy: creditLedger.createdBy,
          metadata: creditLedger.metadata,
          createdAt: creditLedger.createdAt
        })
        .from(creditLedger)
        .where(eq(creditLedger.accountId, account.id))
        .orderBy(desc(creditLedger.createdAt))
        .limit(20)
    : [];

  const conversationRows = await db
    .select({
      id: conversations.id,
      title: conversations.title,
      status: conversations.status,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt
    })
    .from(conversations)
    .where(eq(conversations.createdBy, userId))
    .orderBy(desc(conversations.updatedAt))
    .limit(10);

  return {
    user: adminUserFromRow({
      ...userRow,
      isOwner: await hasActivePlatformRole(userId, OWNER_ROLE),
      creditBalance: account?.balance ?? 0
    }),
    creditAccount: account
      ? {
          id: account.id,
          balance: account.balance,
          currency: account.currency,
          status: account.status,
          updatedAt: serializeDate(account.updatedAt)
        }
      : null,
    ledger: ledger.map((row) => ({
      id: row.id,
      accountId: row.accountId,
      delta: row.delta,
      balanceAfter: row.balanceAfter,
      reason: row.reason,
      createdBy: row.createdBy ?? null,
      metadata: row.metadata,
      createdAt: serializeDate(row.createdAt)
    })),
    conversations: conversationRows.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      createdAt: serializeDate(row.createdAt),
      updatedAt: serializeDate(row.updatedAt)
    }))
  };
}

export async function adjustUserCredits(params: {
  userId: string;
  delta: number;
  reason?: string;
  actorUserId: string;
}): Promise<{ accountId: string; balance: number; ledgerId: string }> {
  assertUuid(params.userId, "Invalid user id.");
  assertUuid(params.actorUserId, "Invalid actor user id.");
  const delta = clampCreditDelta(params.delta);
  const reason = params.reason?.trim() || (delta > 0 ? "Owner credit grant" : "Owner credit deduction");
  const db = getDatabase();

  return db.transaction(async (tx) => {
    const [targetUser] = await tx.select({ id: users.id }).from(users).where(eq(users.id, params.userId)).limit(1);
    if (!targetUser) {
      throw new AdminBackendError("User not found.", { status: 404, code: "USER_NOT_FOUND" });
    }

    const account = await ensureUserCreditAccount(tx, params.userId);
    const nextBalance = account.balance + delta;
    if (nextBalance < 0) {
      throw new AdminBackendError("Credit balance cannot be negative.", { status: 400, code: "NEGATIVE_BALANCE" });
    }

    const [updatedAccount] = await tx
      .update(creditAccounts)
      .set({
        balance: nextBalance,
        updatedAt: new Date()
      })
      .where(eq(creditAccounts.id, account.id))
      .returning();
    if (!updatedAccount) {
      throw new AdminBackendError("Failed to update credit account.", { status: 500, code: "CREDIT_UPDATE_FAILED" });
    }

    const [ledger] = await tx
      .insert(creditLedger)
      .values({
        accountId: updatedAccount.id,
        userId: params.userId,
        delta,
        balanceAfter: updatedAccount.balance,
        reason,
        createdBy: params.actorUserId,
        metadata: {
          source: "admin_dashboard"
        }
      })
      .returning();
    if (!ledger) {
      throw new AdminBackendError("Failed to write credit ledger.", { status: 500, code: "CREDIT_LEDGER_FAILED" });
    }

    await tx.insert(auditEvents).values({
      actorUserId: params.actorUserId,
      actorType: "user",
      kind: "admin.credit_adjusted",
      targetType: "user",
      targetId: params.userId,
      payload: {
        delta,
        balanceAfter: updatedAccount.balance,
        reason,
        ledgerId: ledger.id
      }
    });

    return {
      accountId: updatedAccount.id,
      balance: updatedAccount.balance,
      ledgerId: ledger.id
    };
  });
}

export function adminErrorResponse(error: unknown): Response {
  if (error instanceof AdminBackendError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.status });
  }
  return Response.json({ error: error instanceof Error ? error.message : String(error), code: "INTERNAL_ERROR" }, { status: 500 });
}

async function ensureUserCreditAccount(tx: AdminTransaction, userId: string): Promise<typeof creditAccounts.$inferSelect> {
  const [existing] = await tx
    .select()
    .from(creditAccounts)
    .where(and(eq(creditAccounts.ownerType, "user"), eq(creditAccounts.ownerUserId, userId), eq(creditAccounts.currency, POINTS_CURRENCY)))
    .limit(1);
  if (existing) return existing;

  const [inserted] = await tx
    .insert(creditAccounts)
    .values({
      ownerType: "user",
      ownerUserId: userId,
      ownerOrgId: null,
      currency: POINTS_CURRENCY,
      balance: 0,
      status: "active"
    })
    .onConflictDoNothing()
    .returning();
  if (inserted) return inserted;

  const [createdByConcurrentRequest] = await tx
    .select()
    .from(creditAccounts)
    .where(and(eq(creditAccounts.ownerType, "user"), eq(creditAccounts.ownerUserId, userId), eq(creditAccounts.currency, POINTS_CURRENCY)))
    .limit(1);
  if (!createdByConcurrentRequest) {
    throw new AdminBackendError("Failed to create credit account.", { status: 500, code: "CREDIT_ACCOUNT_FAILED" });
  }
  return createdByConcurrentRequest;
}

async function hasActivePlatformRole(userId: string, role: string): Promise<boolean> {
  const [row] = await getDatabase()
    .select({ id: platformUserRoles.id })
    .from(platformUserRoles)
    .where(
      and(
        eq(platformUserRoles.userId, userId),
        eq(platformUserRoles.role, role),
        eq(platformUserRoles.status, "active"),
        isNull(platformUserRoles.revokedAt)
      )
    )
    .limit(1);
  return Boolean(row);
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

async function adminUsersFromRows(
  rows: Array<Omit<Parameters<typeof adminUserFromRow>[0], "isOwner" | "creditBalance">>
): Promise<AdminUserListItem[]> {
  if (!rows.length) return [];
  const userIds = rows.map((row) => row.id);
  const roleRows = await getDatabase()
    .select({ userId: platformUserRoles.userId })
    .from(platformUserRoles)
    .where(
      and(
        inArray(platformUserRoles.userId, userIds),
        eq(platformUserRoles.role, OWNER_ROLE),
        eq(platformUserRoles.status, "active"),
        isNull(platformUserRoles.revokedAt)
      )
    );
  const creditRows = await getDatabase()
    .select({
      userId: creditAccounts.ownerUserId,
      balance: creditAccounts.balance
    })
    .from(creditAccounts)
    .where(
      and(eq(creditAccounts.ownerType, "user"), inArray(creditAccounts.ownerUserId, userIds), eq(creditAccounts.currency, POINTS_CURRENCY))
    );
  const ownerIds = new Set(roleRows.map((row) => row.userId));
  const balanceByUserId = new Map(creditRows.map((row) => [row.userId, row.balance]));
  return rows.map((row) =>
    adminUserFromRow({
      ...row,
      isOwner: ownerIds.has(row.id),
      creditBalance: balanceByUserId.get(row.id) ?? 0
    })
  );
}

function adminUserFromRow(row: {
  id: string;
  status: string;
  primaryEmail: string | null;
  primaryPhone: string | null;
  displayName: string;
  avatarUrl: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  isOwner: boolean;
  creditBalance: string | number;
  conversationCount: string | number;
  messageCount: string | number;
  lastSessionAt: Date | string | null;
}): AdminUserListItem {
  return {
    id: row.id,
    status: row.status,
    primaryEmail: row.primaryEmail ?? null,
    primaryPhone: row.primaryPhone ?? null,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl ?? null,
    createdAt: serializeDate(row.createdAt),
    updatedAt: serializeDate(row.updatedAt),
    isOwner: Boolean(row.isOwner),
    creditBalance: numberFromUnknown(row.creditBalance),
    conversationCount: numberFromUnknown(row.conversationCount),
    messageCount: numberFromUnknown(row.messageCount),
    lastSessionAt: row.lastSessionAt ? serializeDate(row.lastSessionAt) : null
  };
}

function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) ? email : "";
}

function clampInteger(value: number | undefined, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value as number)));
}

function clampCreditDelta(value: number): number {
  if (!Number.isFinite(value)) {
    throw new AdminBackendError("Credit delta must be a finite number.", { status: 400, code: "INVALID_CREDIT_DELTA" });
  }
  const delta = Math.trunc(value);
  if (delta === 0) {
    throw new AdminBackendError("Credit delta cannot be zero.", { status: 400, code: "INVALID_CREDIT_DELTA" });
  }
  if (Math.abs(delta) > 1_000_000) {
    throw new AdminBackendError("Credit delta is too large.", { status: 400, code: "INVALID_CREDIT_DELTA" });
  }
  return delta;
}

function assertUuid(value: string, message: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value)) {
    throw new AdminBackendError(message, { status: 400, code: "INVALID_ID" });
  }
}

function serializeDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function numberFromUnknown(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}
