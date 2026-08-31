import type { MicrosoftConfig } from "../auth/microsoft-auth.service.js";
import { AzureKeyVaultSecretLoader, KEY_VAULT_SECRET_NAMES, type SecretLoader } from "./key-vault.js";

export type NodeEnvironment = "development" | "test" | "production";
export type SecretSource = "environment" | "azure-key-vault";

export type AppConfig = {
  nodeEnv: NodeEnvironment;
  port: number;
  secretSource: SecretSource;
  databaseUrl: string;
  directUrl?: string | undefined;
  jwtSecret: string;
  microsoft?: MicrosoftConfig | undefined;
  supabase: { url: string; secretKey: string; storageBucket: string };
  educore?: {
    baseUrl: string;
    incomingApiKey: string;
    outgoingApiKey: string;
    contextPathTemplate: string;
    timeoutMs: number;
  } | undefined;
};

type Environment = Record<string, string | undefined>;
type LoadConfigurationOptions = { environment?: Environment; secretLoader?: SecretLoader };

const required = (value: string | undefined, name: string): string => {
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const requireJwtSecret = (value: string | undefined): string => {
  const secret = required(value, "JWT_SECRET");
  if (secret.length < 32) throw new Error("JWT_SECRET must be at least 32 characters");
  return secret;
};

const parsePort = (value: string | undefined): number => {
  if (value === undefined) return 5050;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("PORT must be an integer between 1 and 65535");
  return port;
};

const parseNodeEnv = (value: string | undefined): NodeEnvironment => {
  if (value === undefined) return "development";
  if (value === "development" || value === "test" || value === "production") return value;
  throw new Error("NODE_ENV must be development, test, or production");
};

const parseSecretSource = (value: string | undefined, nodeEnv: NodeEnvironment): SecretSource => {
  if (value === undefined) return nodeEnv === "production" ? "azure-key-vault" : "environment";
  if (value === "environment" || value === "azure-key-vault") return value;
  throw new Error("SECRET_SOURCE must be environment or azure-key-vault");
};

const createEduCoreConfig = (
  environment: Environment,
  incomingApiKey: string | undefined,
  outgoingApiKey: string | undefined,
  nodeEnv: NodeEnvironment,
): AppConfig["educore"] => {
  const configured = Boolean(environment.EDUCORE_BASE_URL || incomingApiKey || outgoingApiKey);
  if (!configured && nodeEnv !== "production") return undefined;
  const baseUrl = new URL(required(environment.EDUCORE_BASE_URL, "EDUCORE_BASE_URL"));
  if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") throw new Error("EDUCORE_BASE_URL must use HTTP or HTTPS");
  if (baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) throw new Error("EDUCORE_BASE_URL is invalid");
  if (nodeEnv === "production" && baseUrl.protocol !== "https:") throw new Error("EDUCORE_BASE_URL must use HTTPS in production");
  const incoming = required(incomingApiKey, "HELPDESK_PEER_API_KEY");
  const outgoing = required(outgoingApiKey, "EDUCORE_API_KEY");
  if (incoming.length < 32) throw new Error("HELPDESK_PEER_API_KEY must be at least 32 characters");
  if (outgoing.length < 32) throw new Error("EDUCORE_API_KEY must be at least 32 characters");
  const contextPathTemplate = environment.EDUCORE_CONTEXT_PATH_TEMPLATE
    || "/api/peer/helpdesk/registration-context/{eventId}";
  if (
    !contextPathTemplate.startsWith("/")
    || contextPathTemplate.startsWith("//")
    || contextPathTemplate.includes("\\")
    || contextPathTemplate.includes("?")
    || contextPathTemplate.includes("#")
    || contextPathTemplate.split("{eventId}").length !== 2
  ) {
    throw new Error("EDUCORE_CONTEXT_PATH_TEMPLATE must be a path containing {eventId}");
  }
  const timeoutMs = environment.EDUCORE_TIMEOUT_MS === undefined ? 4_000 : Number(environment.EDUCORE_TIMEOUT_MS);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > 15_000) {
    throw new Error("EDUCORE_TIMEOUT_MS must be an integer between 500 and 15000");
  }
  return {
    baseUrl: baseUrl.toString().replace(/\/$/, ""),
    incomingApiKey: incoming,
    outgoingApiKey: outgoing,
    contextPathTemplate,
    timeoutMs,
  };
};

const createMicrosoftConfig = (
  environment: Environment,
  clientSecret: string | undefined,
  nodeEnv: NodeEnvironment,
): MicrosoftConfig | undefined => {
  const values = {
    tenantId: environment.MICROSOFT_TENANT_ID,
    clientId: environment.MICROSOFT_CLIENT_ID,
    clientSecret,
    redirectUri: environment.MICROSOFT_REDIRECT_URI,
    frontendUrl: environment.FRONTEND_URL,
  };
  const configured = Object.values(values).some(Boolean);
  if (!configured && nodeEnv !== "production") return undefined;
  const names: Record<keyof typeof values, string> = {
    tenantId: "MICROSOFT_TENANT_ID",
    clientId: "MICROSOFT_CLIENT_ID",
    clientSecret: "MICROSOFT_CLIENT_SECRET",
    redirectUri: "MICROSOFT_REDIRECT_URI",
    frontendUrl: "FRONTEND_URL",
  };
  for (const key of Object.keys(values) as Array<keyof typeof values>) {
    if (!values[key]) throw new Error(`${names[key]} is required when Microsoft authentication is configured`);
  }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuid.test(values.tenantId!)) throw new Error("MICROSOFT_TENANT_ID must be a UUID");
  if (!uuid.test(values.clientId!)) throw new Error("MICROSOFT_CLIENT_ID must be a UUID");
  const redirectUri = new URL(values.redirectUri!);
  const frontendUrl = new URL(values.frontendUrl!);
  if (redirectUri.username || redirectUri.password || redirectUri.hash) throw new Error("MICROSOFT_REDIRECT_URI is invalid");
  if (frontendUrl.username || frontendUrl.password || frontendUrl.search || frontendUrl.hash) throw new Error("FRONTEND_URL is invalid");
  if (nodeEnv === "production" && (redirectUri.protocol !== "https:" || frontendUrl.protocol !== "https:")) {
    throw new Error("Microsoft authentication URLs must use HTTPS in production");
  }
  return {
    tenantId: values.tenantId!, clientId: values.clientId!, clientSecret: values.clientSecret!,
    redirectUri: redirectUri.toString(), frontendUrl: frontendUrl.toString().replace(/\/$/, ""),
  };
};

export const loadConfiguration = async (options: LoadConfigurationOptions = {}): Promise<AppConfig> => {
  const environment = options.environment ?? process.env;
  const nodeEnv = parseNodeEnv(environment.NODE_ENV);
  const secretSource = parseSecretSource(environment.SECRET_SOURCE, nodeEnv);
  if (nodeEnv === "production" && secretSource !== "azure-key-vault") {
    throw new Error("Production must use Azure Key Vault; set SECRET_SOURCE=azure-key-vault");
  }
  const secrets: Record<string, string | undefined> = secretSource === "azure-key-vault"
    ? await (options.secretLoader ?? new AzureKeyVaultSecretLoader(required(environment.AZURE_KEY_VAULT_URL, "AZURE_KEY_VAULT_URL")))
      .load(Object.values(KEY_VAULT_SECRET_NAMES))
    : environment;
  const value = (name: keyof typeof KEY_VAULT_SECRET_NAMES) => secretSource === "azure-key-vault"
    ? secrets[KEY_VAULT_SECRET_NAMES[name]]
    : secrets[name];

  const directUrl = value("DIRECT_URL");
  const supabaseSecretKey = value("SUPABASE_SECRET_KEY");
  const helpdeskPeerApiKey = value("HELPDESK_PEER_API_KEY");
  const educoreApiKey = value("EDUCORE_API_KEY");
  if (secretSource === "azure-key-vault") {
    required(directUrl, "DIRECT_URL");
    required(supabaseSecretKey, "SUPABASE_SECRET_KEY");
  }
  return {
    nodeEnv,
    port: parsePort(environment.PORT),
    secretSource,
    databaseUrl: required(value("DATABASE_URL"), "DATABASE_URL"),
    directUrl,
    jwtSecret: requireJwtSecret(value("JWT_SECRET")),
    microsoft: createMicrosoftConfig(environment, value("MICROSOFT_CLIENT_SECRET"), nodeEnv),
    supabase: {
      url: required(environment.SUPABASE_URL, "SUPABASE_URL"),
      secretKey: required(supabaseSecretKey, "SUPABASE_SECRET_KEY"),
      storageBucket: environment.SUPABASE_STORAGE_BUCKET || "ticket-attachments",
    },
    educore: createEduCoreConfig(environment, helpdeskPeerApiKey, educoreApiKey, nodeEnv),
  };
};
