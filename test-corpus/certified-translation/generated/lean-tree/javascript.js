// Translated from Lean by meta-language: portable core, JavaScript target.
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

function double(n) {
  return (n + n);
}

function double_two() {
  return (double(2n) === 4n);
}

const Shapes = {
  sum(ml_arg0) {
    switch (ml_arg0.$) {
      case "leaf": {
        const value = ml_arg0["field0"];
        return value;
      }
      case "node": {
        const left = ml_arg0["field0"];
        const right = ml_arg0["field1"];
        return (Shapes.sum(left) + Shapes.sum(right));
      }
      default: {
        throw new TypeError(`unexpected constructor ${ml_arg0.$}`);
      }
    }
  },
  size(tree) {
    switch (tree.$) {
      case "leaf": {
        const ml_f1 = tree["field0"];
        return 1n;
      }
      case "node": {
        const left = tree["field0"];
        const right = tree["field1"];
        return (Shapes.size(left) + Shapes.size(right));
      }
      default: {
        throw new TypeError(`unexpected constructor ${tree.$}`);
      }
    }
  },
};

function ml_checkTheorems() {
  if (!(double_two())) throw new Error('theorem double_two fails on a bounded input');
  console.log('theorem double_two: holds on the bounded domain');
}

function main() {
  console.log(String(Shapes.sum(Object.freeze({ $: "node", ["field0"]: Object.freeze({ $: "leaf", ["field0"]: 2n }), ["field1"]: Object.freeze({ $: "node", ["field0"]: Object.freeze({ $: "leaf", ["field0"]: 3n }), ["field1"]: Object.freeze({ $: "leaf", ["field0"]: 4n }) }) }))));
  console.log(String(Shapes.size(Object.freeze({ $: "node", ["field0"]: Object.freeze({ $: "leaf", ["field0"]: 2n }), ["field1"]: Object.freeze({ $: "leaf", ["field0"]: 5n }) }))));
  console.log(String(double(21n)));
}

if (process.argv.includes('--ml-check-theorems')) ml_checkTheorems();
else main();
