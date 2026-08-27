import { createAdvanceHandler } from "@/http/handlers/advance";
import { invokeWithDeps } from "@/http/http-utils";
import { getProductionHttpDeps } from "@/http/production-deps";

// External URL: POST /guess/api/games/:gameId/advance
export async function POST(request: Request, context: { params: Promise<{ gameId: string }> }): Promise<Response> {
  const params = await context.params;
  return invokeWithDeps(getProductionHttpDeps, createAdvanceHandler, request, params);
}
