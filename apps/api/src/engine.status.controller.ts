import { Controller, Get, Header, Inject } from "@nestjs/common";
import {
  engineStatusResponseSchema,
  type EngineStatusResponse,
} from "@antidetect/contracts";
import { createZodDto, ZodResponse } from "nestjs-zod";
import { EngineStatusReader } from "./application/runtime/engine.status.reader.js";

class EngineStatusResponseDto extends createZodDto(engineStatusResponseSchema) {}

@Controller("engine")
export class EngineStatusController {
  constructor(
    @Inject(EngineStatusReader) private readonly reader: EngineStatusReader,
  ) {}

  @Get("status")
  @Header("Cache-Control", "no-store")
  @ZodResponse({ status: 200, type: EngineStatusResponseDto })
  getStatus(): Promise<EngineStatusResponse> {
    return this.reader.read();
  }
}
