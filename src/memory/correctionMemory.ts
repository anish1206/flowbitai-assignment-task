import { v4 as uuidv4 } from 'uuid';
import { getDatabase, saveDatabase } from '../db/connection.js';
import { CorrectionMemory, CorrectionType } from '../types/memory.js';

export async function getCorrectionMemories(vendorName: string): Promise<CorrectionMemory[]> {
    const db = await getDatabase();
    const result = db.exec(
        `SELECT * FROM correction_memories WHERE vendor_name = ? ORDER BY confidence DESC`,
        [vendorName]
    );

    if (result.length === 0) return [];

    const columns = result[0].columns;
    const getCol = (row: unknown[], name: string) => {
        const idx = columns.indexOf(name);
        return idx >= 0 ? row[idx] : null;
    };

    return result[0].values.map(row => ({
        id: getCol(row, 'id') as string,
        vendorName: getCol(row, 'vendor_name') as string,
        fieldName: getCol(row, 'field_name') as string,
        pattern: getCol(row, 'pattern') as string,
        correctionType: getCol(row, 'correction_type') as CorrectionType,
        correctionValue: getCol(row, 'correction_value') ? JSON.parse(getCol(row, 'correction_value') as string) : undefined,
        confidence: getCol(row, 'confidence') as number,
        successCount: getCol(row, 'success_count') as number,
        failureCount: getCol(row, 'failure_count') as number,
        createdAt: getCol(row, 'created_at') as string,
        updatedAt: getCol(row, 'updated_at') as string,
    }));
}

export async function findMatchingCorrection(
    vendorName: string,
    fieldName: string,
    pattern?: string
): Promise<CorrectionMemory | null> {
    const corrections = await getCorrectionMemories(vendorName);

    // Find matching correction by field and optionally by pattern
    const matches = corrections.filter(c => {
        if (c.fieldName !== fieldName) return false;
        if (pattern && c.pattern) {
            return c.pattern.toLowerCase().includes(pattern.toLowerCase()) ||
                pattern.toLowerCase().includes(c.pattern.toLowerCase());
        }
        return true;
    });

    // Return the highest confidence match
    return matches.length > 0 ? matches[0] : null;
}

export async function recordCorrection(
    vendorName: string,
    fieldName: string,
    pattern: string,
    correctionType: CorrectionType,
    correctionValue?: unknown
): Promise<CorrectionMemory> {
    const db = await getDatabase();
    const now = new Date().toISOString();
    const id = uuidv4();

    // Check if similar correction already exists
    const existing = await findMatchingCorrection(vendorName, fieldName, pattern);

    if (existing) {
        // Reinforce existing correction
        await reinforceCorrection(existing.id);
        return { ...existing, successCount: existing.successCount + 1 };
    }

    const memory: CorrectionMemory = {
        id,
        vendorName,
        fieldName,
        pattern,
        correctionType,
        correctionValue,
        confidence: 0.6, // Initial confidence after first human correction
        successCount: 1,
        failureCount: 0,
        createdAt: now,
        updatedAt: now,
    };

    db.run(`
    INSERT INTO correction_memories 
    (id, vendor_name, field_name, pattern, correction_type, correction_value, confidence, success_count, failure_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
        id,
        vendorName,
        fieldName,
        pattern,
        correctionType,
        correctionValue ? JSON.stringify(correctionValue) : null,
        0.6,
        1,
        0,
        now,
        now
    ]);

    saveDatabase();
    return memory;
}

export async function reinforceCorrection(correctionId: string): Promise<void> {
    const db = await getDatabase();
    const now = new Date().toISOString();

    // Get current values
    const result = db.exec(`SELECT success_count, failure_count, confidence FROM correction_memories WHERE id = ?`, [correctionId]);

    if (result.length === 0 || result[0].values.length === 0) return;

    const row = result[0].values[0];
    const successCount = (row[0] as number) + 1;
    const failureCount = row[1] as number;
    const newConfidence = calculateCorrectionConfidence(successCount, failureCount);

    db.run(`
    UPDATE correction_memories 
    SET success_count = ?, confidence = ?, updated_at = ?
    WHERE id = ?
  `, [successCount, newConfidence, now, correctionId]);

    saveDatabase();
}

export async function weakenCorrection(correctionId: string): Promise<void> {
    const db = await getDatabase();
    const now = new Date().toISOString();

    // Get current values
    const result = db.exec(`SELECT success_count, failure_count, confidence FROM correction_memories WHERE id = ?`, [correctionId]);

    if (result.length === 0 || result[0].values.length === 0) return;

    const row = result[0].values[0];
    const successCount = row[0] as number;
    const failureCount = (row[1] as number) + 1;
    const newConfidence = calculateCorrectionConfidence(successCount, failureCount);

    db.run(`
    UPDATE correction_memories 
    SET failure_count = ?, confidence = ?, updated_at = ?
    WHERE id = ?
  `, [failureCount, newConfidence, now, correctionId]);

    saveDatabase();
}

function calculateCorrectionConfidence(successCount: number, failureCount: number): number {
    const total = successCount + failureCount;
    if (total === 0) return 0.5;

    // Success rate weighted by observations
    const successRate = successCount / total;

    // Minimum observations for high confidence
    const observationFactor = Math.min(1.0, total / 3);

    // Failures count more heavily (2x weight)
    const adjustedRate = successCount / (successCount + failureCount * 2);

    // Cap at 0.95 to always allow some human oversight
    return Math.min(0.95, Math.max(0.1, 0.3 + adjustedRate * 0.65 * observationFactor));
}

export async function getAllCorrectionMemories(): Promise<CorrectionMemory[]> {
    const db = await getDatabase();
    const result = db.exec(`SELECT * FROM correction_memories ORDER BY vendor_name, confidence DESC`);

    if (result.length === 0) return [];

    const columns = result[0].columns;
    const getCol = (row: unknown[], name: string) => {
        const idx = columns.indexOf(name);
        return idx >= 0 ? row[idx] : null;
    };

    return result[0].values.map(row => ({
        id: getCol(row, 'id') as string,
        vendorName: getCol(row, 'vendor_name') as string,
        fieldName: getCol(row, 'field_name') as string,
        pattern: getCol(row, 'pattern') as string,
        correctionType: getCol(row, 'correction_type') as CorrectionType,
        correctionValue: getCol(row, 'correction_value') ? JSON.parse(getCol(row, 'correction_value') as string) : undefined,
        confidence: getCol(row, 'confidence') as number,
        successCount: getCol(row, 'success_count') as number,
        failureCount: getCol(row, 'failure_count') as number,
        createdAt: getCol(row, 'created_at') as string,
        updatedAt: getCol(row, 'updated_at') as string,
    }));
}
