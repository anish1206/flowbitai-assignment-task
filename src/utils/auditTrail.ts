import { v4 as uuidv4 } from 'uuid';
import { getDatabase, saveDatabase } from '../db/connection.js';
import { AuditEntry, AuditStep } from '../types/output.js';

export async function logAudit(
    invoiceId: string,
    step: AuditStep,
    details: string,
    memoryIds?: string[]
): Promise<AuditEntry> {
    const db = await getDatabase();
    const now = new Date().toISOString();
    const id = uuidv4();

    const entry: AuditEntry = {
        step,
        timestamp: now,
        details,
        memoryIds,
    };

    db.run(`
    INSERT INTO audit_logs (id, invoice_id, step, timestamp, details, memory_ids)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [
        id,
        invoiceId,
        step,
        now,
        details,
        memoryIds ? JSON.stringify(memoryIds) : null
    ]);

    saveDatabase();
    return entry;
}

export async function getAuditTrail(invoiceId: string): Promise<AuditEntry[]> {
    const db = await getDatabase();
    const result = db.exec(
        `SELECT * FROM audit_logs WHERE invoice_id = ? ORDER BY timestamp ASC`,
        [invoiceId]
    );

    if (result.length === 0) return [];

    const columns = result[0].columns;
    const getCol = (row: unknown[], name: string) => {
        const idx = columns.indexOf(name);
        return idx >= 0 ? row[idx] : null;
    };

    return result[0].values.map(row => ({
        step: getCol(row, 'step') as AuditStep,
        timestamp: getCol(row, 'timestamp') as string,
        details: getCol(row, 'details') as string,
        memoryIds: getCol(row, 'memory_ids') ? JSON.parse(getCol(row, 'memory_ids') as string) : undefined,
    }));
}

export function createAuditEntry(step: AuditStep, details: string, memoryIds?: string[]): AuditEntry {
    return {
        step,
        timestamp: new Date().toISOString(),
        details,
        memoryIds,
    };
}
