import { createAdminModerationQueueHandler } from "@/http/handlers/admin-moderation";
import { invokeWithDeps } from "@/http/http-utils";
import { getProductionAdminHttpDeps } from "@/http/production-admin-deps";

// External URL: GET /guess/api/admin/moderation/queue
export async function GET(request: Request): Promise<Response> {
  return invokeWithDeps(getProductionAdminHttpDeps, createAdminModerationQueueHandler, request, {});
}
