import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { closeDatabase, getDatabase, platformUserRoles, userIdentities, users } from "./index.js";

const EMAIL_PROVIDER = "email";

loadDotenv();

const ownerEmail = normalizeEmail(process.env.OPERATOR_OWNER_EMAIL ?? process.argv[2] ?? "");
const ownerDisplayName = process.env.OPERATOR_OWNER_NAME?.trim() || ownerEmail.split("@")[0] || "Operator Owner";

if (!ownerEmail) {
  console.error("OPERATOR_OWNER_EMAIL or a positional email argument is required.");
  process.exitCode = 1;
} else {
  seedOwner(ownerEmail, ownerDisplayName)
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeDatabase();
    });
}

async function seedOwner(email: string, displayName: string): Promise<{ userId: string; email: string; role: "owner"; status: "active" }> {
  const db = getDatabase();
  const user = await findOrCreateEmailUser(email, displayName);
  const [role] = await db
    .insert(platformUserRoles)
    .values({
      userId: user.id,
      role: "owner",
      status: "active",
      grantedBy: user.id,
      revokedAt: null
    })
    .onConflictDoUpdate({
      target: [platformUserRoles.userId, platformUserRoles.role],
      set: {
        status: "active",
        grantedBy: user.id,
        grantedAt: new Date(),
        revokedAt: null,
        updatedAt: new Date()
      }
    })
    .returning();

  if (!role) throw new Error("Failed to grant owner role.");
  return { userId: user.id, email, role: "owner", status: "active" };
}

async function findOrCreateEmailUser(email: string, displayName: string): Promise<typeof users.$inferSelect> {
  const existing = await findEmailUser(email);
  if (existing) return existing;

  const db = getDatabase();
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
      if (!user) throw new Error("Failed to create owner user.");
      await tx.insert(userIdentities).values({
        userId: user.id,
        provider: EMAIL_PROVIDER,
        providerSubject: email,
        email,
        rawProfile: {
          seededOwner: true
        }
      });
      return user;
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const createdByConcurrentRun = await findEmailUser(email);
    if (createdByConcurrentRun) return createdByConcurrentRun;
    throw error;
  }
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

function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) ? email : "";
}

function loadDotenv(): void {
  const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env");
  let text = "";
  try {
    text = readFileSync(envPath, "utf8");
  } catch {
    return;
  }

  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const value = stripEnvValue(line.slice(separator + 1).trim());
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function stripEnvValue(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
