const parsePort = (value: string | undefined): number => {
  if (value === undefined) return 5050;

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  return port;
};

const parseNodeEnv = (value: string | undefined): "development" | "test" | "production" => {
  if (value === undefined) return "development";
  if (value === "development" || value === "test" || value === "production") return value;
  throw new Error("NODE_ENV must be development, test, or production");
};

const requireSecret = (value: string | undefined, name: string): string => {
  if (!value || value.length < 32) {
    throw new Error(`${name} must be at least 32 characters`);
  }
  return value;
};

const optionalMicrosoftConfig = (nodeEnv: "development" | "test" | "production") => {
  const values = {
    tenantId: process.env.MICROSOFT_TENANT_ID,
    clientId: process.env.MICROSOFT_CLIENT_ID,
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
    redirectUri: process.env.MICROSOFT_REDIRECT_URI,
    frontendUrl: process.env.FRONTEND_URL,
  };
  const configured = Object.values(values).some(Boolean);
  if (!configured && nodeEnv !== "production") return null;
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
    tenantId: values.tenantId!,
    clientId: values.clientId!,
    clientSecret: values.clientSecret!,
    redirectUri: redirectUri.toString(),
    frontendUrl: frontendUrl.toString().replace(/\/$/, ""),
  };
};

const nodeEnv = parseNodeEnv(process.env.NODE_ENV);

export const env = {
  nodeEnv,
  port: parsePort(process.env.PORT),
  jwtSecret: requireSecret(process.env.JWT_SECRET, "JWT_SECRET"),
  microsoft: optionalMicrosoftConfig(nodeEnv),
} as const;
