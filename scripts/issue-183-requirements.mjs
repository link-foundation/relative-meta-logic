import fs from 'node:fs';

const REQUIREMENT_ROW = /^\| R(\d+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/gm;
const DELIVERED_STATUS = /^Complete(?: |$)/;
const TRACKED_STATUS = /^(?:Complete|Partial|Open|Blocked by upstream)(?: |$)/;

function parseIssue183Requirements(ledger) {
  return [...ledger.matchAll(REQUIREMENT_ROW)].map(match => ({
    id: Number(match[1]),
    requirement: match[2].trim(),
    status: match[3].trim(),
    evidence: match[4].trim(),
  }));
}

function incompleteIssue183Requirements(ledger) {
  return parseIssue183Requirements(ledger).filter(row => !DELIVERED_STATUS.test(row.status));
}

function assertTrackedIssue183Status(status) {
  if (!TRACKED_STATUS.test(status)) {
    throw new Error(`unsupported issue 183 status: ${status}`);
  }
}

function assertIssue183Complete(ledger) {
  const incomplete = incompleteIssue183Requirements(ledger);
  if (incomplete.length > 0) {
    const summary = incomplete.map(row => `R${row.id} (${row.status})`).join(', ');
    throw new Error(`issue 183 is not complete: ${summary}`);
  }
}

function readIssue183Requirements(path) {
  return fs.readFileSync(path, 'utf8');
}

export {
  assertIssue183Complete,
  assertTrackedIssue183Status,
  incompleteIssue183Requirements,
  parseIssue183Requirements,
  readIssue183Requirements,
};
