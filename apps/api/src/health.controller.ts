import { Controller, Get } from "@nestjs/common";
import type { HealthResponse } from "@antidetect/contracts";

@Controller()
export class HealthController {
  @Get("health")
  getHealth(): HealthResponse {
    return { status: "ok" };
  }
}
