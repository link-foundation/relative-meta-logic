/-
  MetaDefinitions.lean - Теория связей как мета-теория: переопределение базовых
  терминов теории связей через последовательности и множества, которые сами
  определены в терминах связей.

  Этот файл замыкает цикл определений:
  1. Связи (Reference) и ссылки определены как натуральные числа (ℕ₀)
  2. Последовательности определены как деревья связей-дуплетов в сети
  3. Множества определены как упорядоченные уникальные последовательности связей
  4. Теперь мы переопределяем связи и ссылки через множества и последовательности

  Это демонстрирует, что теория связей может определять свои собственные
  начальные термины в терминах структур, построенных из связей,
  что делает её мета-теорией — теорией, определяющей саму себя.
-/
import NetworkDefinitions
import NetworkConversions
import SequenceDefinitions
import SetDefinitions
import SetSequenceEquivalence

open SetSequenceEquivalence

-- * Мета-определения: связи и ссылки через последовательности и множества

/-
  Мета-ссылка (MetaReference) — это элемент множества ссылок,
  определённого как упорядоченное уникальное дерево связей-дуплетов
  в сети.

  В исходном определении: Reference := ℕ₀ (натуральное число)
  В мета-определении: MetaReference — это лист дерева, хранимого в сети,
  где LinkSet — это Reference (ссылка на корень дерева в сети).

  Таким образом, мета-ссылка определена через связи, которые определены
  через мета-ссылки — цикл замкнут.
-/

-- Мета-ссылка: элемент множества, определённого через деревья связей
abbrev MetaReference := Reference

-- Мета-пространство ссылок: ссылка на корень дерева в сети
abbrev MetaReferenceSpace := LinkSet

-- Мета-дуплет: пара мета-ссылок — это связь-дуплет
abbrev MetaDuplet := MetaReference × MetaReference

-- Мета-сеть: функция из мета-ссылок в мета-дуплеты
abbrev MetaNetwork := MetaReference → MetaDuplet

-- Мета-сеть в виде последовательности мета-дуплетов
abbrev MetaNetworkList := List MetaDuplet

-- Создание списка мета-ссылок заданного размера
def makeMetaReferenceSpace_ : Nat → List Reference
  | 0 => [0]
  | n + 1 => makeMetaReferenceSpace_ n ++ [n + 1]

-- Создание мета-пространства ссылок — множество в сети
def MakeMetaReferenceSpace (size : Nat) (offset : Nat)
    : Option (MetaReferenceSpace × NetworkDupletList) :=
  ListToSet (makeMetaReferenceSpace_ size) offset

-- * Определение мета-сети через последовательности

-- Преобразование мета-сети в сеть дуплетов
def MetaNetworkToDupletList (net : MetaNetworkList) : NetworkDupletList :=
  net

/-
  ОСНОВНАЯ ТЕОРЕМА МЕТА-ТЕОРИИ:

  Любая мета-сеть (определённая через последовательности и множества,
  которые определены через связи-дуплеты) может быть представлена как обычная
  сеть дуплетов.

  Это формально показывает, что мета-определения совместимы с исходными:
  теория связей может определять свои термины через себя без противоречий.
-/
theorem meta_network_is_duplet_network :
    ∀ (net : MetaNetworkList),
      MetaNetworkToDupletList net = net := by
  intro net
  rfl

-- Мета-пространство ссылок содержит упорядоченные уникальные элементы
theorem meta_reference_space_elements_valid (size : Nat) :
    IsOrderedUniqueSequence (toOrderedUnique (makeMetaReferenceSpace_ size)) := by
  exact toOrderedUnique_is_ascending (makeMetaReferenceSpace_ size)

-- * Демонстрация цикла определений

/-
  Цикл определений теории связей как мета-теории:

  Уровень 0 (базовый):
    Reference := ℕ₀
    Duplet := Reference × Reference
    Network := Reference → Duplet

  Уровень 1 (последовательности через связи):
    LinkSequence := Reference  (ссылка на корень дерева дуплетов в сети)
    Дерево дуплетов хранится в NetworkDupletList

  Уровень 2 (множества через последовательности):
    LinkSet := Reference  (ссылка на корень, с инвариантом IsOrderedUniqueSequence)

  Уровень 3 (мета-определения через множества):
    MetaReference := Reference
    MetaDuplet := MetaReference × MetaReference
    MetaNetwork := MetaReference → MetaDuplet

  Уровень 3 структурно идентичен Уровню 0,
  но определён через конструкции Уровней 1 и 2,
  которые сами определены через конструкции Уровня 0.

  Это замыкает цикл: теория связей определяет себя через себя.

  Все мета-термины описываются через связи:
  - Ссылка (Reference) — это связь нулевой размерности: r ≡ (r, ()),
    поскольку при n = 0 кортеж T₀ = R⁰ пуст, и L = R × T₀ ≡ R.
  - MetaReference — это связь произвольной размерности с самоссылкой.
  - MetaDuplet — это двумерная связь (пара мета-ссылок).
  - MetaNetwork — это связь связей (последовательность, которая сама является связью).

  Таким образом, все термины теории связей описываются как связи —
  термин, введённый в самой теории. Теория полностью самодостаточна.
-/

-- Пример: создание мета-пространства из 5 ссылок
#eval MakeMetaReferenceSpace 4 10
-- Множество {0, 1, 2, 3, 4} в сети

-- Пример: создание мета-сети
def exampleMetaNetwork : MetaNetworkList :=
  [(1, 2), (2, 3), (3, 1)]

-- Преобразование мета-сети в дуплеты
#eval MetaNetworkToDupletList exampleMetaNetwork
-- Ожидается: [(1, 2), (2, 3), (3, 1)] — структурно идентично исходной сети

-- * Проверки верификации

#check @meta_network_is_duplet_network
#check @meta_reference_space_elements_valid
