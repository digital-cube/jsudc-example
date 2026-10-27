import { describe, expect, it } from "vitest";
import { detectCollision, neighbours, ORDER_GAP, orderBetween } from "../src/index.js";

describe("orderBetween", () => {
  it.each([
    // [prev, next, expected]
    [null, null, 100],
    [100, null, 200],
    [null, 100, 0],
    [null, 0, -100],
    [null, -250, -350],
    [100, 200, 150],
    [100, 300, 200],
    [100, 103, 101],
    [100, 102, 101],
    [-300, -100, -200],
    [-101, -100, -101],
    [-5, 4, -1],
  ] as const)("between %s and %s is %s", (prev, next, expected) => {
    expect(orderBetween(prev, next)).toBe(expected);
  });

  it("takes the gap", () => {
    expect(orderBetween(null, null, 10)).toBe(10);
    expect(orderBetween(40, null, 10)).toBe(50);
    expect(orderBetween(null, 40, 10)).toBe(30);
    expect(ORDER_GAP).toBe(100);
  });
});

describe("detectCollision", () => {
  it.each([
    [100, 101, true],
    [100, 100, true],
    [101, 100, true],
    [-1, 0, true],
    [100, 102, false],
    [-3, -1, false],
    [null, 101, false],
    [100, null, false],
    [null, null, false],
  ] as const)("%s / %s → %s", (prev, next, expected) => {
    expect(detectCollision(prev, next)).toBe(expected);
  });

  it("is exactly when the midpoint lands on prev", () => {
    for (let prev = -5; prev < 5; prev++) {
      for (let next = prev; next < prev + 4; next++) {
        expect(detectCollision(prev, next)).toBe(orderBetween(prev, next) === prev);
      }
    }
  });
});

describe("neighbours", () => {
  const orders = [100, 200, 300];
  it.each([
    [0, null, 100],
    [1, 100, 200],
    [3, 300, null],
    [9, 300, null],
    [-1, null, 100],
  ] as const)("slot %s sits between %s and %s", (index, prev, next) => {
    expect(neighbours(orders, index)).toEqual({ prev, next });
  });

  it("an empty scope has no neighbours", () => {
    expect(neighbours([], 0)).toEqual({ prev: null, next: null });
  });
});
