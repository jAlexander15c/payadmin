import { z } from "zod";
const amount = z
  .string()
  .regex(
    /^\d{1,8}(\.\d{1,2})?$/,
    "Usa un importe positivo con hasta dos decimales.",
  );
const positive = amount.refine(
  (s) => Number(s) > 0,
  "El importe debe ser mayor que cero.",
);
const optionalAmount = z
  .union([amount, z.literal(""), z.null()])
  .transform((v) => (v === "" ? null : v));
export const period = z
  .string()
  .regex(/^20\d{2}-(0[1-9]|1[0-2])$/, "Período inválido.");
export const date = z
  .string()
  .regex(/^20\d{2}-(0[1-9]|1[0-2])-\d{2}$/)
  .refine(
    (s) =>
      !Number.isNaN(Date.parse(s)) &&
      new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s,
    "Fecha inválida.",
  );
export const bankInput = z
  .object({
    requestKey: z.uuid(),
    date,
    period,
    type: z.enum([
      "REGULAR",
      "CREDI",
      "EXTRA_CREDI",
      "EXTRA_CHUNKY",
      "EXTRA_CARDS",
      "EXTRA_COSTS",
      "NO_PAYMENT",
    ]),
    amount,
    notes: z.string().max(2000).default(""),
    links: z
      .array(z.object({ id: z.uuid(), amount: positive }))
      .max(20)
      .default([]),
  })
  .strict();
export const contributionInput = z
  .object({
    requestKey: z.uuid(),
    date,
    period,
    source: z.enum(["chunky", "credi", "cards", "costs"]),
    contributor: z.string().trim().min(1).max(100),
    amount: positive,
    notes: z.string().max(2000).default(""),
  })
  .strict();
export const cashInput = z
  .object({
    requestKey: z.uuid(),
    date,
    period,
    kind: z.enum(["PAYROLL", "INCOME", "EXPENSE", "SAVING", "SAVINGS_OPENING"]),
    category: z.enum(["NEEDS", "WANTS", "DEBT", "SAVINGS", "OTHER"]),
    amount: positive,
    concept: z.string().trim().min(1).max(200),
    funding: z.enum(["CASH", "SAVINGS"]).default("CASH"),
    fixedExpenseId: z.uuid().nullable().default(null),
  })
  .strict()
  .refine(
    (v) => v.funding === "CASH" || v.kind === "EXPENSE",
    "Solo un gasto puede pagarse desde ahorro.",
  )
  .refine(
    (v) =>
      !v.fixedExpenseId || (v.kind === "EXPENSE" && v.category === "NEEDS"),
    "Un pago fijo pertenece a Necesidades.",
  )
  .refine(
    (v) =>
      !["SAVING", "SAVINGS_OPENING"].includes(v.kind) ||
      v.category === "SAVINGS",
    "Los movimientos de ahorro requieren la categoría Ahorro.",
  );
export const fixedExpenseInput = z
  .object({
    requestKey: z.uuid(),
    id: z.uuid().optional(),
    revision: z.number().int().positive().optional(),
    effectivePeriod: period,
    name: z.string().trim().min(1).max(200),
    amount: positive,
    dueDay: z.number().int().min(1).max(31),
    active: z.boolean().default(true),
  })
  .strict()
  .refine(
    (v) => !v.id || v.revision !== undefined,
    "Actualiza la configuración antes de editar.",
  );
export const fundAdjustmentInput = z
  .object({
    requestKey: z.uuid(),
    bucket: z.enum(["NEEDS", "WANTS", "SAVINGS"]),
    operation: z.enum(["SET", "ADD", "REMOVE"]),
    effect: z
      .enum(["ALLOCATION", "INCOME", "EXPENSE", "ADJUSTMENT"])
      .optional(),
    amount,
    expectedBalance: z
      .number()
      .int()
      .min(-Number.MAX_SAFE_INTEGER)
      .max(Number.MAX_SAFE_INTEGER),
    reason: z.string().trim().max(500).default(""),
  })
  .strict()
  .refine(
    (v) => v.operation === "SET" || Number(v.amount) > 0,
    "El importe debe ser mayor que cero.",
  )
  .transform((v) => {
    const effect =
      v.effect ??
      (v.operation === "ADD"
        ? "ALLOCATION"
        : v.operation === "REMOVE"
          ? "EXPENSE"
          : "ADJUSTMENT");
    return {
      ...v,
      effect,
      reason:
        v.reason ||
        (v.operation === "SET"
          ? "Saldo actual"
          : effect === "INCOME"
            ? "Ingreso extra"
            : effect === "ALLOCATION"
              ? "Dinero ya disponible"
              : effect === "EXPENSE"
                ? "Salida de dinero"
                : "Ajuste de saldo"),
    };
  })
  .refine(
    (v) =>
      v.operation === "SET"
        ? v.effect === "ADJUSTMENT"
        : v.operation === "ADD"
          ? ["ALLOCATION", "INCOME"].includes(v.effect)
          : ["EXPENSE", "ADJUSTMENT"].includes(v.effect),
    "El tipo de movimiento no corresponde a la operación.",
  );
export const statementInput = z
  .object({
    period,
    interest: optionalAmount,
    feci: optionalAmount,
    other: optionalAmount,
    concept: z.string().max(200).default(""),
    principal: optionalAmount,
    balance: optionalAmount,
    notes: z.string().max(2000).default(""),
    reason: z.string().trim().min(5).max(500),
  })
  .strict()
  .refine(
    (v) => !v.other || Number(v.other) === 0 || v.concept.trim().length > 0,
    "Los otros cargos requieren un concepto explícito.",
  );
export const paramsInput = z
  .object({
    effectivePeriod: period,
    interest: z.string().regex(/^0(\.\d{1,8})?$/),
    feci: z.string().regex(/^0(\.\d{1,8})?$/),
    regular: positive,
    chunky: amount,
    credi: positive,
    firstDue: date,
    provisional: z.boolean(),
    salary: positive,
    salaryIncludesLoan: z.boolean(),
    reason: z.string().trim().min(5).max(500),
  })
  .strict()
  .refine(
    (v) => Number(v.chunky) <= Number(v.regular),
    "La cuota Chunky no puede superar la cuota regular.",
  );
export const responsibilityInput = z
  .object({
    effectivePeriod: period,
    participants: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(100),
          percent: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/),
        }),
      )
      .min(1)
      .max(10),
    reason: z.string().trim().min(5).max(500),
  })
  .strict()
  .refine(
    (v) => v.participants.reduce((s, p) => s + Number(p.percent), 0) <= 100,
    "La suma de responsabilidades no puede superar 100%.",
  );
export const correctionInput = z
  .object({
    revision: z.number().int().positive(),
    reason: z.string().trim().min(5).max(500),
    action: z.enum(["correct", "void"]),
    data: z.unknown().optional(),
  })
  .strict();
export const simulationInput = z
  .object({
    period,
    source: z.enum(["chunky", "credi", "cards", "costs"]),
    amount: positive,
  })
  .strict();
export const firstDateInput = z
  .object({ date, reason: z.string().trim().min(5).max(500) })
  .strict();
export const cashCompensationInput = z
  .object({
    requestKey: z.uuid(),
    receiptId: z.uuid(),
    amount: positive,
    reason: z.string().trim().min(5).max(500),
  })
  .strict();
export const cashCompensationCorrectionInput = z
  .object({
    revision: z.number().int().positive(),
    action: z.enum(["correct", "void"]),
    amount: positive.optional(),
    reason: z.string().trim().min(5).max(500),
  })
  .strict()
  .refine(
    (v) => v.action === "void" || !!v.amount,
    "La corrección requiere un importe.",
  );
