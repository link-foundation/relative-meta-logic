// Translated from Rocq by meta-language: portable core, JavaScript target.
'use strict';

function px(ml_record) {
  switch (ml_record.$) {
    case "mkPoint": {
      const ml_field = ml_record["field0"];
      const ml_f1 = ml_record["field1"];
      return ml_field;
    }
    default: {
      throw new TypeError(`unexpected constructor ${ml_record.$}`);
    }
  }
}

function py(ml_record) {
  switch (ml_record.$) {
    case "mkPoint": {
      const ml_f2 = ml_record["field0"];
      const ml_field = ml_record["field1"];
      return ml_field;
    }
    default: {
      throw new TypeError(`unexpected constructor ${ml_record.$}`);
    }
  }
}

function size_nat(b) {
  switch (b.$) {
    case "none_nat": {
      return 0n;
    }
    case "some_nat": {
      const ml_f3 = b["field0"];
      const rest = b["field1"];
      return (size_nat(rest) + 1n);
    }
    default: {
      throw new TypeError(`unexpected constructor ${b.$}`);
    }
  }
}

function norm(p) {
  return (px(p) + py(p));
}

function main() {
  console.log(String(norm(Object.freeze({ $: "mkPoint", ["field0"]: 3n, ["field1"]: 4n }))));
  console.log(String(py(Object.freeze({ $: "mkPoint", ["field0"]: 1n, ["field1"]: 9n }))));
  console.log(String(size_nat(Object.freeze({ $: "some_nat", ["field0"]: 1n, ["field1"]: Object.freeze({ $: "some_nat", ["field0"]: 2n, ["field1"]: Object.freeze({ $: "none_nat" }) }) }))));
}

main();
