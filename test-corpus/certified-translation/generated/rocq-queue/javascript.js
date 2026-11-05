// Translated from Rocq by meta-language: portable core, JavaScript target.
'use strict';

function ml_forall(values, property) {
  return values.every(property);
}

// Bounded domains for executable theorem checks.
const ml_nat = [0n, 1n, 2n, 3n, 4n, 5n, 6n];
const ml_int = [-4n, -3n, -2n, -1n, 0n, 1n, 2n, 3n, 4n];
const ml_small_nat = [0n, 1n, 2n];
const ml_small_int = [-1n, 0n, 1n];
function ml_product(lists) {
  return lists.reduce((rows, list) => rows.flatMap((row) => list.map((value) => [...row, value])), [[]]);
}

function weight(p) {
  switch (p.$) {
    case "Low": {
      return 1n;
    }
    case "High": {
      return 10n;
    }
    default: {
      throw new TypeError(`unexpected constructor ${p.$}`);
    }
  }
}

function score(q) {
  switch (q.$) {
    case "Empty": {
      return 0n;
    }
    case "Push": {
      const p = q["field0"];
      const n = q["field1"];
      const rest = q["field2"];
      return ((weight(p) * n) + score(rest));
    }
    default: {
      throw new TypeError(`unexpected constructor ${q.$}`);
    }
  }
}

function urgent(q) {
  switch (q.$) {
    case "Empty": {
      return 0n;
    }
    case "Push": {
      const ml_f1 = q["field0"];
      const ml_f2 = q["field1"];
      const rest = q["field2"];
      switch (ml_f1.$) {
        case "Low": {
          return urgent(rest);
        }
        case "High": {
          return (1n + urgent(rest));
        }
        default: {
          throw new TypeError(`unexpected constructor ${ml_f1.$}`);
        }
      }
    }
    default: {
      throw new TypeError(`unexpected constructor ${q.$}`);
    }
  }
}

function label(n) {
  if ((n < 50n)) {
    return "calm";
  } else {
    return "busy";
  }
}

function score_empty_plus(n) {
  return ((score(Object.freeze({ $: "Empty" })) + n) === n);
}

function ml_checkTheorems() {
  if (!(ml_product([ml_nat]).every((args) => score_empty_plus(...args)))) throw new Error('theorem score_empty_plus fails on a bounded input');
  console.log('theorem score_empty_plus: holds on the bounded domain');
}

function main() {
  console.log(String(score(Object.freeze({ $: "Push", ["field0"]: Object.freeze({ $: "High" }), ["field1"]: 3n, ["field2"]: Object.freeze({ $: "Push", ["field0"]: Object.freeze({ $: "Low" }), ["field1"]: 7n, ["field2"]: Object.freeze({ $: "Empty" }) }) }))));
  console.log(String(urgent(Object.freeze({ $: "Push", ["field0"]: Object.freeze({ $: "High" }), ["field1"]: 3n, ["field2"]: Object.freeze({ $: "Push", ["field0"]: Object.freeze({ $: "Low" }), ["field1"]: 7n, ["field2"]: Object.freeze({ $: "Push", ["field0"]: Object.freeze({ $: "High" }), ["field1"]: 1n, ["field2"]: Object.freeze({ $: "Empty" }) }) }) }))));
  console.log(label(score(Object.freeze({ $: "Push", ["field0"]: Object.freeze({ $: "High" }), ["field1"]: 3n, ["field2"]: Object.freeze({ $: "Push", ["field0"]: Object.freeze({ $: "Low" }), ["field1"]: 7n, ["field2"]: Object.freeze({ $: "Empty" }) }) }))));
  console.log(label(score(Object.freeze({ $: "Push", ["field0"]: Object.freeze({ $: "Low" }), ["field1"]: 2n, ["field2"]: Object.freeze({ $: "Empty" }) }))));
}

if (process.argv.includes('--ml-check-theorems')) ml_checkTheorems();
else main();
