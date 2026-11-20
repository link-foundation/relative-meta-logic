// Tagged-union records from JSDoc, switch-based pattern matching and recursion over a list.
/** @typedef {{ $: 'Nil' } | { $: 'Item', name: string, count: number, rest: Stock }} Stock */

/** @param {Stock} stock @returns {number} */
function total(stock) {
  switch (stock.$) {
    case 'Nil':
      return 0;
    case 'Item':
      return stock.count + total(stock.rest);
  }
}

/** @param {Stock} stock @returns {number} */
function kinds(stock) {
  if (stock.$ === 'Nil') return 0;
  return 1 + kinds(stock.rest);
}

/** @param {number} amount @returns {string} */
function status(amount) {
  if (amount === 0) return 'empty';
  return amount < 10 ? 'low' : 'stocked';
}

const shelf = { $: 'Item', name: 'bolt', count: 7, rest: { $: 'Item', name: 'nut', count: 5, rest: { $: 'Nil' } } };
console.log(total(shelf));
console.log(kinds(shelf));
console.log(status(total(shelf)));
console.log(status(total({ $: 'Nil' })));
