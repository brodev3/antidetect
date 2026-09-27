import { Controller, Get, HttpCode, Param, Post, Res } from "@nestjs/common";
import {
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiTags,
} from "@nestjs/swagger";
import type { FastifyReply } from "fastify";
import {
  apiErrorSchema,
  browserRunStateResponseSchema,
  profilePathParamsSchema,
  type BrowserRunResponse,
  type BrowserRunStateResponse,
} from "@antidetect/contracts";
import { ZodResponse, createZodDto } from "nestjs-zod";
import { BrowserLifecycleService } from "./application/browserRuns/browser.lifecycle.service.js";

class ApiErrorDto extends createZodDto(apiErrorSchema) {}
class BrowserRunStateResponseDto extends createZodDto(browserRunStateResponseSchema) {}
class ProfilePathParamsDto extends createZodDto(profilePathParamsSchema) {}

function toBrowserRunResponse(run: {
  readonly id: string;
  readonly profileId: string;
  readonly status: BrowserRunResponse["status"];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly endedAt: string | null;
}): BrowserRunResponse {
  return {
    id: run.id,
    profileId: run.profileId,
    status: run.status,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    endedAt: run.endedAt,
  };
}

function toBrowserRunStateResponse(
  run: Parameters<typeof toBrowserRunResponse>[0] | null,
): BrowserRunStateResponse {
  return { run: run === null ? null : toBrowserRunResponse(run) };
}

@ApiTags("browser-runs")
@Controller("profiles")
export class BrowserRunsController {
  constructor(private readonly lifecycle: BrowserLifecycleService) {}

  @Post(":profileId/start")
  @HttpCode(202)
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiConflictResponse({ type: ApiErrorDto })
  @ApiInternalServerErrorResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ZodResponse({ status: 202, type: BrowserRunStateResponseDto })
  async start(
    @Param() params: ProfilePathParamsDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<BrowserRunStateResponse> {
    const run = await this.lifecycle.start(params.profileId);
    reply.header("location", `/profiles/${params.profileId}/run`);
    return toBrowserRunStateResponse(run);
  }

  @Post(":profileId/stop")
  @HttpCode(200)
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiConflictResponse({ type: ApiErrorDto })
  @ApiInternalServerErrorResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiOkResponse({ type: BrowserRunStateResponseDto })
  @ZodResponse({ status: 202, type: BrowserRunStateResponseDto })
  async stop(
    @Param() params: ProfilePathParamsDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<BrowserRunStateResponse> {
    const result = await this.lifecycle.stop(params.profileId);
    if (result.accepted) {
      reply.status(202);
      reply.header("location", `/profiles/${params.profileId}/run`);
    }
    return toBrowserRunStateResponse(result.run);
  }

  @Get(":profileId/run")
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ZodResponse({ status: 200, type: BrowserRunStateResponseDto })
  async getLatest(
    @Param() params: ProfilePathParamsDto,
  ): Promise<BrowserRunStateResponse> {
    const run = await this.lifecycle.getLatest(params.profileId);
    return toBrowserRunStateResponse(run);
  }
}
