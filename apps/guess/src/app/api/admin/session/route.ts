import { createAdminSessionInfoHandler } from "@/http/handlers/admin-session-info";
import { invokeWithDeps } from "@/http/http-utils";
import { getProductionAdminHttpDeps } from "@/http/production-admin-deps";

// External URL: GET /guess/api/admin/session
export async function GET(request: Request): Promise<Response> {
  return invokeWithDeps(getProductionAdminHttpDeps, createAdminSessionInfoHandler, request, {});
}
