import { createAdminLoginHandler } from "@/http/handlers/admin-login";
import { invokeWithDeps } from "@/http/http-utils";
import { getProductionAdminHttpDeps } from "@/http/production-admin-deps";

// External URL: POST /guess/api/admin/login
export async function POST(request: Request): Promise<Response> {
  return invokeWithDeps(getProductionAdminHttpDeps, createAdminLoginHandler, request, {});
}
