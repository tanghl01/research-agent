import { describe, expect, it } from "vitest";
import {
  agentRuns,
  conversations,
  creditAccounts,
  creditLedger,
  driveObjects,
  knowledgeArchiveMembers,
  knowledgeChunks,
  knowledgeIngestionRuns,
  knowledgeItems,
  knowledgeItemVersions,
  knowledgeSources,
  knowledgeSpaces,
  knowledgeTemplates,
  organizations,
  phoneLoginChallenges,
  platformUserRoles,
  productScopes,
  users,
  workspaceProductScopes
} from "../src/schema.js";

describe("@operator/db schema", () => {
  it("exports the core identity, project, run, and drive tables", () => {
    expect(users).toBeDefined();
    expect(organizations).toBeDefined();
    expect(conversations).toBeDefined();
    expect(agentRuns).toBeDefined();
    expect(driveObjects).toBeDefined();
  });

  it("exports platform administration and credit tables", () => {
    expect(platformUserRoles).toBeDefined();
    expect(creditAccounts).toBeDefined();
    expect(creditLedger).toBeDefined();
  });

  it("exports phone login challenge storage", () => {
    expect(phoneLoginChallenges).toBeDefined();
  });

  it("exports product scope storage", () => {
    expect(productScopes).toBeDefined();
    expect(workspaceProductScopes).toBeDefined();
  });

  it("exports knowledge base storage", () => {
    expect(knowledgeSpaces).toBeDefined();
    expect(knowledgeSources).toBeDefined();
    expect(knowledgeIngestionRuns).toBeDefined();
    expect(knowledgeItems).toBeDefined();
    expect(knowledgeItemVersions).toBeDefined();
    expect(knowledgeChunks).toBeDefined();
    expect(knowledgeTemplates).toBeDefined();
    expect(knowledgeArchiveMembers).toBeDefined();
  });
});
