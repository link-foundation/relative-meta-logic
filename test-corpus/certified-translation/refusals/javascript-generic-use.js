// One untyped function used at two types needs polymorphism the admitted core does not have.
function ident(x) { return x; }
console.log(ident(3));
console.log(ident('three'));
