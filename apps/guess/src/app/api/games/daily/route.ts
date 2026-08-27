import { createGamesDailyHandler } from "@/http/handlers/games-daily";
import { invokeWithDeps } from "@/http/http-utils";
import { getProductionHttpDeps } from "@/http/production-deps";

// External URL: POST /guess/api/games/daily
export async function POST(request: Request): Promise<Response> {
  return invokeWithDeps(getProductionHttpDeps, createGamesDailyHandler, request, {});
}
