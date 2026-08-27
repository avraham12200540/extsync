import { createAdminImportRunsListHandler } from "@/http/handlers/admin-import-runs";
import { invokeWithDeps } from "@/http/http-utils";
import { getProductionAdminHttpDeps } from "@/http/production-admin-deps";

// External URL: GET /guess/api/admin/import-runs
export async function GET(request: Request): Promise<Response> {
  return invokeWithDeps(getProductionAdminHttpDeps, createAdminImportRunsListHandler, request, {});
}
