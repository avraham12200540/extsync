import { createAdminImportRunDetailHandler } from "@/http/handlers/admin-import-runs";
import { invokeWithDeps } from "@/http/http-utils";
import { getProductionAdminHttpDeps } from "@/http/production-admin-deps";

// External URL: GET /guess/api/admin/import-runs/:importRunId
export async function GET(request: Request, context: { params: Promise<{ importRunId: string }> }): Promise<Response> {
  const params = await context.params;
  return invokeWithDeps(getProductionAdminHttpDeps, createAdminImportRunDetailHandler, request, params);
}
