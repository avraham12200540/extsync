import { createAdminModerationDetailHandler } from "@/http/handlers/admin-moderation";
import { invokeWithDeps } from "@/http/http-utils";
import { getProductionAdminHttpDeps } from "@/http/production-admin-deps";

// External URL: GET /guess/api/admin/moderation/:forumPostId
export async function GET(request: Request, context: { params: Promise<{ forumPostId: string }> }): Promise<Response> {
  const params = await context.params;
  return invokeWithDeps(getProductionAdminHttpDeps, createAdminModerationDetailHandler, request, params);
}
