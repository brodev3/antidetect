import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiQuery,
  ApiServiceUnavailableResponse,
  ApiTags,
} from "@nestjs/swagger";
import {
  apiErrorSchema,
  createProfileRequestSchema,
  listProfilesQuerySchema,
  listProfilesResponseSchema,
  PROFILE_LIST_DEFAULT_LIMIT,
  PROFILE_LIST_DEFAULT_SORT_BY,
  PROFILE_LIST_DEFAULT_SORT_ORDER,
  PROFILE_LIST_MAX_LIMIT,
  PROFILE_LIST_SORT_BY_VALUES,
  PROFILE_LIST_SORT_ORDER_VALUES,
  profilePathParamsSchema,
  profileResponseSchema,
  type ListProfilesResponse,
  type ProfileResponse,
} from "@antidetect/contracts";
import { ZodResponse, createZodDto } from "nestjs-zod";
import { ProfileCreationService } from "./application/profiles/profile.creation.service.js";
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
  constructor(
    private readonly profileService: ProfileService,
    private readonly profileCreationService: ProfileCreationService,
  ) {}

  @Post()
  @HttpCode(201)
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiInternalServerErrorResponse({ type: ApiErrorDto })
  @ApiServiceUnavailableResponse({ type: ApiErrorDto })
  @ZodResponse({ status: 201, type: ProfileResponseDto })
  async create(@Body() request: CreateProfileRequestDto): Promise<ProfileResponse> {
    return this.profileCreationService.create(request);
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
  @ApiQuery({
    name: "search",
    required: false,
    type: String,
    maxLength: 100,
  })
  @ApiQuery({
    name: "sortBy",
    required: false,
    schema: {
      type: "string",
      enum: [...PROFILE_LIST_SORT_BY_VALUES],
      default: PROFILE_LIST_DEFAULT_SORT_BY,
    },
  })
  @ApiQuery({
    name: "sortOrder",
    required: false,
    schema: {
      type: "string",
      enum: [...PROFILE_LIST_SORT_ORDER_VALUES],
      default: PROFILE_LIST_DEFAULT_SORT_ORDER,
    },
  })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ZodResponse({ status: 200, type: ListProfilesResponseDto })
  async list(@Query() query: ListProfilesQueryDto): Promise<ListProfilesResponse> {
    const result = await this.profileService.list({
      limit: query.limit,
      offset: query.offset,
      search: query.search,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    });

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
