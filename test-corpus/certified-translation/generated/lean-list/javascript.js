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

function length(ml_arg0) {
  switch (ml_arg0.$) {
    case "nil": {
      return 0n;
    }
    case "cons": {
      const ml_f1 = ml_arg0["field0"];
      const rest = ml_arg0["field1"];
      return (1n + length(rest));
    }
    default: {
      throw new TypeError(`unexpected constructor ${ml_arg0.$}`);
    }
  }
}

function total(ml_arg0) {
  switch (ml_arg0.$) {
    case "nil": {
      return 0n;
    }
    case "cons": {
      const head = ml_arg0["field0"];
      const rest = ml_arg0["field1"];
      return (head + total(rest));
    }
    default: {
      throw new TypeError(`unexpected constructor ${ml_arg0.$}`);
    }
  }
}

function append(left, right) {
  switch (left.$) {
    case "nil": {
      return right;
    }
    case "cons": {
      const head = left["field0"];
      const rest = left["field1"];
      return Object.freeze({ $: "cons", ["field0"]: head, ["field1"]: append(rest, right) });
    }
    default: {
      throw new TypeError(`unexpected constructor ${left.$}`);
    }
  }
}

function classify(n) {
  if ((n === 0n)) {
    return "empty";
  } else {
    if ((n < 3n)) {
      return "short";
    } else {
      return "long";
    }
  }
}

function add_zero_right(n) {
  return ((n + 0n) === n);
}

function ml_checkTheorems() {
  if (!(ml_product([ml_nat]).every((args) => add_zero_right(...args)))) throw new Error('theorem add_zero_right fails on a bounded input');
  console.log('theorem add_zero_right: holds on the bounded domain');
}

function main() {
  console.log(String(length(append(Object.freeze({ $: "cons", ["field0"]: 1n, ["field1"]: Object.freeze({ $: "cons", ["field0"]: 2n, ["field1"]: Object.freeze({ $: "nil" }) }) }), Object.freeze({ $: "cons", ["field0"]: 3n, ["field1"]: Object.freeze({ $: "nil" }) })))));
  console.log(String(total(Object.freeze({ $: "cons", ["field0"]: 10n, ["field1"]: Object.freeze({ $: "cons", ["field0"]: 20n, ["field1"]: Object.freeze({ $: "cons", ["field0"]: 12n, ["field1"]: Object.freeze({ $: "nil" }) }) }) }))));
  console.log(classify(length(Object.freeze({ $: "nil" }))));
  console.log(classify(length(Object.freeze({ $: "cons", ["field0"]: 4n, ["field1"]: Object.freeze({ $: "cons", ["field0"]: 5n, ["field1"]: Object.freeze({ $: "cons", ["field0"]: 6n, ["field1"]: Object.freeze({ $: "nil" }) }) }) }))));
}

if (process.argv.includes('--ml-check-theorems')) ml_checkTheorems();
else main();
