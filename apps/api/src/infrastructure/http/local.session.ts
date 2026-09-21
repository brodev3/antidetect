import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const LOCAL_SESSION_COOKIE_NAME = "antidetect_session";

const SESSION_TOKEN_BYTES = 32;

function digestToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

function readSessionCookie(cookieHeader: string | undefined): string | undefined {
  if (cookieHeader === undefined) {
    return undefined;
  }

  const values = cookieHeader.split(";").flatMap((part) => {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex === -1) {
      return [];
    }

    const name = part.slice(0, separatorIndex).trim();
    if (name !== LOCAL_SESSION_COOKIE_NAME) {
      return [];
    }

    return [part.slice(separatorIndex + 1).trim()];
  });

  if (values.length !== 1 || values[0] === "") {
    return undefined;
  }

  return values[0];
}

export class LocalSessionStore {
  private tokenDigest: Buffer | undefined;

  issueSetCookieHeader(cookieHeader: string | undefined): string | undefined {
    if (this.isValidCookieHeader(cookieHeader)) {
      return undefined;
    }

    const token = randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
    this.tokenDigest = digestToken(token);
    return `${LOCAL_SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict`;
  }

  isValidCookieHeader(cookieHeader: string | undefined): boolean {
    const expectedDigest = this.tokenDigest;
    if (expectedDigest === undefined) {
      return false;
    }

    const token = readSessionCookie(cookieHeader);
    if (token === undefined) {
      return false;
    }

    return timingSafeEqual(expectedDigest, digestToken(token));
  }
}
