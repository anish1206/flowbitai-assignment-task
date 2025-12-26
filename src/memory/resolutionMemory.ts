import { v4 as uuidv4 } from 'uuid';
import { getDatabase, saveDatabase } from '../db/connection.js';
import { ResolutionMemory } from '../types/memory.js';

export async function getResolutionMemories(vendorName: string): Promise<ResolutionMemory[]> {
    const db = await getDatabase();
    const result = db.exec(
        `SELECT * FROM resolution_memories WHERE vendor_name = ? ORDER BY created_at DESC`,
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
        invoiceId: getCol(row, 'invoice_id') as string,
        vendorName: getCol(row, 'vendor_name') as string,
        discrepancyType: getCol(row, 'discrepancy_type') as string,
        originalValue: getCol(row, 'original_value') ? JSON.parse(getCol(row, 'original_value') as string) : null,
        correctedValue: getCol(row, 'corrected_value') ? JSON.parse(getCol(row, 'corrected_value') as string) : null,
        resolution: getCol(row, 'resolution') as 'approved' | 'rejected',
        humanFeedback: getCol(row, 'human_feedback') as string | undefined,
        createdAt: getCol(row, 'created_at') as string,
    }));
}

export async function recordResolution(
    invoiceId: string,
    vendorName: string,
    discrepancyType: string,
    originalValue: unknown,
    correctedValue: unknown,
    resolution: 'approved' | 'rejected',
    humanFeedback?: string
): Promise<ResolutionMemory> {
    const db = await getDatabase();
    const now = new Date().toISOString();
    const id = uuidv4();

    const memory: ResolutionMemory = {
        id,
        invoiceId,
        vendorName,
        discrepancyType,
        originalValue,
        correctedValue,
        resolution,
        humanFeedback,
        createdAt: now,
    };

    db.run(`
    INSERT INTO resolution_memories 
    (id, invoice_id, vendor_name, discrepancy_type, original_value, corrected_value, resolution, human_feedback, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
        id,
        invoiceId,
        vendorName,
        discrepancyType,
        JSON.stringify(originalValue),
        JSON.stringify(correctedValue),
        resolution,
        humanFeedback || null,
        now
    ]);

    saveDatabase();
    return memory;
}

export async function getResolutionStats(vendorName: string, discrepancyType: string): Promise<{
    approvedCount: number;
    rejectedCount: number;
    approvalRate: number;
}> {
    const resolutions = await getResolutionMemories(vendorName);
    const filtered = resolutions.filter(r => r.discrepancyType === discrepancyType);

    const approvedCount = filtered.filter(r => r.resolution === 'approved').length;
    const rejectedCount = filtered.filter(r => r.resolution === 'rejected').length;
    const total = approvedCount + rejectedCount;

    return {
        approvedCount,
        rejectedCount,
        approvalRate: total > 0 ? approvedCount / total : 0.5,
    };
}

export async function findSimilarResolutions(
    vendorName: string,
    discrepancyType: string,
    limit: number = 5
): Promise<ResolutionMemory[]> {
    const resolutions = await getResolutionMemories(vendorName);
    return resolutions
        .filter(r => r.discrepancyType === discrepancyType)
        .slice(0, limit);
}

export async function getAllResolutionMemories(): Promise<ResolutionMemory[]> {
    const db = await getDatabase();
    const result = db.exec(`SELECT * FROM resolution_memories ORDER BY created_at DESC`);

    if (result.length === 0) return [];

    const columns = result[0].columns;
    const getCol = (row: unknown[], name: string) => {
        const idx = columns.indexOf(name);
        return idx >= 0 ? row[idx] : null;
    };

    return result[0].values.map(row => ({
        id: getCol(row, 'id') as string,
        invoiceId: getCol(row, 'invoice_id') as string,
        vendorName: getCol(row, 'vendor_name') as string,
        discrepancyType: getCol(row, 'discrepancy_type') as string,
        originalValue: getCol(row, 'original_value') ? JSON.parse(getCol(row, 'original_value') as string) : null,
        correctedValue: getCol(row, 'corrected_value') ? JSON.parse(getCol(row, 'corrected_value') as string) : null,
        resolution: getCol(row, 'resolution') as 'approved' | 'rejected',
        humanFeedback: getCol(row, 'human_feedback') as string | undefined,
        createdAt: getCol(row, 'created_at') as string,
    }));
}
