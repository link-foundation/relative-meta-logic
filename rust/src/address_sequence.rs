//! Lossless address sequences: every constructor and element boundary is a stored doublet.
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

const SCHEMA: &str = "rml-address-sequence/v1";
const DEFAULT_NAMESPACE: &str = "rml:address-sequence:1";
const MAX_ELEMENTS: usize = 10_000;
const MAX_LINKS: usize = 100_000;
const MAX_TEXT: usize = 1_048_576;

#[derive(Clone, Debug)]
pub struct AddressSequence {
    namespace: String,
    text_units: usize,
    links: BTreeMap<String, (String, String)>,
}

fn reference(value: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > 16384 || value.chars().count() > 4096 {
        Err("address must be a nonempty Unicode string within 4096 scalars".into())
    } else {
        Ok(())
    }
}

impl Default for AddressSequence {
    fn default() -> Self {
        Self::new(DEFAULT_NAMESPACE).expect("default namespace")
    }
}

impl AddressSequence {
    pub fn new(namespace: &str) -> Result<Self, String> {
        reference(namespace)?;
        let mut result = Self {
            namespace: namespace.to_string(),
            links: BTreeMap::new(),
            text_units: 0,
        };
        for tag in result.tags() {
            result.define_link(&tag, &tag, &tag)?;
        }
        Ok(result)
    }

    fn tags(&self) -> [String; 3] {
        ["empty", "element", "branch"].map(|kind| format!("{}:{kind}", self.namespace))
    }

    pub fn define_link(
        &mut self,
        address: &str,
        source: &str,
        target: &str,
    ) -> Result<String, String> {
        for value in [address, source, target] {
            reference(value)?;
        }
        if self.links.contains_key(address) {
            return Err(format!("duplicate link address {address}"));
        }
        if self.links.len() >= MAX_LINKS {
            return Err("sequence link bound exceeded".into());
        }
        let units = address.chars().count() + source.chars().count() + target.chars().count();
        if self.text_units + units > MAX_TEXT {
            return Err("sequence text bound exceeded".into());
        }
        self.links
            .insert(address.into(), (source.into(), target.into()));
        self.text_units += units;
        Ok(address.into())
    }

    pub fn snapshot(&self) -> Value {
        json!({"schema": SCHEMA, "namespace": self.namespace, "links": self.links.iter().map(|(address,(source,target))|json!({"address":address,"source":source,"target":target})).collect::<Vec<_>>()})
    }

    pub fn from_snapshot(snapshot: &Value) -> Result<Self, String> {
        let values = snapshot["links"]
            .as_array()
            .ok_or("invalid address-sequence snapshot")?;
        if snapshot["schema"] != SCHEMA
            || values.len() > MAX_LINKS
            || snapshot.as_object().map(|object| object.len()) != Some(3)
        {
            return Err("invalid address-sequence snapshot".into());
        }
        let namespace = snapshot["namespace"].as_str().ok_or("missing namespace")?;
        let mut result = Self::new(namespace)?;
        result.links.clear();
        result.text_units = 0;
        let mut units = 0;
        for node in values {
            if node.as_object().map(|object| object.len()) != Some(3) {
                return Err("invalid link record".into());
            }
            let fields = ["address", "source", "target"]
                .map(|key| node[key].as_str().ok_or("invalid link reference"));
            let [address, source, target] = fields;
            let (address, source, target) = (address?, source?, target?);
            units += address.chars().count() + source.chars().count() + target.chars().count();
            if units > MAX_TEXT {
                return Err("snapshot text bound exceeded".into());
            }
            result.define_link(address, source, target)?;
        }
        result.validate_tags()?;
        Ok(result)
    }

    fn validate_tags(&self) -> Result<(), String> {
        for tag in self.tags() {
            if self.links.get(&tag) != Some(&(tag.clone(), tag.clone())) {
                return Err(format!("missing or corrupt constructor {tag}"));
            }
        }
        Ok(())
    }

    pub fn encode(
        &mut self,
        elements: &[String],
        address: &str,
        layout: &str,
    ) -> Result<String, String> {
        reference(address)?;
        self.validate_tags()?;
        if !["balanced", "left", "right"].contains(&layout) {
            return Err("unknown sequence layout".into());
        }
        if elements.len() > MAX_ELEMENTS
            || elements
                .iter()
                .map(|value| value.chars().count())
                .sum::<usize>()
                > MAX_TEXT
        {
            return Err("sequence input bound exceeded".into());
        }
        for value in elements {
            reference(value)?;
        }
        let [empty, element, branch] = self.tags();
        if elements.is_empty() {
            return Ok(empty);
        }
        let mut pending: Vec<(String, String, String)> = Vec::new();
        let leaves: Vec<String> = elements
            .iter()
            .enumerate()
            .map(|(i, value)| {
                let name = format!("{address}.element.{i}");
                pending.push((name.clone(), element.clone(), value.clone()));
                name
            })
            .collect();
        let mut next = 0;
        let mut pair = |left: String, right: String| {
            let index = next;
            next += 1;
            let payload = format!("{address}.pair.{index}");
            let name = format!("{address}.branch.{index}");
            pending.push((payload.clone(), left, right));
            pending.push((name.clone(), branch.clone(), payload));
            name
        };
        fn balanced(leaves: &[String], pair: &mut impl FnMut(String, String) -> String) -> String {
            if leaves.len() == 1 {
                return leaves[0].clone();
            }
            let middle = leaves.len() / 2;
            let left = balanced(&leaves[..middle], pair);
            let right = balanced(&leaves[middle..], pair);
            pair(left, right)
        }
        let head = match layout {
            "left" => leaves[1..]
                .iter()
                .fold(leaves[0].clone(), |left, right| pair(left, right.clone())),
            "right" => leaves[..leaves.len() - 1]
                .iter()
                .rev()
                .fold(leaves.last().unwrap().clone(), |right, left| {
                    pair(left.clone(), right)
                }),
            _ => balanced(&leaves, &mut pair),
        };
        let mut stored_units = self.text_units;
        stored_units += pending
            .iter()
            .map(|(address, source, target)| {
                address.chars().count() + source.chars().count() + target.chars().count()
            })
            .sum::<usize>();
        if stored_units > MAX_TEXT {
            return Err("sequence text bound exceeded".into());
        }
        let referenced: BTreeSet<&String> = elements.iter().collect();
        for (name, source, target) in &pending {
            for value in [name, source, target] {
                reference(value)?;
            }
            if self.links.contains_key(name) || referenced.contains(name) {
                return Err(format!("sequence address collision {name}"));
            }
        }
        if self.links.len() + pending.len() > MAX_LINKS {
            return Err("sequence link bound exceeded".into());
        }
        for (name, source, target) in pending {
            self.define_link(&name, &source, &target)?;
        }
        Ok(head)
    }

    pub fn decode(
        &self,
        head: &str,
        max_elements: usize,
        max_nodes: usize,
    ) -> Result<Vec<String>, String> {
        reference(head)?;
        if max_elements == 0 || max_nodes == 0 {
            return Err("sequence bounds must be positive safe integers".into());
        }
        self.validate_tags()?;
        let [empty, element, branch] = self.tags();
        let mut result = Vec::new();
        let mut active = BTreeSet::new();
        let mut stack = vec![(head.to_string(), false)];
        let mut visited = 0;
        while let Some((address, exit)) = stack.pop() {
            if exit {
                active.remove(&address);
                continue;
            }
            visited += 1;
            if visited > max_nodes {
                return Err("sequence node bound exceeded".into());
            }
            if address == empty {
                continue;
            }
            if address == element || address == branch {
                return Err("constructor address used as a sequence".into());
            }
            let (tag, target) = self
                .links
                .get(&address)
                .ok_or_else(|| format!("missing sequence link {address}"))?;
            if *tag == element {
                result.push(target.clone());
                if result.len() > max_elements {
                    return Err("sequence element bound exceeded".into());
                }
            } else if *tag == branch {
                if !active.insert(address.clone()) {
                    return Err("cyclic sequence structure".into());
                }
                let (left, right) = self
                    .links
                    .get(target)
                    .ok_or_else(|| format!("missing branch payload {target}"))?;
                stack.push((address, true));
                stack.push((right.clone(), false));
                stack.push((left.clone(), false));
            } else {
                return Err(format!("unknown sequence constructor {tag}"));
            }
        }
        Ok(result)
    }

    pub fn encode_set(
        &mut self,
        values: &[String],
        address: &str,
        layout: &str,
    ) -> Result<String, String> {
        if values.len() > MAX_ELEMENTS {
            return Err("sequence input bound exceeded".into());
        }
        let elements: Vec<String> = values
            .iter()
            .cloned()
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        self.encode(&elements, address, layout)
    }

    pub fn decode_set(
        &self,
        head: &str,
        max_elements: usize,
        max_nodes: usize,
    ) -> Result<Vec<String>, String> {
        let values = self.decode(head, max_elements, max_nodes)?;
        if values.windows(2).any(|pair| pair[0] >= pair[1]) {
            return Err("set elements are not in strict address order".into());
        }
        Ok(values)
    }

    pub fn encode_ordered_set(
        &mut self,
        values: &[String],
        address: &str,
        layout: &str,
    ) -> Result<String, String> {
        if values.iter().collect::<BTreeSet<_>>().len() != values.len() {
            return Err("ordered set contains duplicate addresses".into());
        }
        self.encode(values, address, layout)
    }

    pub fn decode_ordered_set(
        &self,
        head: &str,
        max_elements: usize,
        max_nodes: usize,
    ) -> Result<Vec<String>, String> {
        let values = self.decode(head, max_elements, max_nodes)?;
        if values.iter().collect::<BTreeSet<_>>().len() != values.len() {
            return Err("ordered set contains duplicate addresses".into());
        }
        Ok(values)
    }
}
