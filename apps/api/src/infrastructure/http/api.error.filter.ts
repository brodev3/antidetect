import { Catch, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { ApiError, ApiErrorCode } from "@antidetect/contracts";
import type { FastifyReply } from "fastify";
import { ZodValidationException } from "nestjs-zod";
import { ProfileNotFoundError } from "../../application/profiles/profile.errors.js";

function createError(code: ApiErrorCode, message: string): ApiError {
  return { error: { code, message } };
}

@Catch(ZodValidationException, ProfileNotFoundError)
export class ApiErrorFilter implements ExceptionFilter {
  catch(
    exception: ZodValidationException | ProfileNotFoundError,
    host: ArgumentsHost,
  ): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();

    if (exception instanceof ProfileNotFoundError) {
      void reply
        .status(404)
        .send(createError("PROFILE_NOT_FOUND", "Profile was not found"));
      return;
    }

    void reply
      .status(400)
      .send(createError("VALIDATION_ERROR", "Request validation failed"));
  }
}
