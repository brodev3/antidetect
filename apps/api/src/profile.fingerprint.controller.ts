import { Body, Controller, HttpCode, Param, Patch, Post } from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
} from "@nestjs/swagger";
import {
  apiErrorSchema,
  profilePathParamsSchema,
  profileResponseSchema,
  updateProfileFingerprintModeRequestSchema,
  updateProfileFingerprintPlatformRequestSchema,
  type ProfileResponse,
} from "@antidetect/contracts";
import { ZodResponse, createZodDto } from "nestjs-zod";
import { BrowserLifecycleService } from "./application/browserRuns/browser.lifecycle.service.js";

class ApiErrorDto extends createZodDto(apiErrorSchema) {}
class ProfilePathParamsDto extends createZodDto(profilePathParamsSchema) {}
class ProfileResponseDto extends createZodDto(profileResponseSchema) {}
class UpdateProfileFingerprintModeRequestDto extends createZodDto(
  updateProfileFingerprintModeRequestSchema,
) {}
class UpdateProfileFingerprintPlatformRequestDto extends createZodDto(
  updateProfileFingerprintPlatformRequestSchema,
) {}

@ApiTags("profiles")
@Controller("profiles")
export class ProfileFingerprintController {
  constructor(private readonly lifecycle: BrowserLifecycleService) {}

  @Patch(":profileId/fingerprint")
  @HttpCode(200)
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiConflictResponse({ type: ApiErrorDto })
  @ApiInternalServerErrorResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiServiceUnavailableResponse({ type: ApiErrorDto })
  @ApiOkResponse({ type: ProfileResponseDto })
  @ZodResponse({ status: 200, type: ProfileResponseDto })
  async updateFingerprintMode(
    @Param() params: ProfilePathParamsDto,
    @Body() request: UpdateProfileFingerprintModeRequestDto,
  ): Promise<ProfileResponse> {
    return this.lifecycle.updateFingerprintMode(
      params.profileId,
      request.fingerprintEnabled,
    );
  }

  @Patch(":profileId/fingerprint/platform")
  @HttpCode(200)
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiConflictResponse({ type: ApiErrorDto })
  @ApiInternalServerErrorResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiServiceUnavailableResponse({ type: ApiErrorDto })
  @ApiOkResponse({ type: ProfileResponseDto })
  @ZodResponse({ status: 200, type: ProfileResponseDto })
  async updateFingerprintPlatform(
    @Param() params: ProfilePathParamsDto,
    @Body() request: UpdateProfileFingerprintPlatformRequestDto,
  ): Promise<ProfileResponse> {
    return this.lifecycle.updateFingerprintPlatform(
      params.profileId,
      request.fingerprintPlatform,
    );
  }

  @Post(":profileId/fingerprint/replace")
  @HttpCode(200)
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiConflictResponse({ type: ApiErrorDto })
  @ApiInternalServerErrorResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiServiceUnavailableResponse({ type: ApiErrorDto })
  @ApiOkResponse({ type: ProfileResponseDto })
  @ZodResponse({ status: 200, type: ProfileResponseDto })
  async replaceFingerprintIdentity(
    @Param() params: ProfilePathParamsDto,
  ): Promise<ProfileResponse> {
    return this.lifecycle.replaceFingerprintIdentity(params.profileId);
  }
}
