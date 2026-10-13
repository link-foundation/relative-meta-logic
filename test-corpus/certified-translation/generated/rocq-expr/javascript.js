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

function sample() {
  return Object.freeze({ $: "Plus", ["field0"]: Object.freeze({ $: "Num", ["field0"]: 2n }), ["field1"]: Object.freeze({ $: "Times", ["field0"]: Object.freeze({ $: "Num", ["field0"]: 3n }), ["field1"]: Object.freeze({ $: "Num", ["field0"]: 4n }) }) });
}

function eval_sample() {
  return (Arith.eval_(sample()) === 14n);
}

const Arith = {
  larger(a, b) {
    if ((a <= b)) {
      return b;
    } else {
      return a;
    }
  },
  eval_(e) {
    switch (e.$) {
      case "Num": {
        const n = e["field0"];
        return n;
      }
      case "Plus": {
        const a = e["field0"];
        const b = e["field1"];
        return (Arith.eval_(a) + Arith.eval_(b));
      }
      case "Times": {
        const a_2 = e["field0"];
        const b_2 = e["field1"];
        return (Arith.eval_(a_2) * Arith.eval_(b_2));
      }
      default: {
        throw new TypeError(`unexpected constructor ${e.$}`);
      }
    }
  },
  depth(e) {
    switch (e.$) {
      case "Num": {
        const ml_f1 = e["field0"];
        return 1n;
      }
      case "Plus": {
        const a = e["field0"];
        const b = e["field1"];
        return (1n + Arith.larger(Arith.depth(a), Arith.depth(b)));
      }
      case "Times": {
        const a_2 = e["field0"];
        const b_2 = e["field1"];
        return (1n + Arith.larger(Arith.depth(a_2), Arith.depth(b_2)));
      }
      default: {
        throw new TypeError(`unexpected constructor ${e.$}`);
      }
    }
  },
};

function ml_checkTheorems() {
  if (!(eval_sample())) throw new Error('theorem eval_sample fails on a bounded input');
  console.log('theorem eval_sample: holds on the bounded domain');
}

function main() {
  console.log(String(Arith.eval_(sample())));
  console.log(String(Arith.depth(sample())));
}

if (process.argv.includes('--ml-check-theorems')) ml_checkTheorems();
else main();
