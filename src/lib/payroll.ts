import { z } from "zod";
import { date, period } from "./validation";
import {
  cents,
  money,
  split,
  paramsAt,
  dueDate,
  addMonths,
  type Parameters,
} from "./finance";
const amount = z.string().regex(/^\d{1,8}(\.\d{1,2})?$/);
export const distributionInput = z
  .object({ NEEDS: amount, WANTS: amount, SAVINGS: amount })
  .strict();
export const payrollInput = z
  .object({
    requestKey: z.uuid(),
    date,
    period,
    half: z.enum(["1", "2"]),
    received: amount,
    deduction: amount,
    nextDue: date,
    allocation: distributionInput,
  })
  .strict()
  .refine(
    (v) => cents(v.received) > 0,
    "El salario recibido debe ser mayor que cero.",
  )
  .refine(
    (v) => v.date.slice(0, 7) === v.period,
    "La quincena debe pertenecer al mes del ingreso.",
  )
  .refine(
    (v) => v.nextDue >= v.date,
    "El próximo vencimiento no puede ser anterior al ingreso.",
  )
  .refine(
    (v) =>
      Object.values(v.allocation).reduce((s, n) => s + cents(n), 0) ===
      cents(v.received),
    "El reparto debe sumar exactamente el salario recibido.",
  );
export const payrollReceiptInput = z
  .object({
    requestKey: z.uuid(),
    payrollId: z.uuid(),
    date,
    amount,
    allocation: distributionInput,
  })
  .strict()
  .refine((v) => cents(v.amount) > 0, "El cobro debe ser mayor que cero.")
  .refine(
    (v) =>
      Object.values(v.allocation).reduce((s, n) => s + cents(n), 0) ===
      cents(v.amount),
    "El reparto debe sumar exactamente el cobro recibido.",
  );
export const payrollVoidInput = z
  .object({ reason: z.string().trim().min(5).max(500) })
  .strict();
export function suggestedAllocation(received: number) {
  const [a, b, c] = split(received, [50, 30, 20]);
  return { NEEDS: money(a), WANTS: money(b), SAVINGS: money(c) };
}
export function payrollExpected(
  versions: Parameters[],
  period: string,
  half: "1" | "2",
) {
  const p = paramsAt(versions, period),
    i = half === "1" ? 0 : 1,
    salary = split(p.salary, [1, 1])[i],
    deduction = split(p.regular, [1, 1])[i],
    received = p.salaryIncludesLoan ? salary : Math.max(0, salary - deduction);
  return {
    salary,
    deduction,
    received,
    chunky: split(p.chunky, [1, 1])[i],
    allocation: suggestedAllocation(received),
  };
}
export function suggestedNextDue(
  versions: Parameters[],
  day: string,
  cycles: Record<string, any>[],
) {
  const last = cycles.find((c) => c.status === "active");
  if (last && last.next_due >= day) return last.next_due;
  // The owner specified the next monthly due date as 16 November 2026.
  const anchor =
    last?.next_due ||
    paramsAt(versions, day.slice(0, 7)).nextDue ||
    "2026-11-16";
  return anchor >= day
    ? anchor
    : dueDate(anchor, addMonths(day.slice(0, 7), 1));
}
