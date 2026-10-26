import { describe, expect, test } from "vitest";
import {
  OperatorBootstrapError,
  bootstrapOperatorUser,
  describeOperatorUser,
  type BootstrapDriveSpace,
  type BootstrapOrganization,
  type OperatorBootstrapStore
} from "./bootstrap";
import type { OperatorSessionUser } from "./session";

const user: OperatorSessionUser = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "ada@example.com",
  phone: null,
  displayName: "Ada Lovelace",
  avatarUrl: "https://example.com/ada.png",
  isGuest: false
};

describe("Operator session bootstrap", () => {
  test("creates profile, personal organization, owner membership, and personal drive", async () => {
    const createdOrganizations: Array<Omit<BootstrapOrganization, "id">> = [];
    const store = createFakeStore({
      findPersonalOrganization: async () => null,
      createPersonalOrganization: async (organization) => {
        createdOrganizations.push(organization);
        return { id: "org_1", ...organization };
      }
    });

    const result = await bootstrapOperatorUser(user, store);

    expect(result.profile).toMatchObject({
      id: user.id,
      display_name: "Ada Lovelace",
      email: "ada@example.com",
      avatar_url: "https://example.com/ada.png",
      status: "active"
    });
    expect(createdOrganizations).toEqual([
      {
        name: "Ada Lovelace 的个人空间",
        kind: "personal",
        plan: "free",
        status: "active",
        created_by: user.id
      }
    ]);
    expect(result.membership).toMatchObject({
      org_id: "org_1",
      user_id: user.id,
      role: "owner"
    });
    expect(result.drive).toMatchObject({
      owner_type: "user",
      owner_user_id: user.id,
      owner_org_id: null,
      plan: "free"
    });
    expect(result.drive.quota_bytes).toBeGreaterThan(0);
  });

  test("reuses existing personal organization and drive", async () => {
    let createOrganizationCalled = false;
    let createDriveCalled = false;
    const existingOrganization = personalOrganization("org_existing");
    const existingDrive = personalDrive("drive_existing");
    const store = createFakeStore({
      findPersonalOrganization: async () => existingOrganization,
      createPersonalOrganization: async (organization) => {
        createOrganizationCalled = true;
        return { id: "unexpected", ...organization };
      },
      findPersonalDrive: async () => existingDrive,
      createPersonalDrive: async (drive) => {
        createDriveCalled = true;
        return { id: "unexpected", owner_org_id: null, used_bytes: 0, ...drive };
      }
    });

    const result = await bootstrapOperatorUser(user, store);

    expect(result.organization).toEqual(existingOrganization);
    expect(result.drive).toEqual(existingDrive);
    expect(createOrganizationCalled).toBe(false);
    expect(createDriveCalled).toBe(false);
  });

  test("recovers from a concurrent personal organization unique violation", async () => {
    let reads = 0;
    const existingOrganization = personalOrganization("org_after_conflict");
    const store = createFakeStore({
      findPersonalOrganization: async () => {
        reads += 1;
        return reads === 1 ? null : existingOrganization;
      },
      createPersonalOrganization: async () => {
        throw new OperatorBootstrapError("duplicate", { code: "23505" });
      }
    });

    const result = await bootstrapOperatorUser(user, store);

    expect(result.organization).toEqual(existingOrganization);
    expect(reads).toBe(2);
  });

  test("recovers when the database unique violation is wrapped as an error cause", async () => {
    let reads = 0;
    const existingOrganization = personalOrganization("org_after_wrapped_conflict");
    const store = createFakeStore({
      findPersonalOrganization: async () => {
        reads += 1;
        return reads === 1 ? null : existingOrganization;
      },
      createPersonalOrganization: async () => {
        throw new Error("Failed query", { cause: new OperatorBootstrapError("duplicate", { code: "23505" }) });
      }
    });

    const result = await bootstrapOperatorUser(user, store);

    expect(result.organization).toEqual(existingOrganization);
    expect(reads).toBe(2);
  });

  test("derives display fields with stable fallbacks", () => {
    expect(describeOperatorUser(user)).toEqual({
      displayName: "Ada Lovelace",
      avatarUrl: "https://example.com/ada.png"
    });
    expect(
      describeOperatorUser({
        email: "grace@example.com",
        phone: null,
        displayName: "",
        avatarUrl: null
      })
    ).toEqual({
      displayName: "grace",
      avatarUrl: null
    });
  });
});

function createFakeStore(overrides: Partial<OperatorBootstrapStore> = {}): OperatorBootstrapStore {
  return {
    async upsertProfile(profile) {
      return profile;
    },
    async findPersonalOrganization() {
      return null;
    },
    async createPersonalOrganization(organization) {
      return { id: "org_created", ...organization };
    },
    async upsertOwnerMembership(membership) {
      return { id: "membership_1", ...membership };
    },
    async findPersonalDrive() {
      return null;
    },
    async createPersonalDrive(drive) {
      return {
        id: "drive_1",
        owner_org_id: null,
        used_bytes: 0,
        ...drive
      };
    },
    ...overrides
  };
}

function personalOrganization(id: string): BootstrapOrganization {
  return {
    id,
    name: "Ada Lovelace 的个人空间",
    kind: "personal",
    plan: "free",
    status: "active",
    created_by: user.id
  };
}

function personalDrive(id: string): BootstrapDriveSpace {
  return {
    id,
    owner_type: "user",
    owner_user_id: user.id,
    owner_org_id: null,
    quota_bytes: 1,
    used_bytes: 0,
    plan: "free"
  };
}
