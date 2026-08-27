import { createAdminRevokeOtherSessionsHandler } from "@/http/handlers/admin-revoke-other-sessions";
import { invokeWithDeps } from "@/http/http-utils";
import { getProductionAdminHttpDeps } from "@/http/production-admin-deps";

// External URL: POST /guess/api/admin/sessions/revoke-others
export async function POST(request: Request): Promise<Response> {
  return invokeWithDeps(getProductionAdminHttpDeps, createAdminRevokeOtherSessionsHandler, request, {});
}
