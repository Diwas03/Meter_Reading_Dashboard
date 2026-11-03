import { InputError } from "./validation.ts";
export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};
export function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: cors });
}
export function failure(error: unknown) {
  return error instanceof InputError
    ? json({ ok: false, error: error.message }, error.status)
    : json(
        {
          ok: false,
          error: "Service unavailable; retry with the same sample IDs",
        },
        503,
      );
}
