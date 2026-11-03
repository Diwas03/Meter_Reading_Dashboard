import type { Admin } from "../_shared/admin.ts";
import {
  hashToken,
  InputError,
  limitedJson,
  validateBatch,
} from "../_shared/validation.ts";
import { failure, json } from "../_shared/http.ts";
export function handler(admin: Admin) {
  return async (req: Request) => {
    if (req.method !== "POST")
      return json({ ok: false, error: "POST required" }, 405);
    try {
      const token = req.headers
        .get("authorization")
        ?.match(/^Bearer (mg_[0-9a-f]{64})$/)?.[1];
      if (!token) throw new InputError("Invalid device credentials", 401);
      const batch = validateBatch(await limitedJson(req));
      const { data, error } = await admin.rpc("ingest_samples", {
        p_device: batch.device_id,
        p_hash: await hashToken(token),
        p_samples: batch.samples,
      });
      if (error) {
        if (error.message.includes("UNAUTHORIZED"))
          throw new InputError("Invalid or revoked device credentials", 401);
        if (error.message.includes("UNREGISTERED_METER"))
          throw new InputError("Meter is not registered to this gateway", 403);
        if (error.message.includes("RATE_LIMIT"))
          return json({ ok: false, error: "Rate limit", retry_after: 10 }, 429);
        throw error;
      }
      return json({ ok: true, ...(data as Record<string, unknown>) });
    } catch (error) {
      return failure(error);
    }
  };
}
