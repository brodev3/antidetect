import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";
import {
  apiErrorSchema,
  createProfileRequestSchema,
  listProfilesQuerySchema,
  listProfilesResponseSchema,
  PROFILE_LIST_DEFAULT_LIMIT,
  PROFILE_LIST_MAX_LIMIT,
  profilePathParamsSchema,
  profileResponseSchema,
  type ListProfilesResponse,
  type ProfileResponse,
} from "@antidetect/contracts";
import { ZodResponse, createZodDto } from "nestjs-zod";
import { ProfileService } from "./application/profiles/profile.service.js";

class ApiErrorDto extends createZodDto(apiErrorSchema) {}
class CreateProfileRequestDto extends createZodDto(createProfileRequestSchema) {}
class ListProfilesQueryDto extends createZodDto(listProfilesQuerySchema) {}
class ListProfilesResponseDto extends createZodDto(listProfilesResponseSchema) {}
class ProfilePathParamsDto extends createZodDto(profilePathParamsSchema) {}
class ProfileResponseDto extends createZodDto(profileResponseSchema) {}

@ApiTags("profiles")
@Controller("profiles")
export class ProfilesController {
  constructor(private readonly profileService: ProfileService) {}

  @Post()
  @HttpCode(201)
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ZodResponse({ status: 201, type: ProfileResponseDto })
  async create(@Body() request: CreateProfileRequestDto): Promise<ProfileResponse> {
    return this.profileService.create(request);
  }

  @Get()
  @ApiQuery({
    name: "limit",
    required: false,
    type: Number,
    minimum: 1,
    maximum: PROFILE_LIST_MAX_LIMIT,
    default: PROFILE_LIST_DEFAULT_LIMIT,
  })
  @ApiQuery({
    name: "offset",
    required: false,
    type: Number,
    minimum: 0,
    maximum: Number.MAX_SAFE_INTEGER,
    default: 0,
  })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ZodResponse({ status: 200, type: ListProfilesResponseDto })
  async list(@Query() query: ListProfilesQueryDto): Promise<ListProfilesResponse> {
    const result = await this.profileService.list(query);

    return {
      items: [...result.items],
      nextOffset: result.nextOffset,
    };
  }

  @Get(":profileId")
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ZodResponse({ status: 200, type: ProfileResponseDto })
  async getById(@Param() params: ProfilePathParamsDto): Promise<ProfileResponse> {
    return this.profileService.getById(params.profileId);
  }
}
