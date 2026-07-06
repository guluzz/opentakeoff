// Backup-staleness helpers — pure functions behind the gallery's "Backed up N
// ago" readout. Kept here (not inline in the canvas) so the signature logic that
// decides "does your saved .zip still match your work?" is unit-testable: a false
// "backed up" is the dangerous case, so it's worth a test.

// djb2 string hash → unsigned 32-bit in base36. Deterministic; enough to detect
// any change in the serialized takeoff.
export function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// A stable signature of an annotations payload — same content → same string,
// independent of key order noise (we pin the field order explicitly).
export function payloadSig(p) {
  return hashStr(JSON.stringify([
    p.project_name, p.sheets, p.conditions, p.shapes, p.markups,
    p.sheet_group, p.last_group, p.sheet_tabs,
  ]));
}

// Decide the backup-badge state from the live signature and what we last exported.
// Pure so the safety-critical distinction — a CONFIRMED file backup (green) vs an
// UNVERIFIABLE download (never green) vs stale — is unit-tested. A download whose
// save dialog the user may have cancelled must never read as "backed up".
//   confirmed → a File System Access write we watched finish, still matching
//   downloaded → a browser download of exactly this work, completion unknown
//   edited     → there's a prior backup/export, but the work changed since
//   never      → nothing has ever been exported
export function backupState({ sig, exportedSig, exportedAt, downloadSig, downloadAt }) {
  if (exportedAt && sig === exportedSig) return { tone: "ok", reason: "confirmed" };
  if (downloadAt && sig === downloadSig) return { tone: "info", reason: "downloaded" };
  if (exportedAt || downloadAt) return { tone: "warn", reason: "edited" };
  return { tone: "warn", reason: "never" };
}

// "just now" / "5 min ago" / "2 h ago" / "3 d ago" — coarse is fine for a backup age.
export function relTime(then, now) {
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}
