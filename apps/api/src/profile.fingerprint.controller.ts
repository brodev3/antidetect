import { Body, Controller, HttpCode, Param, Patch } from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from "@nestjs/swagger";
import {
  apiErrorSchema,
  profilePathParamsSchema,
  profileResponseSchema,
  updateProfileFingerprintModeRequestSchema,
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
}
