import { HttpError } from "../../errors/http-error.js";
import { parseEduCoreContext, type EduCoreRegistrationContext } from "../../validation/peer.validation.js";

export interface EduCoreClient {
  getRegistrationContext(externalEventId: string): Promise<EduCoreRegistrationContext>;
}

export type EduCoreClientConfig = {
  baseUrl: string;
  apiKey: string;
  contextPathTemplate: string;
  timeoutMs: number;
};

export class HttpEduCoreClient implements EduCoreClient {
  constructor(
    private readonly config: EduCoreClientConfig,
    private readonly request: typeof fetch = fetch,
  ) {}

  async getRegistrationContext(externalEventId: string): Promise<EduCoreRegistrationContext> {
    const path = this.config.contextPathTemplate.replace("{eventId}", encodeURIComponent(externalEventId));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    let response: Response;
    try {
      response = await this.request(new URL(path, `${this.config.baseUrl}/`), {
        method: "GET",
        headers: { accept: "application/json", "x-api-key": this.config.apiKey },
        signal: controller.signal,
      });
    } catch {
      throw new HttpError(503, "EDUCORE_UNAVAILABLE", "EduCore is temporarily unavailable");
    } finally {
      clearTimeout(timeout);
    }
    if (response.status === 401 || response.status === 403) {
      throw new HttpError(502, "EDUCORE_AUTH_FAILED", "EduCore rejected HelpDesk authentication");
    }
    if (response.status === 404) throw new HttpError(404, "EDUCORE_CONTEXT_NOT_FOUND", "Registration context was not found");
    if (response.status >= 500) throw new HttpError(503, "EDUCORE_UNAVAILABLE", "EduCore is temporarily unavailable");
    if (!response.ok) throw new HttpError(502, "EDUCORE_INVALID_RESPONSE", "EduCore returned an unexpected response");
    try {
      return parseEduCoreContext(await response.json());
    } catch (error) {
      if (error instanceof HttpError && error.code !== "VALIDATION_ERROR") throw error;
      throw new HttpError(502, "EDUCORE_INVALID_RESPONSE", "EduCore returned an invalid response");
    }
  }
}
