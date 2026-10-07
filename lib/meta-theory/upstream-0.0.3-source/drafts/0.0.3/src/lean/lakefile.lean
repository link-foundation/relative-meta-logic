import Lake
open Lake DSL

package «meta-theory» where
  -- Meta-theory of links formal proofs package

@[default_target]
lean_lib «meta-theory» where
  roots := #[
    `NetworkDefinitions,
    `NetworkConversions,
    `NetworkEquivalence,
    `NetworkExamples,
    `NetworkLemmas,
    `SetSequenceEquivalence,
    `SequenceDefinitions,
    `SetDefinitions,
    `MetaDefinitions
  ]
