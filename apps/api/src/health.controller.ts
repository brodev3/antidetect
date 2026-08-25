import { Controller, Get } from "@nestjs/common";
import { healthResponseSchema, type HealthResponse } from "@antidetect/contracts";
import { ZodResponse, createZodDto } from "nestjs-zod";

class HealthResponseDto extends createZodDto(healthResponseSchema) {}

@Controller()
export class HealthController {
  @Get("health")
  @ZodResponse({ status: 200, type: HealthResponseDto })
  getHealth(): HealthResponse {
    return { status: "ok" };
  }
}
