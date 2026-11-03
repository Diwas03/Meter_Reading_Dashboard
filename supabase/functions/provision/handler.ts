import type { Admin } from "../_shared/admin.ts";
import {
  hashToken,
  InputError,
  limitedJson,
  object,
  uuid,
} from "../_shared/validation.ts";
import { cors, failure, json } from "../_shared/http.ts";
export function handler(admin: Admin) {
  return async (req: Request) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if (req.method !== "POST")
      return json({ ok: false, error: "POST required" }, 405);
    try {
      const authorization = req.headers.get("authorization");
      if (!authorization?.startsWith("Bearer "))
        throw new InputError("Login required", 401);
      const {
        data: { user },
        error: authError,
      } = await admin.auth.getUser(authorization.slice(7));
      if (authError || !user)
        throw new InputError("Session expired; sign in again", 401);
      const body = object(await limitedJson(req, 4096));
      if (
        !["register", "rotate", "revoke", "add_meters"].includes(
          String(body.action),
        )
      )
        throw new InputError("Unknown action");
      if (
        body.action !== "register" &&
        (typeof body.device_id !== "string" || !uuid.test(body.device_id))
      )
        throw new InputError("Invalid device_id");
      if (
        body.action === "register" &&
        (typeof body.name !== "string" ||
          !body.name.trim() ||
          body.name.length > 80)
      )
        throw new InputError("Name must be 1–80 characters");
      const ids = body.slave_ids ?? [];
      if (
        !Array.isArray(ids) ||
        ids.length > 32 ||
        new Set(ids).size !== ids.length ||
        ids.some((n) => !Number.isInteger(n) || n < 1 || n > 247) ||
        (["register", "add_meters"].includes(String(body.action)) &&
          !ids.length)
      )
        throw new InputError("Provide 1–32 unique slave IDs (1–247)");
      const token = ["register", "rotate"].includes(String(body.action))
        ? "mg_" +
          [...crypto.getRandomValues(new Uint8Array(32))]
            .map((n) => n.toString(16).padStart(2, "0"))
            .join("")
        : null;
      const { data, error } = await admin.rpc("manage_device", {
        p_owner: user.id,
        p_action: body.action,
        p_device: body.device_id ?? null,
        p_name: body.name ?? null,
        p_slaves: ids,
        p_hash: token ? await hashToken(token) : null,
      });
      if (error) {
        if (error.message.includes("FORBIDDEN"))
          throw new InputError("Device not found", 404);
        if (error.message.includes("LIMIT"))
          throw new InputError("Device or meter limit reached", 409);
        throw error;
      }
      return json({ ok: true, device_id: data, token });
    } catch (error) {
      return failure(error);
    }
  };
}
