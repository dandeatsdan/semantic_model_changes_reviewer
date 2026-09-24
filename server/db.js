import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import crypto from 'node:crypto'

export function createStore(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const db = new DatabaseSync(dbPath)
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finalised_at TEXT,
      reference_name TEXT NOT NULL,
      candidate_name TEXT NOT NULL,
      reference_fingerprint TEXT NOT NULL,
      candidate_fingerprint TEXT NOT NULL,
      reference_snapshot_json TEXT NOT NULL,
      candidate_snapshot_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS changes (
      review_id TEXT NOT NULL,
      change_id TEXT NOT NULL,
      object_type TEXT NOT NULL,
      object_path TEXT NOT NULL,
      object_name TEXT NOT NULL,
      change_type TEXT NOT NULL,
      property_changes_json TEXT NOT NULL,
      reference_object_json TEXT,
      candidate_object_json TEXT,
      review_status TEXT NOT NULL,
      review_comment TEXT NOT NULL DEFAULT '',
      reviewed_at TEXT,
      PRIMARY KEY (review_id, change_id),
      FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE
    );
  `)

  function hydrateReview(row, includeChanges = true) {
    if (!row) return null
    const review = {
      id: row.id, name: row.name, status: row.status,
      createdAt: row.created_at, updatedAt: row.updated_at, finalisedAt: row.finalised_at,
      reference: { name: row.reference_name, fingerprint: row.reference_fingerprint, snapshot: JSON.parse(row.reference_snapshot_json) },
      candidate: { name: row.candidate_name, fingerprint: row.candidate_fingerprint, snapshot: JSON.parse(row.candidate_snapshot_json) }
    }
    if (includeChanges) {
      const rows = db.prepare('SELECT * FROM changes WHERE review_id = ? ORDER BY object_type, object_path').all(row.id)
      review.changes = rows.map(c => ({
        id:c.change_id, objectType:c.object_type, objectPath:c.object_path, objectName:c.object_name,
        changeType:c.change_type, propertyChanges:JSON.parse(c.property_changes_json),
        referenceObject:c.reference_object_json ? JSON.parse(c.reference_object_json) : null,
        candidateObject:c.candidate_object_json ? JSON.parse(c.candidate_object_json) : null,
        reviewStatus:c.review_status, reviewComment:c.review_comment, reviewedAt:c.reviewed_at
      }))
      review.summary = summarise(review.changes)
    }
    return review
  }

  function summarise(changes) {
    const s = { total: changes.length, Added:0, Modified:0, Removed:0, Approved:0, Rejected:0, 'Needs Review':0, Unreviewed:0 }
    for (const c of changes) {
      s[c.changeType] = (s[c.changeType] ?? 0) + 1
      s[c.reviewStatus] = (s[c.reviewStatus] ?? 0) + 1
    }
    return s
  }

  return {
    create({ name, reference, candidate, comparison, referenceName, candidateName }) {
      const id = `SMR-${new Date().getUTCFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`
      const now = new Date().toISOString()
      db.prepare(`INSERT INTO reviews VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        id, name || id, 'In Review', now, now, null,
        referenceName, candidateName, reference.fingerprint, candidate.fingerprint,
        JSON.stringify(reference), JSON.stringify(candidate)
      )
      const stmt = db.prepare(`INSERT INTO changes VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      for (const c of comparison.changes) {
        stmt.run(id,c.id,c.objectType,c.objectPath,c.objectName,c.changeType,JSON.stringify(c.propertyChanges),
          c.referenceObject ? JSON.stringify(c.referenceObject) : null,
          c.candidateObject ? JSON.stringify(c.candidateObject) : null,
          c.reviewStatus,c.reviewComment,c.reviewedAt)
      }
      return this.get(id)
    },
    list() {
      const rows = db.prepare('SELECT * FROM reviews ORDER BY updated_at DESC').all()
      return rows.map(r => {
        const review = hydrateReview(r, true)
        delete review.reference.snapshot
        delete review.candidate.snapshot
        delete review.changes
        return review
      })
    },
    get(id) { return hydrateReview(db.prepare('SELECT * FROM reviews WHERE id = ?').get(id), true) },
    updateChange(reviewId, changeId, { status, comment }) {
      const review = db.prepare('SELECT status FROM reviews WHERE id=?').get(reviewId)
      if (!review) return null
      if (review.status === 'Finalised') throw new Error('Finalised reviews are read-only')
      const now = new Date().toISOString()
      db.prepare(`UPDATE changes SET review_status=?, review_comment=?, reviewed_at=? WHERE review_id=? AND change_id=?`).run(status, comment ?? '', status === 'Unreviewed' ? null : now, reviewId, changeId)
      db.prepare('UPDATE reviews SET updated_at=? WHERE id=?').run(now, reviewId)
      return this.get(reviewId)
    },
    finalise(id) {
      const review = this.get(id)
      if (!review) return null
      if ((review.summary.Unreviewed ?? 0) > 0 || (review.summary['Needs Review'] ?? 0) > 0) {
        const e = new Error('Resolve all Unreviewed and Needs Review changes before finalising')
        e.code = 'UNRESOLVED_CHANGES'
        throw e
      }
      const now = new Date().toISOString()
      db.prepare(`UPDATE reviews SET status='Finalised', finalised_at=?, updated_at=? WHERE id=?`).run(now, now, id)
      return this.get(id)
    },
    delete(id) {
      const existing = db.prepare('SELECT id FROM reviews WHERE id = ?').get(id)
      if (!existing) return false
      db.prepare('DELETE FROM reviews WHERE id = ?').run(id)
      return true
    },
    close() { db.close() }
  }
}
