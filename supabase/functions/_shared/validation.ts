export const fields = [
  "voltage_rn",
  "voltage_yn",
  "voltage_bn",
  "voltage_avg",
  "voltage_ry",
  "voltage_yb",
  "voltage_br",
  "current_r",
  "current_y",
  "current_b",
  "current_n",
  "pf_r",
  "pf_y",
  "pf_b",
  "pf_avg",
  "frequency",
] as const;
export type Field = (typeof fields)[number];
export type Values = Record<Field, number | null>;
export type Sample = {
  sample_id: string;
  slave_id: number;
  measured_at: string | null;
  values: Values;
  errors: Partial<Record<Field, string>>;
};
export const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class InputError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new InputError("Expected an object");
  return value as Record<string, unknown>;
}
export function validateBatch(
  input: unknown,
  now = Date.now(),
): { device_id: string; samples: Sample[] } {
  const body = object(input);
  if (typeof body.device_id !== "string" || !uuid.test(body.device_id))
    throw new InputError("Invalid device_id");
  if (
    !Array.isArray(body.samples) ||
    !body.samples.length ||
    body.samples.length > 32
  )
    throw new InputError("Send 1–32 samples");
  const seen = new Set<string>();
  const samples = body.samples.map((raw): Sample => {
    const s = object(raw);
    if (
      typeof s.sample_id !== "string" ||
      !uuid.test(s.sample_id) ||
      seen.has(s.sample_id)
    )
      throw new InputError("Invalid or repeated sample_id");
    seen.add(s.sample_id);
    if (
      !Number.isInteger(s.slave_id) ||
      Number(s.slave_id) < 1 ||
      Number(s.slave_id) > 247
    )
      throw new InputError("Invalid slave_id");
    let measured_at: string | null = null;
    if (s.measured_at !== null && s.measured_at !== undefined) {
      if (
        typeof s.measured_at !== "string" ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(s.measured_at)
      )
        throw new InputError("Timestamp must be UTC ISO8601");
      const time = Date.parse(s.measured_at);
      if (
        !Number.isFinite(time) ||
        new Date(time).toISOString().slice(0, 19) !==
          s.measured_at.slice(0, 19) ||
        time < now - 7 * 86400000 ||
        time > now + 300000
      )
        throw new InputError(
          "Timestamp outside seven-day past / five-minute future window",
        );
      measured_at = new Date(time).toISOString();
    }
    const values = object(s.values),
      errors = s.errors === undefined ? {} : object(s.errors);
    for (const key of [...Object.keys(values), ...Object.keys(errors)])
      if (!fields.includes(key as Field))
        throw new InputError("Unknown measurement");
    const result = {} as Values,
      resultErrors: Sample["errors"] = {};
    for (const key of fields) {
      const value = values[key];
      if (
        value !== undefined &&
        value !== null &&
        (typeof value !== "number" ||
          !Number.isFinite(value) ||
          Math.abs(value) > 1e9)
      )
        throw new InputError(`Invalid ${key}`);
      result[key] =
        value === undefined || value === null ? null : (value as number);
      if (
        errors[key] !== undefined &&
        (typeof errors[key] !== "string" ||
          (errors[key] as string).length > 120)
      )
        throw new InputError(`Invalid error for ${key}`);
      if (result[key] === null)
        resultErrors[key] = (errors[key] as string) || "unavailable";
      else if (errors[key])
        throw new InputError(`Value and error both supplied for ${key}`);
    }
    return {
      sample_id: s.sample_id,
      slave_id: Number(s.slave_id),
      measured_at,
      values: result,
      errors: resultErrors,
    };
  });
  return { device_id: body.device_id, samples };
}
export async function limitedJson(req: Request, max = 65536): Promise<unknown> {
  if (
    !req.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    throw new InputError("Use application/json", 415);
  if (Number(req.headers.get("content-length")) > max)
    throw new InputError("Payload too large", 413);
  if (!req.body) throw new InputError("Empty body");
  const reader = req.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw new InputError("Payload too large", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(all));
  } catch {
    throw new InputError("Malformed JSON");
  }
}
export async function hashToken(token: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
    ),
  ]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
