import { Controller, Get, Headers, HttpCode, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { LocalSessionStore } from "./local.session.js";

@Controller("session")
export class LocalSessionController {
  constructor(private readonly session: LocalSessionStore) {}

  @Get()
  @HttpCode(204)
  issue(
    @Headers("cookie") cookieHeader: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): void {
    const setCookieHeader = this.session.issueSetCookieHeader(cookieHeader);
    if (setCookieHeader !== undefined) {
      reply.header("set-cookie", setCookieHeader);
    }
  }
}
