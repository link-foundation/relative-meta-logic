// Translated from Lean by meta-language: portable core, JavaScript target.
'use strict';

function ml_natSub(a, b) {
  return a > b ? a - b : 0n;
}

function count_Nat(ml_arg0) {
  switch (ml_arg0.$) {
    case "done": {
      return 0n;
    }
    case "more": {
      const ml_f5 = ml_arg0["field0"];
      const ml_f6 = ml_arg0["field1"];
      const rest = ml_arg0["field2"];
      return (1n + count_Nat(rest));
    }
    default: {
      throw new TypeError(`unexpected constructor ${ml_arg0.$}`);
    }
  }
}

function count_String(ml_arg0) {
  switch (ml_arg0.$) {
    case "done": {
      return 0n;
    }
    case "more": {
      const ml_f7 = ml_arg0["field0"];
      const ml_f8 = ml_arg0["field1"];
      const rest = ml_arg0["field2"];
      return (1n + count_String(rest));
    }
    default: {
      throw new TypeError(`unexpected constructor ${ml_arg0.$}`);
    }
  }
}

function norm(p) {
  return (Point.x(p) + Point.y(p));
}

function span(s) {
  return ml_natSub(Point.x(Segment.stop(s)), Point.x(Segment.start(s)));
}

const Point = {
  x(ml_arg0) {
    switch (ml_arg0.$) {
      case "mk": {
        const ml_field = ml_arg0["field0"];
        const ml_f1 = ml_arg0["field1"];
        return ml_field;
      }
      default: {
        throw new TypeError(`unexpected constructor ${ml_arg0.$}`);
      }
    }
  },
  y(ml_arg0) {
    switch (ml_arg0.$) {
      case "mk": {
        const ml_f2 = ml_arg0["field0"];
        const ml_field = ml_arg0["field1"];
        return ml_field;
      }
      default: {
        throw new TypeError(`unexpected constructor ${ml_arg0.$}`);
      }
    }
  },
};

const Segment = {
  start(ml_arg0) {
    switch (ml_arg0.$) {
      case "mk": {
        const ml_field = ml_arg0["field0"];
        const ml_f3 = ml_arg0["field1"];
        return ml_field;
      }
      default: {
        throw new TypeError(`unexpected constructor ${ml_arg0.$}`);
      }
    }
  },
  stop(ml_arg0) {
    switch (ml_arg0.$) {
      case "mk": {
        const ml_f4 = ml_arg0["field0"];
        const ml_field = ml_arg0["field1"];
        return ml_field;
      }
      default: {
        throw new TypeError(`unexpected constructor ${ml_arg0.$}`);
      }
    }
  },
};

function main() {
  console.log(String(norm(Object.freeze({ $: "mk", ["field0"]: 3n, ["field1"]: 4n }))));
  console.log(String(span(Object.freeze({ $: "mk", ["field0"]: Object.freeze({ $: "mk", ["field0"]: 1n, ["field1"]: 0n }), ["field1"]: Object.freeze({ $: "mk", ["field0"]: 6n, ["field1"]: 9n }) }))));
  console.log(String(Point.y(Object.freeze({ $: "mk", ["field0"]: 2n, ["field1"]: 5n }))));
  console.log(String(count_Nat(Object.freeze({ $: "more", ["field0"]: 1n, ["field1"]: 2n, ["field2"]: Object.freeze({ $: "done" }) }))));
  console.log(String(count_String(Object.freeze({ $: "done" }))));
}

main();
