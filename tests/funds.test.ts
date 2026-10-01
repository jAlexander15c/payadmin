import { test } from "node:test";
import assert from "node:assert/strict";
import { fundBalances } from "../src/lib/funds";
test("Fondos sin saldo inicial muestran movimiento neto sin inventar dinero", () => {
  const wallets = fundBalances(
    {
      cash: [
        {
          date: "2026-10-01",
          status: "active",
          kind: "EXPENSE",
          category: "WANTS",
          amount: "25.00",
        },
      ],
    },
    "2026-10-10",
  );
  assert.equal(wallets[1].configured, false);
  assert.equal(wallets[1].balance, -2500);
  assert.equal(wallets[0].configured, false);
});
test("Ajustar total se calcula sobre movimientos previos, gastos posteriores descuentan una vez", () => {
  const d = {
    cash: [
      {
        date: "2026-10-01",
        status: "active",
        kind: "EXPENSE",
        category: "NEEDS",
        amount: "30.00",
      },
      {
        date: "2026-10-02",
        status: "active",
        kind: "EXPENSE",
        category: "NEEDS",
        amount: "20.00",
      },
    ],
    fundAdjustments: [
      {
        date: "2026-10-01",
        bucket: "NEEDS",
        operation: "SET",
        amount: "100.00",
        delta: "130.00",
      },
      {
        date: "2026-10-03",
        bucket: "NEEDS",
        operation: "ADD",
        amount: "15.00",
        delta: "15.00",
      },
      {
        date: "2026-10-03",
        bucket: "NEEDS",
        operation: "REMOVE",
        amount: "5.00",
        delta: "-5.00",
      },
    ],
  };
  assert.equal(fundBalances(d, "2026-10-01")[0].balance, 10000);
  assert.equal(fundBalances(d, "2026-10-03")[0].balance, 9000);
  d.cash[1].status = "void";
  assert.equal(fundBalances(d, "2026-10-03")[0].balance, 11000);
});
test("Ahorro utiliza registros existentes y conserva importes al pasar de mes", () => {
  const d = {
    cash: [
      {
        date: "2026-09-01",
        status: "active",
        kind: "SAVINGS_OPENING",
        amount: "100.00",
      },
      { date: "2026-10-01", status: "active", kind: "SAVING", amount: "20.00" },
      {
        date: "2026-10-02",
        status: "active",
        kind: "EXPENSE",
        funding: "SAVINGS",
        category: "WANTS",
        amount: "30.00",
      },
    ],
    fundAdjustments: [
      {
        date: "2026-10-03",
        bucket: "SAVINGS",
        operation: "ADD",
        amount: "10.00",
        delta: "10.00",
      },
      {
        date: "2026-10-04",
        bucket: "SAVINGS",
        operation: "REMOVE",
        amount: "5.00",
        delta: "-5.00",
      },
    ],
  };
  const b = fundBalances(d, "2026-10-31");
  assert.equal(b[2].balance, 9500);
  assert.equal(b[2].configured, true);
  assert.equal(b[1].balance, 0);
  assert.deepEqual(b, fundBalances(d, "2026-11-01"));
});
