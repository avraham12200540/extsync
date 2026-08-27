import { createAdminForumUserDetailHandler } from "@/http/handlers/admin-forum-users";
import { invokeWithDeps } from "@/http/http-utils";
import { getProductionAdminHttpDeps } from "@/http/production-admin-deps";

// External URL: GET /guess/api/admin/forum-users/:forumUserId
export async function GET(request: Request, context: { params: Promise<{ forumUserId: string }> }): Promise<Response> {
  const params = await context.params;
  return invokeWithDeps(getProductionAdminHttpDeps, createAdminForumUserDetailHandler, request, params);
}
