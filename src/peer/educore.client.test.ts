import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HttpError } from "../errors/http-error.js";
import { HttpEduCoreClient } from "../services/peer-integrations/educore.client.js";

const apiKey = "outgoing-educore-api-key-at-least-32-chars";
const validContext = {
  studentId: "S123", courseCode: "ITX4181", registrationStatus: "FAILED",
  failureReason: "System error", attemptedAt: "2026-08-31T01:02:03.000Z",
  additionalContext: { attempt: 2 },
};
const config = {
  baseUrl: "https://educore.invalid",
  apiKey,
  contextPathTemplate: "/api/peer/helpdesk/registration-context/{eventId}",
  timeoutMs: 20,
};
const code = async (promise: Promise<unknown>) => {
  try { await promise; assert.fail("Expected HttpError"); } catch (error) {
    assert.ok(error instanceof HttpError);
    assert.ok(!error.message.includes(apiKey));
    return error.code;
  }
};

describe("EduCore HTTP client", () => {
  it("adds x-api-key and normalizes a successful response", async () => {
    let header: string | null = null;
    let requestedUrl = "";
    const request: typeof fetch = async (input, init) => {
      requestedUrl = String(input);
      header = new Headers(init?.headers).get("x-api-key");
      return Response.json(validContext);
    };
    const result = await new HttpEduCoreClient(config, request).getRegistrationContext("event/with spaces");
    assert.equal(header, apiKey);
    assert.match(requestedUrl, /event%2Fwith%20spaces$/);
    assert.equal(result.courseCode, "ITX4181");
  });

  it("maps timeout/network failure without leaking the API key", async () => {
    const request: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    });
    assert.equal(await code(new HttpEduCoreClient(config, request).getRegistrationContext("event")), "EDUCORE_UNAVAILABLE");
  });

  for (const [status, expected] of [[401, "EDUCORE_AUTH_FAILED"], [403, "EDUCORE_AUTH_FAILED"], [404, "EDUCORE_CONTEXT_NOT_FOUND"], [500, "EDUCORE_UNAVAILABLE"]] as const) {
    it(`maps upstream ${status}`, async () => {
      const request: typeof fetch = async () => new Response("upstream body must not escape", { status });
      assert.equal(await code(new HttpEduCoreClient(config, request).getRegistrationContext("event")), expected);
    });
  }

  it("rejects malformed successful responses", async () => {
    const request: typeof fetch = async () => Response.json({ courseCode: 42 });
    assert.equal(await code(new HttpEduCoreClient(config, request).getRegistrationContext("event")), "EDUCORE_INVALID_RESPONSE");
  });
});
