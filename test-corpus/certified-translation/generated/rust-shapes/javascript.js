// Translated from Rust by meta-language: portable core, JavaScript target.
'use strict';

function ml_fixed(value, min, max, message) {
  if (value < min || value > max) throw new RangeError(message);
  return value;
}

function ml_assert(holds, statement) {
  if (!holds) throw new Error(`assertion failed: ${statement}`);
}

function describe(total) {
  ml_fixed(total, 0n, 18446744073709551615n, "u64 argument total out of range");
  if ((total > 100n)) {
    return "large";
  } else {
    return "small";
  }
}

const geometry = {
  area(shape) {
    switch (shape.$) {
      case "Square": {
        const side = shape["field0"];
        return ml_fixed((side * side), 0n, 18446744073709551615n, "attempt to multiply with overflow");
      }
      case "Rect": {
        const width = shape["field0"];
        const height = shape["field1"];
        return ml_fixed((width * height), 0n, 18446744073709551615n, "attempt to multiply with overflow");
      }
      case "Group": {
        const first = shape["field0"];
        const second = shape["field1"];
        return ml_fixed((geometry.area(first) + geometry.area(second)), 0n, 18446744073709551615n, "attempt to add with overflow");
      }
      default: {
        throw new TypeError(`unexpected constructor ${shape.$}`);
      }
    }
  },
  count(shape) {
    switch (shape.$) {
      case "Square": {
        const ml_f1 = shape["field0"];
        return 1n;
      }
      case "Rect": {
        const ml_f2 = shape["field0"];
        const ml_f3 = shape["field1"];
        return 1n;
      }
      case "Group": {
        const first = shape["field0"];
        const second = shape["field1"];
        return ml_fixed((geometry.count(first) + geometry.count(second)), 0n, 18446744073709551615n, "attempt to add with overflow");
      }
      default: {
        throw new TypeError(`unexpected constructor ${shape.$}`);
      }
    }
  },
};

function main() {
  const first = Object.freeze({ $: "Group", ["field0"]: Object.freeze({ $: "Square", ["field0"]: 3n }), ["field1"]: Object.freeze({ $: "Rect", ["field0"]: 4n, ["field1"]: 5n }) });
  console.log(String(geometry.area(first)));
  console.log(String(geometry.count(Object.freeze({ $: "Group", ["field0"]: Object.freeze({ $: "Square", ["field0"]: 1n }), ["field1"]: Object.freeze({ $: "Group", ["field0"]: Object.freeze({ $: "Square", ["field0"]: 2n }), ["field1"]: Object.freeze({ $: "Rect", ["field0"]: 2n, ["field1"]: 3n }) }) }))));
  console.log(describe(geometry.area(Object.freeze({ $: "Rect", ["field0"]: 20n, ["field1"]: 6n }))));
  ml_assert((geometry.area(Object.freeze({ $: "Square", ["field0"]: 4n })) === 16n), "assertion 1");
}

main();
