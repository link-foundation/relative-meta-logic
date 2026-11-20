// Classes carry prototype identity and mutation; they are refused rather than flattened.
class Counter {
  constructor() { this.value = 0; }
  increment() { this.value += 1; return this.value; }
}

const counter = new Counter();
console.log(counter.increment());
