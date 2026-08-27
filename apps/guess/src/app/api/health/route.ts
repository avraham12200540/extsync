import { createHealthHandler } from "@/http/handlers/health";

// External URL: GET /guess/api/health
export async function GET(request: Request): Promise<Response> {
  return createHealthHandler()(request, {});
}
