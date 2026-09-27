import { Catch, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { ApiError, ApiErrorCode } from "@antidetect/contracts";
import type { FastifyReply } from "fastify";
import { ZodValidationException } from "nestjs-zod";
import { ProfileNotFoundError } from "../../application/profiles/profile.errors.js";
import {
  ActiveBrowserRunConflictError,
  BrowserRunStartingError,
  BrowserRuntimeLaunchFailedError,
  BrowserRuntimeRecoveryRequiredError,
  BrowserRuntimeStopFailedError,
} from "../../application/browserRuns/browser.run.errors.js";

function createError(code: ApiErrorCode, message: string): ApiError {
  return { error: { code, message } };
}

@Catch(
  ZodValidationException,
  ProfileNotFoundError,
  ActiveBrowserRunConflictError,
  BrowserRunStartingError,
  BrowserRuntimeLaunchFailedError,
  BrowserRuntimeRecoveryRequiredError,
  BrowserRuntimeStopFailedError,
)
export class ApiErrorFilter implements ExceptionFilter {
  catch(
    exception:
      | ZodValidationException
      | ProfileNotFoundError
      | ActiveBrowserRunConflictError
      | BrowserRunStartingError
      | BrowserRuntimeLaunchFailedError
      | BrowserRuntimeRecoveryRequiredError
      | BrowserRuntimeStopFailedError,
    host: ArgumentsHost,
  ): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();

    if (exception instanceof ProfileNotFoundError) {
      void reply
        .status(404)
        .send(createError("PROFILE_NOT_FOUND", "Profile was not found"));
      return;
    }

    if (exception instanceof ActiveBrowserRunConflictError) {
      void reply
        .status(409)
        .send(
          createError(
            "ACTIVE_BROWSER_RUN_CONFLICT",
            "Profile already has an active browser run",
          ),
        );
      return;
    }

    if (exception instanceof BrowserRunStartingError) {
      void reply
        .status(409)
        .send(
          createError("BROWSER_RUN_START_IN_PROGRESS", "Browser run is still starting"),
        );
      return;
    }

    if (exception instanceof BrowserRuntimeRecoveryRequiredError) {
      void reply
        .status(409)
        .send(
          createError(
            "BROWSER_RUNTIME_RECOVERY_REQUIRED",
            "Browser run requires recovery",
          ),
        );
      return;
    }

    if (exception instanceof BrowserRuntimeLaunchFailedError) {
      void reply
        .status(500)
        .send(
          createError("BROWSER_RUNTIME_LAUNCH_FAILED", "Browser runtime launch failed"),
        );
      return;
    }

    if (exception instanceof BrowserRuntimeStopFailedError) {
      void reply
        .status(409)
        .send(
          createError("BROWSER_RUNTIME_STOP_FAILED", "Browser runtime stop failed"),
        );
      return;
    }

    void reply
      .status(400)
      .send(createError("VALIDATION_ERROR", "Request validation failed"));
  }
}
