import { createAdminModerationRejectHandler } from "@/http/handlers/admin-moderation";
import { invokeWithDeps } from "@/http/http-utils";
import { getProductionAdminHttpDeps } from "@/http/production-admin-deps";

// External URL: POST /guess/api/admin/moderation/:forumPostId/reject
export async function POST(request: Request, context: { params: Promise<{ forumPostId: string }> }): Promise<Response> {
  const params = await context.params;
  return invokeWithDeps(getProductionAdminHttpDeps, createAdminModerationRejectHandler, request, params);
}
