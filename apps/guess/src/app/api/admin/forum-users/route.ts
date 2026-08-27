import { createAdminForumUsersListHandler } from "@/http/handlers/admin-forum-users";
import { invokeWithDeps } from "@/http/http-utils";
import { getProductionAdminHttpDeps } from "@/http/production-admin-deps";

// External URL: GET /guess/api/admin/forum-users
export async function GET(request: Request): Promise<Response> {
  return invokeWithDeps(getProductionAdminHttpDeps, createAdminForumUsersListHandler, request, {});
}
