import { DefaultAzureCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";

export const KEY_VAULT_SECRET_NAMES = {
  DATABASE_URL: "DATABASE-URL",
  DIRECT_URL: "DIRECT-URL",
  JWT_SECRET: "JWT-SECRET",
  MICROSOFT_CLIENT_SECRET: "MICROSOFT-CLIENT-SECRET",
  SUPABASE_SECRET_KEY: "SUPABASE-SECRET-KEY",
  HELPDESK_PEER_API_KEY: "HELPDESK-PEER-API-KEY",
  EDUCORE_API_KEY: "EDUCORE-API-KEY",
} as const;

export type SecretLoader = { load(secretNames: readonly string[]): Promise<Record<string, string>> };
type SecretReader = { getSecret(name: string): Promise<{ value?: string | undefined }> };

export class AzureKeyVaultSecretLoader implements SecretLoader {
  private readonly client: SecretReader;

  constructor(vaultUrl: string, client?: SecretReader) {
    try {
      const url = new URL(vaultUrl);
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error();
    } catch {
      throw new Error("AZURE_KEY_VAULT_URL must be a valid HTTPS URL");
    }
    this.client = client ?? new SecretClient(vaultUrl, new DefaultAzureCredential());
  }

  async load(secretNames: readonly string[]): Promise<Record<string, string>> {
    const entries = await Promise.all(secretNames.map(async (name) => {
      try {
        const secret = await this.client.getSecret(name);
        if (!secret.value) throw new Error("secret has no value");
        return [name, secret.value] as const;
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown Azure error";
        throw new Error(`Failed to load required Key Vault secret ${name}: ${message}`, { cause: error });
      }
    }));
    return Object.fromEntries(entries);
  }
}
