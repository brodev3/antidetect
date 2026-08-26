import { Injectable } from "@nestjs/common";
import type { HealthResponse } from "@antidetect/contracts";

@Injectable()
export class HealthService {
  getStatus(): HealthResponse {
    return { status: "ok" };
  }
}
