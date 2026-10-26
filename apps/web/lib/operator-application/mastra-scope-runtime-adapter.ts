import type { OperatorUserScopeSelectionCatalog } from "@operator/contracts";
import { listUserScopeSelectionCatalog } from "@operator/mastra-app/product-scopes";

export function loadMastraRuntimeUserScopeCatalog(): OperatorUserScopeSelectionCatalog {
  return listUserScopeSelectionCatalog();
}
