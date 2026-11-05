// Translated from Rust by meta-language: portable core, JavaScript target.
'use strict';

function ml_fixed(value, min, max, message) {
  if (value < min || value > max) throw new RangeError(message);
  return value;
}

function ml_assert(holds, statement) {
  if (!holds) throw new Error(`assertion failed: ${statement}`);
}

function rml_point_x(rml_value) {
  switch (rml_value.$) {
    case "Point": {
      const rml_field = rml_value["field0"];
      const ml_f1 = rml_value["field1"];
      return rml_field;
    }
    default: {
      throw new TypeError(`unexpected constructor ${rml_value.$}`);
    }
  }
}

function rml_point_y(rml_value) {
  switch (rml_value.$) {
    case "Point": {
      const ml_f2 = rml_value["field0"];
      const rml_field = rml_value["field1"];
      return rml_field;
    }
    default: {
      throw new TypeError(`unexpected constructor ${rml_value.$}`);
    }
  }
}

function rml_pair_0(rml_value) {
  switch (rml_value.$) {
    case "Pair": {
      const rml_field = rml_value["field0"];
      const ml_f3 = rml_value["field1"];
      return rml_field;
    }
    default: {
      throw new TypeError(`unexpected constructor ${rml_value.$}`);
    }
  }
}

function manhattan(point) {
  return ml_fixed((rml_point_x(point) + rml_point_y(point)), -9223372036854775808n, 9223372036854775807n, "attempt to add with overflow");
}

function swap(pair) {
  switch (pair.$) {
    case "Pair": {
      const first = pair["field0"];
      const second = pair["field1"];
      return Object.freeze({ $: "Pair", ["field0"]: second, ["field1"]: first });
    }
    default: {
      throw new TypeError(`unexpected constructor ${pair.$}`);
    }
  }
}

function area(shape) {
  switch (shape.$) {
    case "Circle": {
      const radius = shape["field0"];
      return ml_fixed((ml_fixed((3n * radius), -9223372036854775808n, 9223372036854775807n, "attempt to multiply with overflow") * radius), -9223372036854775808n, 9223372036854775807n, "attempt to multiply with overflow");
    }
    case "Rect": {
      const ml_f4 = shape["field0"];
      const width = shape["field1"];
      const height = shape["field2"];
      return ml_fixed((width * height), -9223372036854775808n, 9223372036854775807n, "attempt to multiply with overflow");
    }
    default: {
      throw new TypeError(`unexpected constructor ${shape.$}`);
    }
  }
}

function corner_sum(shape) {
  switch (shape.$) {
    case "Circle": {
      const ml_f5 = shape["field0"];
      return 0n;
    }
    case "Rect": {
      const ml_f6 = shape["field0"];
      const ml_f7 = shape["field1"];
      const ml_f8 = shape["field2"];
      switch (ml_f6.$) {
        case "Point": {
          const x = ml_f6["field0"];
          const y = ml_f6["field1"];
          return ml_fixed((x + y), -9223372036854775808n, 9223372036854775807n, "attempt to add with overflow");
        }
        default: {
          throw new TypeError(`unexpected constructor ${ml_f6.$}`);
        }
      }
    }
    default: {
      throw new TypeError(`unexpected constructor ${shape.$}`);
    }
  }
}

function main() {
  const corner = Object.freeze({ $: "Point", ["field0"]: 3n, ["field1"]: 4n });
  console.log(String(manhattan(corner)));
  const x = rml_point_x(corner);
  console.log(String(x));
  const pair = swap(Object.freeze({ $: "Pair", ["field0"]: 1n, ["field1"]: 2n }));
  console.log(String(rml_pair_0(pair)));
  console.log(String(area(Object.freeze({ $: "Rect", ["field0"]: Object.freeze({ $: "Point", ["field0"]: 1n, ["field1"]: 2n }), ["field1"]: 5n, ["field2"]: 6n }))));
  console.log(String(area(Object.freeze({ $: "Circle", ["field0"]: 2n }))));
  console.log(String(corner_sum(Object.freeze({ $: "Rect", ["field0"]: corner, ["field1"]: 1n, ["field2"]: 1n }))));
  ml_assert((manhattan(Object.freeze({ $: "Point", ["field0"]: (-2n), ["field1"]: 2n })) === 0n), "assertion 1");
}

main();
