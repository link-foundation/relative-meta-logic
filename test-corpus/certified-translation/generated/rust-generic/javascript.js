// Translated from Rust by meta-language: portable core, JavaScript target.
'use strict';

function ml_fixed(value, min, max, message) {
  if (value < min || value > max) throw new RangeError(message);
  return value;
}

function rml_tagged_i64_tag(rml_value) {
  switch (rml_value.$) {
    case "Tagged_i64": {
      const rml_field = rml_value["field0"];
      const ml_f1 = rml_value["field1"];
      return rml_field;
    }
    default: {
      throw new TypeError(`unexpected constructor ${rml_value.$}`);
    }
  }
}

function rml_tagged_i64_value(rml_value) {
  switch (rml_value.$) {
    case "Tagged_i64": {
      const ml_f2 = rml_value["field0"];
      const rml_field = rml_value["field1"];
      return rml_field;
    }
    default: {
      throw new TypeError(`unexpected constructor ${rml_value.$}`);
    }
  }
}

function length_bool(list) {
  switch (list.$) {
    case "Nil": {
      return 0n;
    }
    case "Cons": {
      const ml_f3 = list["field0"];
      const rest = list["field1"];
      return ml_fixed((1n + length_bool(rest)), -9223372036854775808n, 9223372036854775807n, "attempt to add with overflow");
    }
    default: {
      throw new TypeError(`unexpected constructor ${list.$}`);
    }
  }
}

function sum(list) {
  switch (list.$) {
    case "Nil": {
      return 0n;
    }
    case "Cons": {
      const head = list["field0"];
      const rest = list["field1"];
      return ml_fixed((head + sum(rest)), -9223372036854775808n, 9223372036854775807n, "attempt to add with overflow");
    }
    default: {
      throw new TypeError(`unexpected constructor ${list.$}`);
    }
  }
}

function identity_i64(value) {
  ml_fixed(value, -9223372036854775808n, 9223372036854775807n, "i64 argument value out of range");
  return value;
}

function identity_String(value) {
  return value;
}

function main() {
  const numbers = Object.freeze({ $: "Cons", ["field0"]: 1n, ["field1"]: Object.freeze({ $: "Cons", ["field0"]: 2n, ["field1"]: Object.freeze({ $: "Cons", ["field0"]: 3n, ["field1"]: Object.freeze({ $: "Nil" }) }) }) });
  console.log(String(sum(numbers)));
  const flags = Object.freeze({ $: "Cons", ["field0"]: true, ["field1"]: Object.freeze({ $: "Nil" }) });
  console.log(String(length_bool(flags)));
  const tagged = Object.freeze({ $: "Tagged_i64", ["field0"]: 7n, ["field1"]: identity_i64(35n) });
  console.log(String(ml_fixed((rml_tagged_i64_tag(tagged) + rml_tagged_i64_value(tagged)), -9223372036854775808n, 9223372036854775807n, "attempt to add with overflow")));
  console.log(identity_String("generic"));
}

main();
