import { createAdminLogoutHandler } from "@/http/handlers/admin-logout";
import { invokeWithDeps } from "@/http/http-utils";
import { getProductionAdminHttpDeps } from "@/http/production-admin-deps";

// External URL: POST /guess/api/admin/logout
export async function POST(request: Request): Promise<Response> {
  return invokeWithDeps(getProductionAdminHttpDeps, createAdminLogoutHandler, request, {});
}
