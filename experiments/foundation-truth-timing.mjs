// Prototype: foundation-defined truth combination over one unchanged theory.
// Measures S/K cost of product-probability and Goedel-fuzzy evaluation.
import { LinkedProgramRegistry } from '../js/src/rml-linked-program.mjs';

const source = `
(linked-program unary-numerals)
(linked-rewrite unary-numerals zero (from zero) (to z))
(linked-rewrite unary-numerals one (from one) (to (s z)))
(linked-rewrite unary-numerals two (from two) (to (s (s z))))
(linked-rewrite unary-numerals three (from three) (to (s (s (s z)))))
(linked-rewrite unary-numerals four (from four) (to (s (s (s (s z))))))

(linked-program unary-arithmetic (uses unary-numerals))
(linked-rewrite unary-arithmetic plus-zero (from (plus z ?n)) (to ?n))
(linked-rewrite unary-arithmetic plus-succ (from (plus (s ?m) ?n)) (to (s (plus ?m ?n))))
(linked-rewrite unary-arithmetic times-zero (from (times z ?n)) (to z))
(linked-rewrite unary-arithmetic times-succ (from (times (s ?m) ?n)) (to (plus ?n (times ?m ?n))))
(linked-rewrite unary-arithmetic minus-zero (from (minus ?m z)) (to ?m))
(linked-rewrite unary-arithmetic minus-succ (from (minus (s ?m) (s ?n))) (to (minus ?m ?n)))
(linked-rewrite unary-arithmetic min-zero-left (from (min z ?n)) (to z))
(linked-rewrite unary-arithmetic min-zero-right (from (min (s ?m) z)) (to z))
(linked-rewrite unary-arithmetic min-succ (from (min (s ?m) (s ?n))) (to (s (min ?m ?n))))
(linked-rewrite unary-arithmetic max-zero-left (from (max z ?n)) (to ?n))
(linked-rewrite unary-arithmetic max-zero-right (from (max (s ?m) z)) (to (s ?m)))
(linked-rewrite unary-arithmetic max-succ (from (max (s ?m) (s ?n))) (to (s (max ?m ?n))))

(linked-program product-probability (uses unary-arithmetic))
(linked-rewrite product-probability conjoin
  (from (conjoin (ratio ?a ?b) (ratio ?c ?d)))
  (to (ratio (times ?a ?c) (times ?b ?d))))
(linked-rewrite product-probability complement
  (from (complement (ratio ?a ?b)))
  (to (ratio (minus ?b ?a) ?b)))
(linked-rewrite product-probability disjoin
  (from (disjoin (ratio ?a ?b) (ratio ?c ?d)))
  (to (complement (conjoin (complement (ratio ?a ?b)) (complement (ratio ?c ?d))))))

(linked-program goedel-fuzzy (uses unary-arithmetic))
(linked-rewrite goedel-fuzzy conjoin
  (from (conjoin (ratio ?a ?d) (ratio ?b ?d)))
  (to (ratio (min ?a ?b) ?d)))
(linked-rewrite goedel-fuzzy disjoin
  (from (disjoin (ratio ?a ?d) (ratio ?b ?d)))
  (to (ratio (max ?a ?b) ?d)))

(linked-program weather)
(linked-rewrite weather wet-grass
  (from (value-of wet-grass))
  (to (disjoin (value-of rain) (value-of sprinkler))))
(linked-rewrite weather slippery
  (from (value-of slippery))
  (to (conjoin (value-of wet-grass) (value-of dark))))

(linked-program estimates)
(linked-rewrite estimates rain (from (value-of rain)) (to (ratio three four)))
(linked-rewrite estimates sprinkler (from (value-of sprinkler)) (to (ratio one two)))
(linked-rewrite estimates dark (from (value-of dark)) (to (ratio one two)))

(linked-program estimates-quarters)
(linked-rewrite estimates-quarters rain (from (value-of rain)) (to (ratio three four)))
(linked-rewrite estimates-quarters sprinkler (from (value-of sprinkler)) (to (ratio two four)))
(linked-rewrite estimates-quarters dark (from (value-of dark)) (to (ratio two four)))

(linked-program weather-over-product (uses weather) (uses estimates) (uses product-probability))
(linked-program weather-over-fuzzy (uses weather) (uses estimates-quarters) (uses goedel-fuzzy))
`;

for (const basis of ['s-k', 'direct-structural']) {
  const registry = LinkedProgramRegistry.fromRml(source, { executionBasis: basis });
  for (const program of ['weather-over-product', 'weather-over-fuzzy']) {
    for (const statement of ['wet-grass', 'slippery']) {
      const started = performance.now();
      const result = registry.reduce(program, ['value-of', statement]);
      const elapsed = performance.now() - started;
      console.log(basis, program, statement, JSON.stringify(result.term), result.steps, 'steps', elapsed.toFixed(1), 'ms');
    }
  }
}
