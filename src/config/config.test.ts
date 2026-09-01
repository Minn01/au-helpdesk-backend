import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadConfiguration } from "./env.js";
import { AzureKeyVaultSecretLoader, KEY_VAULT_SECRET_NAMES, type SecretLoader } from "./key-vault.js";

const jwtSecret = "test-jwt-secret-that-is-at-least-32-characters";
const localSupabase = { SUPABASE_URL: "https://project.supabase.co", SUPABASE_SECRET_KEY: "local-supabase-secret" };
const localOpenAI = { OPENAI_API_KEY: "test-openai-key" };
const productionEnvironment = {
  NODE_ENV: "production",
  AZURE_KEY_VAULT_URL: "https://helpdesk.vault.azure.net",
  MICROSOFT_TENANT_ID: "10000000-0000-4000-8000-000000000001",
  MICROSOFT_CLIENT_ID: "10000000-0000-4000-8000-000000000002",
  MICROSOFT_REDIRECT_URI: "https://example.edu/helpdesk/api/auth/microsoft/callback",
  FRONTEND_URL: "https://example.edu/helpdesk",
  SUPABASE_URL: "https://project.supabase.co",
  EDUCORE_BASE_URL: "https://educore.example.edu",
};
const vaultSecrets = {
  "DATABASE-URL": "postgresql://runtime",
  "DIRECT-URL": "postgresql://direct",
  "JWT-SECRET": jwtSecret,
  "MICROSOFT-CLIENT-SECRET": "microsoft-secret",
  "SUPABASE-SECRET-KEY": "supabase-secret",
  "HELPDESK-PEER-API-KEY": "helpdesk-peer-key-at-least-32-characters",
  "EDUCORE-API-KEY": "educore-outgoing-key-at-least-32-characters",
  "OPENAI-API-KEY": "openai-secret",
};

describe("application configuration", () => {
  it("continues to load local development secrets from the environment", async () => {
    const config = await loadConfiguration({
      environment: {
        NODE_ENV: "development", DATABASE_URL: "postgresql://local", JWT_SECRET: jwtSecret, ...localSupabase, ...localOpenAI,
      },
    });
    assert.equal(config.secretSource, "environment");
    assert.equal(config.databaseUrl, "postgresql://local");
    assert.equal(config.jwtSecret, jwtSecret);
    assert.equal(config.openai.apiKey, localOpenAI.OPENAI_API_KEY);
    assert.equal(config.openai.model, "gpt-5.6-luna");
    assert.equal(config.openai.timeoutMs, 8_000);
    assert.equal(config.microsoft, undefined);
  });

  it("maps Key Vault names into typed application configuration", async () => {
    let requested: readonly string[] = [];
    const secretLoader: SecretLoader = {
      load: async (names) => { requested = names; return vaultSecrets; },
    };
    const config = await loadConfiguration({ environment: productionEnvironment, secretLoader });
    assert.deepEqual(requested, Object.values(KEY_VAULT_SECRET_NAMES));
    assert.equal(config.databaseUrl, vaultSecrets["DATABASE-URL"]);
    assert.equal(config.directUrl, vaultSecrets["DIRECT-URL"]);
    assert.equal(config.jwtSecret, vaultSecrets["JWT-SECRET"]);
    assert.equal(config.microsoft?.clientSecret, vaultSecrets["MICROSOFT-CLIENT-SECRET"]);
    assert.equal(config.supabase.secretKey, vaultSecrets["SUPABASE-SECRET-KEY"]);
    assert.equal(config.educore?.incomingApiKey, vaultSecrets["HELPDESK-PEER-API-KEY"]);
    assert.equal(config.educore?.outgoingApiKey, vaultSecrets["EDUCORE-API-KEY"]);
    assert.equal(config.openai.apiKey, vaultSecrets["OPENAI-API-KEY"]);
  });

  it("validates required environment secrets", async () => {
    await assert.rejects(
      loadConfiguration({ environment: { NODE_ENV: "development", DATABASE_URL: "postgresql://local", ...localSupabase, ...localOpenAI } }),
      /JWT_SECRET is required/,
    );
  });

  it("requires an OpenAI key and validates model configuration", async () => {
    const base = { NODE_ENV: "development", DATABASE_URL: "postgresql://local", JWT_SECRET: jwtSecret, ...localSupabase };
    await assert.rejects(loadConfiguration({ environment: base }), /OPENAI_API_KEY is required/);
    await assert.rejects(
      loadConfiguration({ environment: { ...base, ...localOpenAI, OPENAI_MODEL: "invalid model name" } }),
      /OPENAI_MODEL is invalid/,
    );
  });

  it("fails production startup when a required vault secret is missing", async () => {
    const secretLoader: SecretLoader = { load: async () => ({ ...vaultSecrets, "JWT-SECRET": "" }) };
    await assert.rejects(loadConfiguration({ environment: productionEnvironment, secretLoader }), /JWT_SECRET is required/);
  });

  it("does not permit environment secrets as a production fallback", async () => {
    await assert.rejects(
      loadConfiguration({ environment: { ...productionEnvironment, SECRET_SOURCE: "environment" } }),
      /Production must use Azure Key Vault/,
    );
  });
});

describe("Azure Key Vault adapter", () => {
  it("can be tested without Azure and retrieves every secret exactly once", async () => {
    const calls: string[] = [];
    const reader = {
      getSecret: async (name: string) => { calls.push(name); return { value: `value-for-${name}` }; },
    };
    const loader = new AzureKeyVaultSecretLoader("https://helpdesk.vault.azure.net", reader);
    const names = ["DATABASE-URL", "JWT-SECRET"];
    const loaded = await loader.load(names);
    assert.deepEqual(calls.sort(), [...names].sort());
    assert.equal(loaded["DATABASE-URL"], "value-for-DATABASE-URL");
  });

  it("reports the failed secret name without exposing other secret values", async () => {
    const loader = new AzureKeyVaultSecretLoader("https://helpdesk.vault.azure.net", {
      getSecret: async () => { throw new Error("access denied"); },
    });
    await assert.rejects(loader.load(["JWT-SECRET"]), /Failed to load required Key Vault secret JWT-SECRET: access denied/);
  });
});
