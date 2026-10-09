//! Generic finite-tree Horn resolution with explicit host unification/search authority.
use crate::{parse_lino, parse_one, tokenize_one, Node};
use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

pub const OPERATIONS: &[&str] = &[
    "horn-freshen-clause",
    "horn-unify",
    "horn-resolve-goal",
    "horn-project-answer",
];
#[derive(Clone, Debug)]
pub struct Clause {
    pub name: String,
    pub head: Node,
    pub body: Vec<Node>,
}
#[derive(Clone, Debug, PartialEq)]
pub struct Proof {
    pub clause: String,
    pub goal: Node,
    pub premises: Vec<Proof>,
}
#[derive(Clone, Debug)]
pub struct Answer {
    pub goal: Node,
    pub proof: Option<Proof>,
    pub source_proof: Option<Node>,
}
#[derive(Clone, Debug)]
pub struct QueryResult {
    pub answers: Vec<Answer>,
    pub exhausted: bool,
    pub steps: usize,
    pub observed_operations: BTreeSet<String>,
}
#[derive(Clone, Debug)]
pub struct ReplayResult {
    pub accepted: bool,
    pub goal: Option<Node>,
    pub steps: usize,
    pub observed_operations: BTreeSet<String>,
}
#[derive(Clone, Debug)]
pub struct Options {
    pub max_steps: usize,
    pub max_depth: usize,
    pub max_answers: usize,
    pub capture_proof: bool,
    pub self_interpret: bool,
    pub include_source_proof: bool,
    pub normalization_fuel: usize,
    pub disabled: BTreeSet<String>,
}
impl Default for Options {
    fn default() -> Self {
        Self {
            max_steps: 1_000_000,
            max_depth: 2048,
            max_answers: 1,
            capture_proof: true,
            self_interpret: false,
            include_source_proof: false,
            normalization_fuel: 32,
            disabled: BTreeSet::new(),
        }
    }
}
struct Budget {
    options: Options,
    steps: usize,
    observed: BTreeSet<String>,
}
impl Budget {
    fn new(options: &Options) -> Result<Self, String> {
        if options.max_steps == 0 || options.max_depth == 0 || options.max_answers == 0 {
            return Err("Horn bounds must be positive".into());
        }
        Ok(Self {
            options: options.clone(),
            steps: 0,
            observed: BTreeSet::new(),
        })
    }
    fn observe(&mut self, operation: &str) -> Result<(), String> {
        if self.options.disabled.contains(operation) {
            return Err(format!("disabled host semantic operation {operation}"));
        }
        self.observed.insert(operation.to_string());
        self.steps += 1;
        if self.steps > self.options.max_steps {
            return Err("Horn resolution step bound exceeded".into());
        }
        Ok(())
    }
}
#[derive(Clone, Debug)]
enum Term {
    Atom(String),
    Variable(String, usize, RefCell<Option<Ref>>),
    List(Vec<Arc<Term>>, bool),
}
type Ref = Arc<Term>;
type Bindings = ();
static VARIABLE_SERIAL: AtomicUsize = AtomicUsize::new(0);
fn check_data(node: &Node) -> Result<(), String> {
    let mut pending = vec![(node, 0)];
    let mut count = 0;
    while let Some((node, depth)) = pending.pop() {
        count += 1;
        if count > 1_000_000 || depth > 512 {
            return Err("Horn input size/depth bound exceeded".into());
        }
        if let Node::List(items) = node {
            pending.extend(items.iter().map(|item| (item, depth + 1)));
        }
    }
    Ok(())
}
fn source_term(node: &Node, scope: Option<&str>) -> Ref {
    source_term_with_variables(node, scope, &mut BTreeMap::new())
}
fn source_term_with_variables(
    node: &Node,
    scope: Option<&str>,
    variables: &mut BTreeMap<String, Ref>,
) -> Ref {
    match node {
        Node::Leaf(text) => match scope {
            Some(scope) if text.starts_with('?') && text.len() > 1 => variables
                .entry(text.clone())
                .or_insert_with(|| {
                    Arc::new(Term::Variable(
                        format!("{scope}:{}", &text[1..]),
                        VARIABLE_SERIAL.fetch_add(1, Ordering::Relaxed) + 1,
                        RefCell::new(None),
                    ))
                })
                .clone(),
            _ => Arc::new(Term::Atom(text.clone())),
        },
        Node::List(items) => {
            let children = items
                .iter()
                .map(|item| source_term_with_variables(item, scope, variables))
                .collect::<Vec<_>>();
            let ground = children.iter().all(syntactically_ground);
            Arc::new(Term::List(children, ground))
        }
    }
}
fn walk(mut term: Ref, _bindings: &Bindings) -> Ref {
    loop {
        let next = match term.as_ref() {
            Term::Variable(_, _, binding) => binding.borrow().clone(),
            _ => None,
        };
        match next {
            Some(value) => term = value,
            None => return term,
        }
    }
}
fn unbind(term: &Ref) {
    if let Term::Variable(_, _, binding) = term.as_ref() {
        *binding.borrow_mut() = None;
    }
}
fn birth(term: &Ref) -> usize {
    if let Term::Variable(_, birth, _) = term.as_ref() {
        *birth
    } else {
        usize::MAX
    }
}
fn syntactically_ground(term: &Ref) -> bool {
    matches!(term.as_ref(), Term::Atom(_) | Term::List(_, true))
}
// Materialize existing substitutions before storing a binding. Immutable ground
// subtrees are a safe, predicate-independent occurs-check shortcut.
fn binding_value(
    forbidden: &Ref,
    term: Ref,
    bindings: &Bindings,
    depth: usize,
) -> Result<Option<Ref>, String> {
    if depth > 512 {
        return Err("Horn binding depth bound exceeded".into());
    }
    let value = walk(term, bindings);
    if syntactically_ground(&value) {
        return Ok(Some(value));
    }
    match value.as_ref() {
        Term::Variable(_, _, _) => Ok(if Arc::ptr_eq(forbidden, &value) {
            None
        } else {
            Some(value.clone())
        }),
        Term::List(items, _) => {
            let mut children = Vec::with_capacity(items.len());
            let mut changed = false;
            for child in items {
                let Some(next) = binding_value(forbidden, child.clone(), bindings, depth + 1)?
                else {
                    return Ok(None);
                };
                changed |= !Arc::ptr_eq(child, &next);
                children.push(next);
            }
            if changed {
                let ground = children.iter().all(syntactically_ground);
                Ok(Some(Arc::new(Term::List(children, ground))))
            } else {
                Ok(Some(value))
            }
        }
        Term::Atom(_) => unreachable!("atoms are syntactically ground"),
    }
}
fn unify(a: Ref, b: Ref, bindings: &mut Bindings, trail: &mut Vec<Ref>) -> Result<bool, String> {
    let mut pending = vec![(a, b)];
    while let Some((a, b)) = pending.pop() {
        let a = walk(a, bindings);
        let b = walk(b, bindings);
        if Arc::ptr_eq(&a, &b) {
            continue;
        }
        match (a.as_ref(), b.as_ref()) {
            (Term::Variable(_, _, cell), _) => {
                let Some(value) = binding_value(&a, b.clone(), bindings, 0)? else {
                    return Ok(false);
                };
                *cell.borrow_mut() = Some(value);
                trail.push(a.clone());
            }
            (_, Term::Variable(_, _, cell)) => {
                let Some(value) = binding_value(&b, a.clone(), bindings, 0)? else {
                    return Ok(false);
                };
                *cell.borrow_mut() = Some(value);
                trail.push(b.clone());
            }
            (Term::Atom(x), Term::Atom(y)) if x == y => {}
            (Term::List(xs, _), Term::List(ys, _)) if xs.len() == ys.len() => {
                pending.extend(xs.iter().cloned().zip(ys.iter().cloned()).rev());
            }
            _ => return Ok(false),
        }
    }
    Ok(true)
}
fn same_possible(a: Ref, b: Ref, bindings: &Bindings) -> bool {
    let mut pending = vec![(a, b)];
    while let Some((a, b)) = pending.pop() {
        let a = walk(a, bindings);
        let b = walk(b, bindings);
        if Arc::ptr_eq(&a, &b) {
            continue;
        }
        match (a.as_ref(), b.as_ref()) {
            (Term::Variable(_, _, _), _) | (_, Term::Variable(_, _, _)) => {}
            (Term::Atom(a), Term::Atom(b)) if a == b => {}
            (Term::List(a, _), Term::List(b, _)) if a.len() == b.len() => {
                pending.extend(a.iter().cloned().zip(b.iter().cloned()))
            }
            _ => return false,
        }
    }
    true
}
// Conservative, read-only discrimination never prunes a unifiable clause.
fn compatible(pattern: &Node, goal: Ref, bindings: &Bindings) -> bool {
    let mut captured: BTreeMap<String, Ref> = BTreeMap::new();
    let mut pending = vec![(pattern, goal)];
    while let Some((pattern, raw)) = pending.pop() {
        let value = walk(raw, bindings);
        if let Node::Leaf(name) = pattern {
            if name.starts_with('?') && name.len() > 1 {
                if let Some(previous) = captured.get(name) {
                    if !same_possible(previous.clone(), value.clone(), bindings) {
                        return false;
                    }
                }
                captured.insert(name.clone(), value);
                continue;
            }
        }
        if matches!(value.as_ref(), Term::Variable(_, _, _)) {
            continue;
        }
        match (pattern, value.as_ref()) {
            (Node::Leaf(a), Term::Atom(b)) if a == b => {}
            (Node::List(a), Term::List(b, _)) if a.len() == b.len() => {
                pending.extend(a.iter().zip(b.iter().cloned()))
            }
            _ => return false,
        }
    }
    true
}
fn project(term: Ref, bindings: &Bindings, depth: usize) -> Result<Node, String> {
    if depth > 512 {
        return Err("Horn answer depth bound exceeded".into());
    }
    Ok(match walk(term, bindings).as_ref() {
        Term::Variable(name, _, _) => Node::Leaf(format!("?{name}")),
        Term::Atom(value) => Node::Leaf(value.clone()),
        Term::List(items, _) => Node::List(
            items
                .iter()
                .map(|item| project(item.clone(), bindings, depth + 1))
                .collect::<Result<_, _>>()?,
        ),
    })
}
fn node_key(node: &Node) -> Option<(usize, String)> {
    match node {
        Node::List(items) => match items.first() {
            Some(Node::Leaf(name)) if !name.starts_with('?') => Some((items.len(), name.clone())),
            _ => None,
        },
        _ => None,
    }
}
fn term_key(term: Ref, bindings: &Bindings) -> Option<(usize, String)> {
    match walk(term, bindings).as_ref() {
        Term::List(items, _) => match items.first()?.as_ref() {
            Term::Atom(name) => Some((items.len(), name.clone())),
            _ => None,
        },
        _ => None,
    }
}
#[derive(Clone)]
struct Goal {
    term: Ref,
    id: usize,
    depth: usize,
}
struct Choice {
    goal: Goal,
    rest: Vec<Goal>,
    candidates: Vec<usize>,
    next: usize,
    mark: usize,
    event_mark: usize,
    birth: usize,
}
struct Event {
    id: usize,
    clause: String,
    term: Ref,
    children: Vec<usize>,
}
struct Search<'a> {
    resolver: &'a HornResolution,
    budget: Budget,
    bindings: Bindings,
    trail: Vec<Ref>,
    events: Vec<Event>,
    choices: Vec<Choice>,
    goals: Vec<Goal>,
    fresh: usize,
    proof_id: usize,
}
impl Search<'_> {
    fn rollback(&mut self, mark: usize) {
        while self.trail.len() > mark {
            unbind(&self.trail.pop().unwrap());
        }
    }
    fn advance(&mut self) -> Result<bool, String> {
        while !self.choices.is_empty() {
            let mut choice = self.choices.pop().unwrap();
            self.rollback(choice.mark);
            self.events.truncate(choice.event_mark);
            while choice.next < choice.candidates.len() {
                self.budget.observe("horn-resolve-goal")?;
                let clause = &self.resolver.clauses[choice.candidates[choice.next]];
                choice.next += 1;
                self.budget.observe("horn-freshen-clause")?;
                self.fresh += 1;
                let scope = format!("clause-{}", self.fresh);
                let mut variables = BTreeMap::new();
                let head = source_term_with_variables(&clause.head, Some(&scope), &mut variables);
                let body = clause
                    .body
                    .iter()
                    .map(|term| source_term_with_variables(term, Some(&scope), &mut variables))
                    .collect::<Vec<_>>();
                self.budget.observe("horn-unify")?;
                let mut local_trail = Vec::new();
                if !unify(
                    choice.goal.term.clone(),
                    head,
                    &mut self.bindings,
                    &mut local_trail,
                )? {
                    for cell in &local_trail {
                        unbind(cell);
                    }
                    continue;
                }
                let keep_choice = choice.next < choice.candidates.len();
                let checkpoint = if keep_choice {
                    choice.birth
                } else {
                    self.choices.last().map(|choice| choice.birth).unwrap_or(0)
                };
                self.trail.extend(
                    local_trail
                        .into_iter()
                        .filter(|cell| birth(cell) <= checkpoint),
                );
                let mut children = Vec::new();
                for term in body {
                    self.proof_id += 1;
                    let depth = choice.goal.depth + 1;
                    if depth > self.budget.options.max_depth {
                        return Err("Horn resolution depth bound exceeded".into());
                    }
                    children.push(Goal {
                        term,
                        id: self.proof_id,
                        depth,
                    });
                }
                if self.budget.options.capture_proof {
                    self.events.push(Event {
                        id: choice.goal.id,
                        clause: clause.name.clone(),
                        term: choice.goal.term.clone(),
                        children: children.iter().map(|child| child.id).collect(),
                    });
                }
                self.goals = children;
                self.goals.extend(choice.rest.iter().cloned());
                if keep_choice {
                    self.choices.push(choice);
                }
                return Ok(true);
            }
        }
        Ok(false)
    }
}
#[derive(Clone, Debug)]
pub struct HornResolution {
    clauses: Vec<Clause>,
    by_id: BTreeMap<String, usize>,
    index: BTreeMap<(usize, String), Vec<usize>>,
}
impl HornResolution {
    pub fn new(clauses: Vec<Clause>) -> Result<Self, String> {
        if clauses.is_empty() || clauses.len() > 10_000 {
            return Err("invalid Horn clause count".into());
        }
        let mut by_id = BTreeMap::new();
        let mut index: BTreeMap<(usize, String), Vec<usize>> = BTreeMap::new();
        for (i, clause) in clauses.iter().enumerate() {
            check_data(&clause.head)?;
            let key = node_key(&clause.head).ok_or("invalid Horn clause predicate")?;
            if clause.name.is_empty() || by_id.insert(clause.name.clone(), i).is_some() {
                return Err("duplicate or empty Horn clause name".into());
            }
            for goal in &clause.body {
                check_data(goal)?;
                if node_key(goal).is_none() {
                    return Err("Horn goals require a declared predicate symbol".into());
                }
            }
            index.entry(key).or_default().push(i);
        }
        Ok(Self {
            clauses,
            by_id,
            index,
        })
    }
    pub fn from_source(source: &str) -> Result<Self, String> {
        if source.len() > 16_777_216 {
            return Err("Horn source size bound exceeded".into());
        }
        let flattened = source
            .lines()
            .map(|line| line.trim_start_matches([' ', '\t']))
            .collect::<Vec<_>>()
            .join("\n");
        let mut clauses = Vec::new();
        for form in parse_lino(&flattened).map_err(|error| error.to_string())? {
            let form = parse_one(&tokenize_one(&form))?;
            match form {
                Node::List(items)
                    if items.len() >= 3 && items[0] == Node::Leaf("horn-clause".into()) =>
                {
                    let Node::Leaf(name) = &items[1] else {
                        return Err("invalid Horn clause name".into());
                    };
                    clauses.push(Clause {
                        name: name.clone(),
                        head: items[2].clone(),
                        body: items[3..].to_vec(),
                    });
                }
                _ => return Err("expected horn-clause source declaration".into()),
            }
        }
        Self::new(clauses)
    }
    pub fn clauses(&self) -> &[Clause] {
        &self.clauses
    }
    pub fn query(&self, goal: &Node, options: &Options) -> Result<QueryResult, String> {
        check_data(goal)?;
        let query = source_term(goal, Some("query"));
        let mut search = Search {
            resolver: self,
            budget: Budget::new(options)?,
            bindings: (),
            trail: Vec::new(),
            events: Vec::new(),
            choices: Vec::new(),
            goals: vec![Goal {
                term: query.clone(),
                id: 0,
                depth: 0,
            }],
            fresh: 0,
            proof_id: 0,
        };
        let mut answers = Vec::new();
        let mut exhausted = false;
        loop {
            if search.goals.is_empty() {
                search.budget.observe("horn-project-answer")?;
                let mut proofs = BTreeMap::new();
                if options.capture_proof {
                    for event in search.events.iter().rev() {
                        let premises = event
                            .children
                            .iter()
                            .map(|id| proofs.remove(id).expect("completed Horn child"))
                            .collect();
                        proofs.insert(
                            event.id,
                            Proof {
                                clause: event.clause.clone(),
                                goal: project(event.term.clone(), &search.bindings, 0)?,
                                premises,
                            },
                        );
                    }
                }
                answers.push(Answer {
                    goal: project(query.clone(), &search.bindings, 0)?,
                    proof: proofs.remove(&0),
                    source_proof: None,
                });
                if answers.len() >= options.max_answers {
                    break;
                }
                if !search.advance()? {
                    exhausted = true;
                    break;
                }
            } else {
                let first = search.goals.remove(0);
                search.budget.observe("horn-resolve-goal")?;
                let available = term_key(first.term.clone(), &search.bindings)
                    .and_then(|key| self.index.get(&key))
                    .cloned()
                    .unwrap_or_default();
                let mut candidates = Vec::new();
                for index in available {
                    search.budget.observe("horn-unify")?;
                    if compatible(
                        &self.clauses[index].head,
                        first.term.clone(),
                        &search.bindings,
                    ) {
                        candidates.push(index);
                    }
                }
                search.choices.push(Choice {
                    goal: first,
                    rest: search.goals.clone(),
                    candidates,
                    next: 0,
                    mark: search.trail.len(),
                    event_mark: search.events.len(),
                    birth: VARIABLE_SERIAL.load(Ordering::Relaxed),
                });
                if !search.advance()? {
                    exhausted = true;
                    break;
                }
            }
        }
        Ok(QueryResult {
            answers,
            exhausted,
            steps: search.budget.steps,
            observed_operations: search.budget.observed,
        })
    }
    pub fn replay(
        &self,
        goal: &Node,
        proof: &Proof,
        options: &Options,
    ) -> Result<ReplayResult, String> {
        check_data(goal)?;
        let query = source_term(goal, Some("replay-query"));
        let mut budget = Budget::new(options)?;
        let mut bindings = ();
        let mut trail = Vec::new();
        let mut pending = vec![(query.clone(), proof, 0)];
        let mut fresh = 0;
        let mut accepted = true;
        while let Some((goal, proof, depth)) = pending.pop() {
            if depth > options.max_depth {
                return Err("Horn replay depth bound exceeded".into());
            }
            let Some(index) = self.by_id.get(&proof.clause) else {
                accepted = false;
                break;
            };
            let clause = &self.clauses[*index];
            if clause.body.len() != proof.premises.len() {
                accepted = false;
                break;
            }
            check_data(&proof.goal)?;
            budget.observe("horn-resolve-goal")?;
            budget.observe("horn-freshen-clause")?;
            fresh += 1;
            let scope = format!("replay-{fresh}");
            let mut variables = BTreeMap::new();
            let head = source_term_with_variables(&clause.head, Some(&scope), &mut variables);
            budget.observe("horn-unify")?;
            if !unify(
                goal.clone(),
                source_term(&proof.goal, None),
                &mut bindings,
                &mut trail,
            )? || !unify(goal, head, &mut bindings, &mut trail)?
            {
                accepted = false;
                break;
            }
            trail.clear();
            for (term, child) in clause.body.iter().zip(&proof.premises).rev() {
                pending.push((
                    source_term_with_variables(term, Some(&scope), &mut variables),
                    child,
                    depth + 1,
                ));
            }
        }
        if accepted {
            budget.observe("horn-project-answer")?;
        }
        Ok(ReplayResult {
            accepted,
            goal: if accepted {
                Some(project(query, &bindings, 0)?)
            } else {
                None
            },
            steps: budget.steps,
            observed_operations: budget.observed,
        })
    }
}

/// Complete declared operation groups; their count is not a primitive-minimality claim.
pub fn trust_report() -> serde_json::Value {
    serde_json::json!({
        "schema":"rml-horn-resolution-boundary/v1","operations":OPERATIONS,
        "operationGroupsNotPrimitiveCount":true,
        "unificationRules":["dereference existing bindings","identity of atoms and variables","decompose equal-arity constructors and reject clashes","orient a free-variable equation","finite-tree occurs check","consistent extension and branch-local undo"],
        "representationOptimizations":["conservative constructor discrimination","owned immutable ground-term normalization","conditional trailing of variable cells"],
        "externalSemanticAuthority":["first-order finite-tree unification, occurs check, variable dereference and substitution extension","fresh clause-variable scope and repeated-variable identity","leftmost depth-first SLD resolution, source clause order and backtracking","answer projection and independent generic derivation checking"],
        "externalServices":["LiNo parser and ? variable elaboration","predicate/arity indexing","data/proof codecs and validation","source fingerprints and per-call atom dictionaries bind certificate context","resource bounds, allocation, host runtime/compiler, operating system and processor"],
        "noTheorySpecificCallbacks":true,"independentPrimitiveMinimalityEstablished":false,
        "intrinsicLinksAuthorityEstablished":false,"fullImplementationClosure":false
    })
}
