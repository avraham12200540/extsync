import { createSessionHandler } from "@/http/handlers/session";
import { invokeWithDeps } from "@/http/http-utils";
import { getProductionHttpDeps } from "@/http/production-deps";

// External URL: POST /guess/api/session (basePath prefixes this automatically - see next.config.mjs).
export async function POST(request: Request): Promise<Response> {
  return invokeWithDeps(getProductionHttpDeps, createSessionHandler, request, {});
}
