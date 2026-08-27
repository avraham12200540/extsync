import { createShareResultsHandler } from "@/http/handlers/share-results";
import { invokeWithDeps } from "@/http/http-utils";
import { getProductionHttpDeps } from "@/http/production-deps";

// External URL: GET /guess/api/results/:shareToken (public, no session required)
export async function GET(request: Request, context: { params: Promise<{ shareToken: string }> }): Promise<Response> {
  const params = await context.params;
  return invokeWithDeps(getProductionHttpDeps, createShareResultsHandler, request, params);
}
