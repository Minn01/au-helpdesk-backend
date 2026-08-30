import { ConfidentialClientApplication, type Configuration } from "@azure/msal-node";
import { UserRole, type PrismaClient } from "../../generated/prisma/client.js";
import { HttpError } from "../errors/http-error.js";

const scopes = ["openid", "profile", "email"];

export type MicrosoftConfig = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  frontendUrl: string;
};

export type MicrosoftIdentity = {
  tenantId: string;
  objectId: string;
  email: string;
  displayName: string;
};

export type MicrosoftOAuthClient = {
  authorizationUrl(state: string, nonce: string): Promise<string>;
  exchangeCode(code: string, nonce: string): Promise<MicrosoftIdentity>;
};

export type MicrosoftUserProvisioner = {
  findOrCreate(identity: MicrosoftIdentity): Promise<{ id: string; isActive: boolean }>;
};

export class MsalMicrosoftOAuthClient implements MicrosoftOAuthClient {
  private readonly client: ConfidentialClientApplication;

  constructor(private readonly config: MicrosoftConfig) {
    const msalConfig: Configuration = {
      auth: {
        authority: `https://login.microsoftonline.com/${config.tenantId}`,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
      },
    };
    this.client = new ConfidentialClientApplication(msalConfig);
  }

  authorizationUrl(state: string, nonce: string) {
    return this.client.getAuthCodeUrl({ scopes, redirectUri: this.config.redirectUri, state, nonce, responseMode: "query" });
  }

  async exchangeCode(code: string, nonce: string): Promise<MicrosoftIdentity> {
    const result = await this.client.acquireTokenByCode({ code, scopes, redirectUri: this.config.redirectUri, nonce });
    const claims = result.idTokenClaims as Record<string, unknown> | undefined;
    const tenantId = claims?.tid;
    const objectId = claims?.oid;
    const email = claims?.email ?? claims?.preferred_username ?? result.account?.username;
    const displayName = claims?.name ?? result.account?.name;
    if (typeof tenantId !== "string" || tenantId.toLowerCase() !== this.config.tenantId.toLowerCase() || typeof objectId !== "string") {
      throw new HttpError(401, "MICROSOFT_IDENTITY_INVALID", "Microsoft identity could not be verified");
    }
    if (typeof email !== "string" || !email.includes("@") || typeof displayName !== "string" || !displayName.trim()) {
      throw new HttpError(401, "MICROSOFT_PROFILE_INCOMPLETE", "Microsoft account profile is missing required information");
    }
    return { tenantId, objectId, email: email.trim().toLowerCase(), displayName: displayName.trim() };
  }
}

export class PrismaMicrosoftUserProvisioner implements MicrosoftUserProvisioner {
  constructor(private readonly database: PrismaClient) {}

  async findOrCreate(identity: MicrosoftIdentity) {
    return this.database.$transaction(async (transaction) => {
      const linked = await transaction.user.findUnique({
        where: { microsoftTenantId_microsoftObjectId: { microsoftTenantId: identity.tenantId, microsoftObjectId: identity.objectId } },
        select: { id: true, isActive: true },
      });
      if (linked) return linked;

      const existing = await transaction.user.findFirst({
        where: { email: { equals: identity.email, mode: "insensitive" } },
        select: { id: true, isActive: true, microsoftTenantId: true, microsoftObjectId: true },
      });
      if (existing?.microsoftObjectId || existing?.microsoftTenantId) {
        throw new HttpError(409, "MICROSOFT_IDENTITY_CONFLICT", "This HelpDesk account is linked to another Microsoft identity");
      }
      if (existing) {
        return transaction.user.update({
          where: { id: existing.id },
          data: { microsoftTenantId: identity.tenantId, microsoftObjectId: identity.objectId, displayName: identity.displayName },
          select: { id: true, isActive: true },
        });
      }
      return transaction.user.create({
        data: {
          email: identity.email,
          displayName: identity.displayName,
          role: UserRole.STUDENT,
          microsoftTenantId: identity.tenantId,
          microsoftObjectId: identity.objectId,
        },
        select: { id: true, isActive: true },
      });
    });
  }
}
