//! Strict bounded transport for addressed typed links networks. Framing and Link roles
//! are representation conventions, not logical inference or universe axioms.
use crate::theory_network::{TypedLinkNetwork, TypedLinkNetworkSnapshot};
use std::collections::{BTreeMap, BTreeSet};

const HEADER: &[u8] = b"RML-TYPED-LINKS/1\n";

#[derive(Debug, Clone, Copy)]
pub struct ArchiveLimits {
    pub max_bytes: usize,
    pub max_links: usize,
    pub max_field_bytes: usize,
}
impl Default for ArchiveLimits {
    fn default() -> Self {
        Self {
            max_bytes: 8 * 1024 * 1024,
            max_links: 100_000,
            max_field_bytes: 65536,
        }
    }
}
impl ArchiveLimits {
    fn validate(self) -> Result<Self, String> {
        if self.max_bytes == 0 || self.max_links == 0 || self.max_field_bytes == 0 {
            return Err("archive limits must be positive".to_string());
        }
        Ok(self)
    }
    fn field(self, field: &str) -> Result<(), String> {
        if field.is_empty() || field.len() > self.max_field_bytes {
            return Err("archive field limit exceeded".to_string());
        }
        Ok(())
    }
}
#[derive(Debug, Clone)]
pub struct TypedSemanticArchive {
    snapshot: TypedLinkNetworkSnapshot,
    roots: Vec<String>,
    limits: ArchiveLimits,
    links: BTreeMap<String, (String, String)>,
}
impl TypedSemanticArchive {
    pub fn from_network(network: &TypedLinkNetwork, roots: &[String]) -> Result<Self, String> {
        Self::from_snapshot(&network.snapshot(), roots)
    }
    pub fn from_snapshot(
        snapshot: &TypedLinkNetworkSnapshot,
        roots: &[String],
    ) -> Result<Self, String> {
        Self::from_snapshot_with_limits(snapshot, roots, ArchiveLimits::default())
    }
    pub fn from_snapshot_with_limits(
        snapshot: &TypedLinkNetworkSnapshot,
        roots: &[String],
        limits: ArchiveLimits,
    ) -> Result<Self, String> {
        let limits = limits.validate()?;
        if snapshot
            .links
            .len()
            .saturating_add(snapshot.type_facts.len())
            > limits.max_links
            || roots.len() > limits.max_links
        {
            return Err("archive link limit exceeded".to_string());
        }
        let mut total = 0usize;
        for (address, source, target) in snapshot.links.iter().chain(&snapshot.type_facts) {
            for field in [address, source, target] {
                limits.field(field)?;
                total = total.saturating_add(field.len());
                if total > limits.max_bytes {
                    return Err("archive byte limit exceeded".to_string());
                }
            }
        }
        let network = TypedLinkNetwork::from_snapshot(snapshot, true)?;
        let snapshot = network.snapshot();
        let links: BTreeMap<String, (String, String)> = snapshot
            .links
            .iter()
            .chain(&snapshot.type_facts)
            .map(|(address, source, target)| (address.clone(), (source.clone(), target.clone())))
            .collect();
        let mut seen = BTreeSet::new();
        for root in roots {
            limits.field(root)?;
            if !links.contains_key(root) {
                return Err(format!("archive root {root} is undefined"));
            }
            if !seen.insert(root) {
                return Err("archive repeats a root".to_string());
            }
        }
        Ok(Self {
            snapshot,
            roots: roots.to_vec(),
            limits,
            links,
        })
    }
    pub fn roots(&self) -> &[String] {
        &self.roots
    }
    pub fn snapshot(&self) -> TypedLinkNetworkSnapshot {
        self.snapshot.clone()
    }
    pub fn doublet(&self, address: &str) -> Option<(&str, &str)> {
        self.links
            .get(address)
            .map(|(source, target)| (source.as_str(), target.as_str()))
    }
    pub fn to_typed_network(&self) -> Result<TypedLinkNetwork, String> {
        TypedLinkNetwork::from_snapshot(&self.snapshot, true)
    }
    pub fn serialize(&self) -> Result<Vec<u8>, String> {
        let mut writer = Writer {
            bytes: Vec::new(),
            limits: self.limits,
        };
        writer.put(HEADER)?;
        writer.count(self.roots.len())?;
        for root in &self.roots {
            writer.field(root)?;
            writer.put(b"\n")?;
        }
        for rows in [&self.snapshot.links, &self.snapshot.type_facts] {
            writer.count(rows.len())?;
            for (address, source, target) in rows {
                writer.field(address)?;
                writer.field(source)?;
                writer.field(target)?;
                writer.put(b"\n")?;
            }
        }
        Ok(writer.bytes)
    }
    pub fn deserialize(bytes: &[u8]) -> Result<Self, String> {
        Self::deserialize_with_limits(bytes, ArchiveLimits::default())
    }
    pub fn deserialize_with_limits(bytes: &[u8], limits: ArchiveLimits) -> Result<Self, String> {
        let limits = limits.validate()?;
        if bytes.len() > limits.max_bytes {
            return Err("archive byte limit exceeded".to_string());
        }
        let mut reader = Reader {
            bytes,
            at: 0,
            limits,
        };
        for &byte in HEADER {
            reader.expect(byte)?;
        }
        let root_count = reader.count()?;
        let mut roots = Vec::new();
        for _ in 0..root_count {
            roots.push(reader.field()?);
            reader.expect(b'\n')?;
        }
        let link_count = reader.count()?;
        let mut links = Vec::new();
        for _ in 0..link_count {
            links.push((reader.field()?, reader.field()?, reader.field()?));
            reader.expect(b'\n')?;
        }
        let fact_count = reader.count()?;
        if link_count.saturating_add(fact_count) > limits.max_links {
            return Err("archive link limit exceeded".to_string());
        }
        let mut type_facts = Vec::new();
        for _ in 0..fact_count {
            type_facts.push((reader.field()?, reader.field()?, reader.field()?));
            reader.expect(b'\n')?;
        }
        if reader.at != bytes.len() {
            return Err("archive has trailing bytes".to_string());
        }
        Self::from_snapshot_with_limits(
            &TypedLinkNetworkSnapshot { links, type_facts },
            &roots,
            limits,
        )
    }
}
struct Writer {
    bytes: Vec<u8>,
    limits: ArchiveLimits,
}
impl Writer {
    fn put(&mut self, bytes: &[u8]) -> Result<(), String> {
        if self.bytes.len().saturating_add(bytes.len()) > self.limits.max_bytes {
            return Err("archive byte limit exceeded".to_string());
        }
        self.bytes.extend_from_slice(bytes);
        Ok(())
    }
    fn count(&mut self, count: usize) -> Result<(), String> {
        self.put(count.to_string().as_bytes())?;
        self.put(b"\n")
    }
    fn field(&mut self, value: &str) -> Result<(), String> {
        self.limits.field(value)?;
        self.put(value.len().to_string().as_bytes())?;
        self.put(b":")?;
        self.put(value.as_bytes())
    }
}
struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
    limits: ArchiveLimits,
}
impl Reader<'_> {
    fn expect(&mut self, byte: u8) -> Result<(), String> {
        if self.bytes.get(self.at) != Some(&byte) {
            return Err("invalid archive framing".to_string());
        }
        self.at += 1;
        Ok(())
    }
    fn natural(&mut self, end: u8) -> Result<usize, String> {
        let start = self.at;
        let mut value = 0usize;
        while self.at < self.bytes.len() && self.bytes[self.at] != end {
            let byte = self.bytes[self.at];
            self.at += 1;
            if !byte.is_ascii_digit() || self.at - start > 16 {
                return Err("invalid archive length".to_string());
            }
            value = value
                .checked_mul(10)
                .and_then(|n| n.checked_add((byte - b'0') as usize))
                .ok_or("invalid archive length")?;
            if value as u64 > 9_007_199_254_740_991u64 {
                return Err("invalid archive length".to_string());
            }
        }
        if self.at == start || self.at - start > 1 && self.bytes[start] == b'0' {
            return Err("non-canonical archive length".to_string());
        }
        self.expect(end)?;
        Ok(value)
    }
    fn count(&mut self) -> Result<usize, String> {
        let value = self.natural(b'\n')?;
        if value > self.limits.max_links {
            return Err("archive link limit exceeded".to_string());
        }
        Ok(value)
    }
    fn field(&mut self) -> Result<String, String> {
        let length = self.natural(b':')?;
        if length == 0 || length > self.limits.max_field_bytes {
            return Err("archive field limit exceeded".to_string());
        }
        if length > self.bytes.len() - self.at {
            return Err("truncated archive field".to_string());
        }
        let value = std::str::from_utf8(&self.bytes[self.at..self.at + length])
            .map_err(|_| "archive reference is not valid UTF-8")?
            .to_string();
        self.at += length;
        Ok(value)
    }
}
