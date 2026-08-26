import { Controller, Get } from "@nestjs/common";
import { healthResponseSchema, type HealthResponse } from "@antidetect/contracts";
import { ZodResponse, createZodDto } from "nestjs-zod";
import { HealthService } from "./health.service.js";

class HealthResponseDto extends createZodDto(healthResponseSchema) {}

@Controller()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get("health")
  @ZodResponse({ status: 200, type: HealthResponseDto })
  getHealth(): HealthResponse {
    return this.healthService.getStatus();
  }
}
