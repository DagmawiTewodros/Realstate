import { Inject, Injectable } from "@nestjs/common";
import { createHmac } from "node:crypto";
import { APP_CONFIG, safeEqual, type BaseConfig } from "@platform/nest-common";

/**
 * Member check-in codes. A token holds only the member id and a version number, signed with HMAC.
 * Regenerating a member's code increases the version, so older codes stop working (lost phone).
 */
@Injectable()
export class QrService {
  constructor(@Inject(APP_CONFIG) private readonly config: BaseConfig) {}

  token(memberId: string, version: number): string {
    return `${Buffer.from(`${memberId}:${version}`).toString("base64url")}.${this.sign(memberId, version)}`;
  }

  /** Returns the member id and version for a correctly signed token, otherwise null. */
  verify(token: string): { memberId: string; version: number } | null {
    const [encoded, signature] = token.split(".");
    if (!encoded || !signature) return null;
    const decoded = Buffer.from(encoded, "base64url").toString("utf8");
    const match = /^([0-9a-f-]{36}):(\d{1,9})$/i.exec(decoded);
    if (!match) return null;
    const memberId = match[1];
    const version = Number(match[2]);
    return safeEqual(signature, this.sign(memberId, version)) ? { memberId, version } : null;
  }

  private sign(memberId: string, version: number): string {
    return createHmac("sha256", this.config.SESSION_SECRET).update(`qr:${memberId}:${version}`).digest("base64url").slice(0, 32);
  }
}
