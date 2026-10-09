//! Independently scoped, named/versioned linked foundation source packages.
//! Only program/instance declaration and reference positions are qualified;
//! judgement symbols and caller assumptions keep their source identities.

use crate::foundation_workspace::{
    FoundationBounds, FoundationChange, FoundationExecution, FoundationRef, FoundationResult,
    FoundationWorkspace,
};
use crate::linked_program::ExecutionBasis;
use crate::{parse_lino, parse_one, tokenize_one, Node};
use std::collections::{BTreeMap, BTreeSet};
use std::rc::Rc;

type Identity = (String, String);

#[derive(Debug, Clone)]
pub struct PackageImport {
    pub name: String,
    pub version: String,
    pub program: Option<String>,
    pub alias: Option<String>,
}
#[derive(Debug, Clone)]
pub struct LinkedFoundationPackage {
    pub name: String,
    pub version: String,
    pub source: String,
    pub imports: Vec<PackageImport>,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PackageSelection {
    pub name: String,
    pub version: String,
    pub instance: String,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProgramOrigin {
    pub address: String,
    pub name: String,
    pub version: String,
    pub program: String,
}
#[derive(Debug, Clone)]
pub struct PackageResult {
    pub package: FoundationRef,
    pub result: FoundationResult,
    pub theory_package: FoundationRef,
    pub programs: Vec<ProgramOrigin>,
    selection: PackageSelection,
    raw: FoundationResult,
    owner: Rc<()>,
}
#[derive(Debug, Clone)]
pub struct PackageExecution {
    pub package: FoundationRef,
    pub result: FoundationExecution,
    pub theory_package: FoundationRef,
    pub programs: Vec<ProgramOrigin>,
}
#[derive(Debug, Clone)]
pub struct PackageResultRevision {
    pub action: &'static str,
    pub changed: bool,
    pub before: PackageResult,
    pub after: PackageResult,
}
#[derive(Debug, Clone)]
pub struct PackageRevision {
    pub workspace: FoundationPackages,
    pub revisions: Vec<PackageResultRevision>,
}
#[derive(Debug, Clone)]
struct Plan {
    name: String,
    version: String,
    forms: Vec<Node>,
    local: BTreeMap<String, String>,
    instances: BTreeMap<String, String>,
    aliases: BTreeMap<String, String>,
    dependencies: BTreeSet<Identity>,
}
#[derive(Debug, Clone)]
pub struct FoundationPackages {
    owner: Rc<()>,
    workspace: FoundationWorkspace,
    plans: BTreeMap<Identity, Plan>,
    origins: BTreeMap<String, ProgramOrigin>,
}

fn name(value: &str, context: &str) -> Result<(), String> {
    if value.is_empty() || value.starts_with('?') {
        return Err(format!("{context} must be a name"));
    }
    Ok(())
}
fn leaf(node: Option<&Node>) -> Result<&str, String> {
    match node {
        Some(Node::Leaf(text)) => Ok(text),
        _ => Err("package syntax requires a name".to_string()),
    }
}
fn version_of(form: &[Node]) -> Option<&str> {
    form.iter().find_map(|node| match node {
        Node::List(items) if leaf(items.first()).ok() == Some("version") => leaf(items.get(1)).ok(),
        _ => None,
    })
}
fn address(name: &str, version: &str, kind: &str, local: &str) -> String {
    let hex = |text: &str| {
        text.as_bytes()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    };
    format!(
        "rml-package.{}.{}.{kind}.{}",
        hex(name),
        hex(version),
        hex(local)
    )
}
fn parse(source: &str) -> Result<Vec<Node>, String> {
    let mut normalized = String::with_capacity(source.len());
    let mut start = true;
    for character in source.chars() {
        if start && matches!(character, ' ' | '\t') {
            continue;
        }
        start = matches!(character, '\n' | '\r' | '\u{2028}' | '\u{2029}');
        normalized.push(character);
    }
    parse_lino(&normalized)
        .map_err(|error| error.to_string())?
        .iter()
        .map(|form| parse_one(&tokenize_one(form)))
        .collect()
}
fn resolve_program(plan: &Plan, program: &str, imported: bool) -> Result<String, String> {
    plan.local
        .get(program)
        .or_else(|| {
            if imported {
                plan.aliases.get(program)
            } else {
                None
            }
        })
        .cloned()
        .ok_or_else(|| {
            format!(
                "package {} version {} has no {} program {program}",
                plan.name,
                plan.version,
                if imported {
                    "declared or imported"
                } else {
                    "local"
                }
            )
        })
}
fn foundation_reference(plan: &Plan, name: &str, version: Option<&str>) -> Result<(), String> {
    if name == plan.name && (version.is_none() || version == Some(plan.version.as_str())) {
        return Ok(());
    }
    let version = version.ok_or_else(|| {
        format!(
            "package {} external foundation {name} requires an explicit version",
            plan.name
        )
    })?;
    if !plan
        .dependencies
        .contains(&(name.to_string(), version.to_string()))
    {
        return Err(format!(
            "package {} uses undeclared foundation import {name} version {version}",
            plan.name
        ));
    }
    Ok(())
}
fn qualify(plan: &Plan, source: &Node) -> Result<Node, String> {
    let Node::List(mut form) = source.clone() else {
        return Err("package form must be a link".to_string());
    };
    let head = leaf(form.first())?.to_string();
    match head.as_str() {
        "linked-program" => {
            form[1] = Node::Leaf(resolve_program(plan, leaf(form.get(1))?, false)?);
            for clause in &mut form[2..] {
                if let Node::List(parts) = clause {
                    if leaf(parts.first())? == "uses" {
                        parts[1] = Node::Leaf(resolve_program(plan, leaf(parts.get(1))?, true)?);
                    }
                }
            }
        }
        "linked-fact" | "linked-inference" | "linked-rewrite" => {
            form[1] = Node::Leaf(resolve_program(plan, leaf(form.get(1))?, false)?);
        }
        "linked-foundation" => {
            for clause in &mut form[2..] {
                let Node::List(parts) = clause else {
                    return Err("package foundation clause must be a link".to_string());
                };
                match leaf(parts.first())? {
                    "axioms" | "inference" | "typing" | "reduction" | "equality" | "truth"
                    | "proof" => {
                        parts[1] = Node::Leaf(resolve_program(plan, leaf(parts.get(1))?, true)?);
                    }
                    "depends-on" => {
                        foundation_reference(plan, leaf(parts.get(1))?, version_of(parts))?
                    }
                    "cycle-policy" => {
                        for guard in parts.iter_mut().skip(2) {
                            if let Node::List(values) = guard {
                                if leaf(values.first())? == "guard" {
                                    values[1] = Node::Leaf(resolve_program(
                                        plan,
                                        leaf(values.get(1))?,
                                        true,
                                    )?);
                                }
                            }
                        }
                    }
                    _ => (),
                }
            }
        }
        "linked-instance" => {
            let local = leaf(form.get(1))?;
            form[1] = Node::Leaf(
                plan.instances
                    .get(local)
                    .ok_or_else(|| format!("unknown package instance {local}"))?
                    .clone(),
            );
            for clause in &mut form[2..] {
                let Node::List(parts) = clause else {
                    return Err("package instance clause must be a link".to_string());
                };
                match leaf(parts.first())? {
                    "theory" => {
                        parts[1] = Node::Leaf(resolve_program(plan, leaf(parts.get(1))?, true)?);
                    }
                    "foundation" => {
                        foundation_reference(plan, leaf(parts.get(1))?, version_of(parts))?
                    }
                    _ => (),
                }
            }
        }
        _ => return Err("package mutation must contain a linked rule".to_string()),
    }
    Ok(Node::List(form))
}

impl FoundationPackages {
    pub fn from_packages(packages: &[LinkedFoundationPackage]) -> Result<Self, String> {
        Self::from_packages_with_basis(packages, ExecutionBasis::ClosedSk)
    }
    pub fn load_packages(packages: &[LinkedFoundationPackage]) -> Result<Self, String> {
        Self::from_packages(packages)
    }
    pub fn from_packages_with_basis(
        packages: &[LinkedFoundationPackage],
        basis: ExecutionBasis,
    ) -> Result<Self, String> {
        if packages.is_empty() {
            return Err("foundation packages must be a non-empty list".to_string());
        }
        let mut plans = BTreeMap::new();
        let mut origins = BTreeMap::new();
        for item in packages {
            name(&item.name, "package name")?;
            name(&item.version, "package version")?;
            let identity = (item.name.clone(), item.version.clone());
            if plans.contains_key(&identity) {
                return Err(format!(
                    "duplicate package {} version {}",
                    item.name, item.version
                ));
            }
            let forms = parse(&item.source)?;
            let mut local = BTreeMap::new();
            let mut instances = BTreeMap::new();
            let mut foundations = Vec::new();
            for form in &forms {
                let Node::List(parts) = form else {
                    return Err("package contains an unsupported top-level form".to_string());
                };
                let head = leaf(parts.first())?;
                match head {
                    "linked-foundation" => foundations.push(parts),
                    "linked-program" | "linked-instance" => {
                        let kind = if head == "linked-program" {
                            "program"
                        } else {
                            "instance"
                        };
                        let target = if kind == "program" {
                            &mut local
                        } else {
                            &mut instances
                        };
                        let label = leaf(parts.get(1))?;
                        name(label, kind)?;
                        if target.contains_key(label) {
                            return Err(format!("package {} repeats {kind} {label}", item.name));
                        }
                        let qualified = address(&item.name, &item.version, kind, label);
                        target.insert(label.to_string(), qualified.clone());
                        if kind == "program" {
                            origins.insert(
                                qualified.clone(),
                                ProgramOrigin {
                                    address: qualified,
                                    name: item.name.clone(),
                                    version: item.version.clone(),
                                    program: label.to_string(),
                                },
                            );
                        }
                    }
                    "linked-fact" | "linked-inference" | "linked-rewrite" => (),
                    _ => {
                        return Err(format!(
                            "package {} contains an unsupported top-level form",
                            item.name
                        ))
                    }
                }
            }
            if foundations.len() != 1
                || leaf(foundations[0].get(1))? != item.name
                || version_of(foundations[0]) != Some(item.version.as_str())
            {
                return Err(format!("package {} version {} requires exactly its matching linked-foundation declaration", item.name, item.version));
            }
            plans.insert(
                identity,
                Plan {
                    name: item.name.clone(),
                    version: item.version.clone(),
                    forms,
                    local,
                    instances,
                    aliases: BTreeMap::new(),
                    dependencies: BTreeSet::new(),
                },
            );
        }
        for item in packages {
            let mut aliases = BTreeMap::new();
            let mut dependencies = BTreeSet::new();
            let plan = &plans[&(item.name.clone(), item.version.clone())];
            for entry in &item.imports {
                name(&entry.name, "import package")?;
                name(&entry.version, "import version")?;
                let identity = (entry.name.clone(), entry.version.clone());
                let imported = plans.get(&identity).ok_or_else(|| {
                    format!(
                        "package {} imports an unloaded package {} version {}",
                        item.name, entry.name, entry.version
                    )
                })?;
                dependencies.insert(identity);
                if entry.program.is_none() && entry.alias.is_none() {
                    continue;
                }
                let program = entry
                    .program
                    .as_ref()
                    .ok_or("import program must be a name")?;
                let alias = entry.alias.as_ref().ok_or("import alias must be a name")?;
                name(program, "import program")?;
                name(alias, "import alias")?;
                let qualified = imported.local.get(program).ok_or_else(|| {
                    format!(
                        "package {} version {} has no program {program}",
                        entry.name, entry.version
                    )
                })?;
                if plan.local.contains_key(alias) || aliases.contains_key(alias) {
                    return Err(format!(
                        "package {} import alias {alias} collides",
                        item.name
                    ));
                }
                aliases.insert(alias.clone(), qualified.clone());
            }
            let plan = plans
                .get_mut(&(item.name.clone(), item.version.clone()))
                .unwrap();
            plan.aliases = aliases;
            plan.dependencies = dependencies;
        }
        let forms = plans
            .values()
            .flat_map(|plan| plan.forms.iter().map(move |form| qualify(plan, form)))
            .collect::<Result<Vec<_>, _>>()?;
        let workspace = FoundationWorkspace::from_forms_with_basis(&forms, basis, &[])?;
        Ok(Self {
            owner: Rc::new(()),
            workspace,
            plans,
            origins,
        })
    }
    /// Apply an explicit closed-kernel contraction budget to this package workspace.
    pub fn with_max_contractions(mut self, max_contractions: usize) -> Result<Self, String> {
        self.workspace = self.workspace.with_max_contractions(max_contractions)?;
        Ok(self)
    }

    pub fn packages(&self) -> Vec<FoundationRef> {
        self.plans
            .values()
            .map(|plan| FoundationRef {
                name: plan.name.clone(),
                version: plan.version.clone(),
            })
            .collect()
    }
    pub fn programs(&self) -> Vec<ProgramOrigin> {
        self.origins.values().cloned().collect()
    }
    pub fn instances(&self) -> Vec<PackageSelection> {
        self.plans
            .values()
            .flat_map(|plan| {
                plan.instances.keys().map(|instance| PackageSelection {
                    name: plan.name.clone(),
                    version: plan.version.clone(),
                    instance: instance.clone(),
                })
            })
            .collect()
    }
    pub fn describe(
        &self,
        name: &str,
        version: &str,
    ) -> Result<crate::foundation_workspace::FoundationPackage, String> {
        self.plan(name, version)?;
        self.workspace.describe(name, Some(version))
    }
    fn plan(&self, name: &str, version: &str) -> Result<&Plan, String> {
        self.plans
            .get(&(name.to_string(), version.to_string()))
            .ok_or_else(|| format!("unknown package {name} version {version}"))
    }
    fn instance(&self, selection: &PackageSelection) -> Result<&str, String> {
        self.plan(&selection.name, &selection.version)?
            .instances
            .get(&selection.instance)
            .map(String::as_str)
            .ok_or_else(|| {
                format!(
                    "package {} version {} has no instance {}",
                    selection.name, selection.version, selection.instance
                )
            })
    }
    fn answer(&self, selection: &PackageSelection, raw: FoundationResult) -> PackageResult {
        let theory = &self.origins[&raw.theory.name];
        let mut result = raw.clone();
        result.instance = selection.instance.clone();
        result.theory.name = theory.program.clone();
        PackageResult {
            package: FoundationRef {
                name: selection.name.clone(),
                version: selection.version.clone(),
            },
            result,
            theory_package: FoundationRef {
                name: theory.name.clone(),
                version: theory.version.clone(),
            },
            programs: self.programs(),
            selection: selection.clone(),
            owner: self.owner.clone(),
            raw,
        }
    }
    pub fn ask(
        &self,
        selection: &PackageSelection,
        query: &Node,
        assumptions: &[Node],
        bounds: FoundationBounds,
    ) -> Result<PackageResult, String> {
        Ok(self.answer(
            selection,
            self.workspace
                .ask(self.instance(selection)?, query, assumptions, bounds)?,
        ))
    }
    pub fn execute(
        &self,
        selection: &PackageSelection,
        term: &Node,
        max_steps: usize,
    ) -> Result<PackageExecution, String> {
        let mut result = self
            .workspace
            .execute(self.instance(selection)?, term, max_steps)?;
        let theory = &self.origins[&result.theory.name];
        result.instance = selection.instance.clone();
        result.theory.name = theory.program.clone();
        Ok(PackageExecution {
            package: FoundationRef {
                name: selection.name.clone(),
                version: selection.version.clone(),
            },
            result,
            theory_package: FoundationRef {
                name: theory.name.clone(),
                version: theory.version.clone(),
            },
            programs: self.programs(),
        })
    }
    pub fn revise(
        &self,
        answers: &[PackageResult],
        selection: &PackageSelection,
        change: &FoundationChange,
    ) -> Result<PackageRevision, String> {
        if answers
            .iter()
            .any(|answer| !Rc::ptr_eq(&self.owner, &answer.owner))
        {
            return Err(
                "package revisions require query answers returned by this package workspace"
                    .to_string(),
            );
        }
        let plan = self.plan(&selection.name, &selection.version)?;
        let qualified = match change {
            FoundationChange::ReplaceAssumption { .. } => change.clone(),
            FoundationChange::RemoveRule { program, rule } => FoundationChange::RemoveRule {
                program: resolve_program(plan, program, false)?,
                rule: rule.clone(),
            },
            FoundationChange::AddRule(form) => FoundationChange::AddRule(qualify(plan, form)?),
            FoundationChange::ReplaceRule(form) => {
                FoundationChange::ReplaceRule(qualify(plan, form)?)
            }
        };
        let applies: Vec<bool> = answers
            .iter()
            .map(|answer| {
                !matches!(change, FoundationChange::ReplaceAssumption { .. })
                    || answer.selection == *selection
            })
            .collect();
        let selected: Vec<FoundationResult> = answers
            .iter()
            .zip(&applies)
            .filter(|(_, yes)| **yes)
            .map(|(answer, _)| answer.raw.clone())
            .collect();
        let revision = self.workspace.revise(&selected, &qualified)?;
        let mut changed = revision.revisions.into_iter();
        let workspace = Self {
            owner: Rc::new(()),
            workspace: revision.workspace.into_owned(),
            plans: self.plans.clone(),
            origins: self.origins.clone(),
        };
        let revisions = answers
            .iter()
            .zip(applies)
            .map(|(answer, applies)| {
                let (action, changed_outcome, after) = if applies {
                    let item = changed.next().unwrap();
                    (item.action, item.changed, item.after)
                } else {
                    ("kept", false, answer.raw.clone())
                };
                PackageResultRevision {
                    action,
                    changed: changed_outcome,
                    before: answer.clone(),
                    after: workspace.answer(&answer.selection, after),
                }
            })
            .collect();
        Ok(PackageRevision {
            workspace,
            revisions,
        })
    }
}
