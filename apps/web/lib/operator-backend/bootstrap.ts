import { and, asc, eq } from "drizzle-orm";
import { driveSpaces, getDatabase, organizationMemberships, organizations, users } from "@operator/db";
import type { OperatorSessionUser } from "./session";

const DEFAULT_PERSONAL_DRIVE_QUOTA_BYTES = 5 * 1024 * 1024 * 1024;

export type BootstrapProfile = {
  id: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  status: string;
};

export type BootstrapOrganization = {
  id: string;
  name: string;
  kind: "personal" | "team" | "enterprise";
  plan: string;
  status: "active" | "suspended" | "deleted";
  created_by: string;
};

export type BootstrapMembership = {
  id: string;
  org_id: string;
  user_id: string;
  role: "owner" | "admin" | "member" | "viewer";
};

export type BootstrapDriveSpace = {
  id: string;
  owner_type: "user" | "organization";
  owner_user_id: string | null;
  owner_org_id: string | null;
  quota_bytes: number;
  used_bytes: number;
  plan: string;
};

export type OperatorBootstrapResult = {
  profile: BootstrapProfile;
  organization: BootstrapOrganization;
  membership: BootstrapMembership;
  drive: BootstrapDriveSpace;
};

export type OperatorBootstrapStore = {
  upsertProfile(profile: BootstrapProfile): Promise<BootstrapProfile>;
  findPersonalOrganization(userId: string): Promise<BootstrapOrganization | null>;
  createPersonalOrganization(organization: Omit<BootstrapOrganization, "id">): Promise<BootstrapOrganization>;
  upsertOwnerMembership(membership: Omit<BootstrapMembership, "id">): Promise<BootstrapMembership>;
  findPersonalDrive(userId: string): Promise<BootstrapDriveSpace | null>;
  createPersonalDrive(drive: Omit<BootstrapDriveSpace, "id" | "used_bytes" | "owner_org_id">): Promise<BootstrapDriveSpace>;
};

export class OperatorBootstrapError extends Error {
  code?: string;

  constructor(message: string, options?: { code?: string; cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = "OperatorBootstrapError";
    this.code = options?.code;
  }
}

export async function bootstrapOperatorUser(
  user: OperatorSessionUser,
  store: OperatorBootstrapStore = createOperatorBootstrapStore()
): Promise<OperatorBootstrapResult> {
  const account = describeOperatorUser(user);
  const profile = await store.upsertProfile({
    id: user.id,
    display_name: account.displayName,
    email: user.email,
    phone: user.phone,
    avatar_url: account.avatarUrl,
    status: "active"
  });

  const organization = await ensurePersonalOrganization(user.id, account.displayName, store);
  const membership = await store.upsertOwnerMembership({
    org_id: organization.id,
    user_id: user.id,
    role: "owner"
  });
  const drive = await ensurePersonalDrive(user.id, store);

  return { profile, organization, membership, drive };
}

export function describeOperatorUser(user: Pick<OperatorSessionUser, "displayName" | "email" | "phone" | "avatarUrl">): {
  displayName: string;
  avatarUrl: string | null;
} {
  return {
    displayName: user.displayName || user.email?.split("@")[0] || user.phone || "Operator User",
    avatarUrl: user.avatarUrl
  };
}

export function createOperatorBootstrapStore(): OperatorBootstrapStore {
  const db = getDatabase();

  return {
    async upsertProfile(profile) {
      const [row] = await db
        .insert(users)
        .values({
          id: profile.id,
          status: "active",
          primaryEmail: profile.email,
          primaryPhone: profile.phone,
          displayName: profile.display_name,
          avatarUrl: profile.avatar_url
        })
        .onConflictDoUpdate({
          target: users.id,
          set: {
            status: "active",
            primaryEmail: profile.email,
            primaryPhone: profile.phone,
            displayName: profile.display_name,
            avatarUrl: profile.avatar_url,
            updatedAt: new Date()
          }
        })
        .returning();
      if (!row) throw new OperatorBootstrapError("Failed to upsert user profile.");
      return profileFromRow(row);
    },

    async findPersonalOrganization(userId) {
      const [row] = await db
        .select()
        .from(organizations)
        .where(and(eq(organizations.createdBy, userId), eq(organizations.kind, "personal")))
        .orderBy(asc(organizations.createdAt))
        .limit(1);
      return row ? organizationFromRow(row) : null;
    },

    async createPersonalOrganization(organization) {
      const [row] = await db
        .insert(organizations)
        .values({
          name: organization.name,
          kind: organization.kind,
          plan: organization.plan,
          status: organization.status,
          createdBy: organization.created_by
        })
        .returning();
      if (!row) throw new OperatorBootstrapError("Failed to create personal organization.");
      return organizationFromRow(row);
    },

    async upsertOwnerMembership(membership) {
      const [row] = await db
        .insert(organizationMemberships)
        .values({
          orgId: membership.org_id,
          userId: membership.user_id,
          role: membership.role,
          status: "active"
        })
        .onConflictDoUpdate({
          target: [organizationMemberships.orgId, organizationMemberships.userId],
          set: {
            role: membership.role,
            status: "active",
            updatedAt: new Date()
          }
        })
        .returning();
      if (!row) throw new OperatorBootstrapError("Failed to upsert organization membership.");
      return membershipFromRow(row);
    },

    async findPersonalDrive(userId) {
      const [row] = await db
        .select()
        .from(driveSpaces)
        .where(and(eq(driveSpaces.ownerType, "user"), eq(driveSpaces.ownerUserId, userId)))
        .orderBy(asc(driveSpaces.createdAt))
        .limit(1);
      return row ? driveFromRow(row) : null;
    },

    async createPersonalDrive(drive) {
      const [row] = await db
        .insert(driveSpaces)
        .values({
          ownerType: drive.owner_type,
          ownerUserId: drive.owner_user_id,
          ownerOrgId: null,
          quotaBytes: drive.quota_bytes,
          plan: drive.plan
        })
        .returning();
      if (!row) throw new OperatorBootstrapError("Failed to create personal drive.");
      return driveFromRow(row);
    }
  };
}

async function ensurePersonalOrganization(
  userId: string,
  displayName: string,
  store: OperatorBootstrapStore
): Promise<BootstrapOrganization> {
  const existing = await store.findPersonalOrganization(userId);
  if (existing) return existing;

  try {
    return await store.createPersonalOrganization({
      name: `${displayName} 的个人空间`,
      kind: "personal",
      plan: "free",
      status: "active",
      created_by: userId
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const createdByConcurrentRequest = await store.findPersonalOrganization(userId);
    if (createdByConcurrentRequest) return createdByConcurrentRequest;
    throw error;
  }
}

async function ensurePersonalDrive(userId: string, store: OperatorBootstrapStore): Promise<BootstrapDriveSpace> {
  const existing = await store.findPersonalDrive(userId);
  if (existing) return existing;
  try {
    return await store.createPersonalDrive({
      owner_type: "user",
      owner_user_id: userId,
      quota_bytes: DEFAULT_PERSONAL_DRIVE_QUOTA_BYTES,
      plan: "free"
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const createdByConcurrentRequest = await store.findPersonalDrive(userId);
    if (createdByConcurrentRequest) return createdByConcurrentRequest;
    throw error;
  }
}

function profileFromRow(row: typeof users.$inferSelect): BootstrapProfile {
  return {
    id: row.id,
    display_name: row.displayName,
    email: row.primaryEmail ?? null,
    phone: row.primaryPhone ?? null,
    avatar_url: row.avatarUrl ?? null,
    status: row.status
  };
}

function organizationFromRow(row: typeof organizations.$inferSelect): BootstrapOrganization {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    plan: row.plan,
    status: row.status,
    created_by: row.createdBy
  };
}

function membershipFromRow(row: typeof organizationMemberships.$inferSelect): BootstrapMembership {
  return {
    id: row.id,
    org_id: row.orgId,
    user_id: row.userId,
    role: row.role
  };
}

function driveFromRow(row: typeof driveSpaces.$inferSelect): BootstrapDriveSpace {
  return {
    id: row.id,
    owner_type: row.ownerType,
    owner_user_id: row.ownerUserId ?? null,
    owner_org_id: row.ownerOrgId ?? null,
    quota_bytes: row.quotaBytes,
    used_bytes: row.usedBytes,
    plan: row.plan
  };
}

function isUniqueViolation(error: unknown): boolean {
  return errorCode(error) === "23505";
}

function errorCode(error: unknown): string | undefined {
  if (!isRecord(error)) return undefined;
  if (typeof error.code === "string") return error.code;
  return errorCode(error.cause);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
