import { createAdminImportRunTriggerHandler } from "@/http/handlers/admin-import-runs";
import { invokeWithDeps } from "@/http/http-utils";
import { getProductionAdminHttpDeps } from "@/http/production-admin-deps";

// External URL: POST /guess/api/admin/import-runs/trigger
export async function POST(request: Request): Promise<Response> {
  return invokeWithDeps(getProductionAdminHttpDeps, createAdminImportRunTriggerHandler, request, {});
}
