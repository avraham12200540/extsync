import { createAdminForumUserOverrideHandler } from "@/http/handlers/admin-forum-users";
import { invokeWithDeps } from "@/http/http-utils";
import { getProductionAdminHttpDeps } from "@/http/production-admin-deps";

// External URL: POST /guess/api/admin/forum-users/:forumUserId/eligibility-override
export async function POST(request: Request, context: { params: Promise<{ forumUserId: string }> }): Promise<Response> {
  const params = await context.params;
  return invokeWithDeps(getProductionAdminHttpDeps, createAdminForumUserOverrideHandler, request, params);
}
