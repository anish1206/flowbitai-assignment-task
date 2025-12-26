import { v4 as uuidv4 } from 'uuid';
import { getDatabase, saveDatabase } from '../db/connection.js';
import { VendorMemory, FieldMapping, TaxBehavior, SkuMapping } from '../types/memory.js';

export async function getVendorMemory(vendorName: string): Promise<VendorMemory | null> {
    const db = await getDatabase();
    const result = db.exec(`SELECT * FROM vendor_memories WHERE vendor_name = ?`, [vendorName]);

    if (result.length === 0 || result[0].values.length === 0) {
        return null;
    }

    const row = result[0].values[0];
    const columns = result[0].columns;

    const getCol = (name: string) => {
        const idx = columns.indexOf(name);
        return idx >= 0 ? row[idx] : null;
    };

    return {
        id: getCol('id') as string,
        vendorName: getCol('vendor_name') as string,
        fieldMappings: JSON.parse((getCol('field_mappings') as string) || '[]'),
        taxBehavior: getCol('tax_behavior') ? JSON.parse(getCol('tax_behavior') as string) : undefined,
        defaultCurrency: getCol('default_currency') as string | undefined,
        skuMappings: JSON.parse((getCol('sku_mappings') as string) || '[]'),
        paymentTerms: getCol('payment_terms') as string | undefined,
        confidence: getCol('confidence') as number,
        usageCount: getCol('usage_count') as number,
        lastUsed: getCol('last_used') as string,
        createdAt: getCol('created_at') as string,
        updatedAt: getCol('updated_at') as string,
    };
}

export async function createVendorMemory(vendorName: string): Promise<VendorMemory> {
    const db = await getDatabase();
    const now = new Date().toISOString();
    const id = uuidv4();

    const memory: VendorMemory = {
        id,
        vendorName,
        fieldMappings: [],
        skuMappings: [],
        confidence: 0.5,
        usageCount: 0,
        lastUsed: now,
        createdAt: now,
        updatedAt: now,
    };

    db.run(`
    INSERT INTO vendor_memories (id, vendor_name, field_mappings, sku_mappings, confidence, usage_count, last_used, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [id, vendorName, '[]', '[]', 0.5, 0, now, now, now]);

    saveDatabase();
    return memory;
}

export async function updateFieldMapping(
    vendorName: string,
    sourceLabel: string,
    targetField: string,
    success: boolean
): Promise<void> {
    const db = await getDatabase();
    let memory = await getVendorMemory(vendorName);

    if (!memory) {
        memory = await createVendorMemory(vendorName);
    }

    const existingMapping = memory.fieldMappings.find(
        m => m.sourceLabel.toLowerCase() === sourceLabel.toLowerCase() && m.targetField === targetField
    );

    if (existingMapping) {
        if (success) {
            existingMapping.successCount++;
            existingMapping.confidence = calculateConfidence(existingMapping.successCount, existingMapping.failureCount);
        } else {
            existingMapping.failureCount++;
            existingMapping.confidence = calculateConfidence(existingMapping.successCount, existingMapping.failureCount);
        }
    } else {
        memory.fieldMappings.push({
            sourceLabel,
            targetField,
            confidence: success ? 0.6 : 0.3,
            successCount: success ? 1 : 0,
            failureCount: success ? 0 : 1,
        });
    }

    const now = new Date().toISOString();
    memory.usageCount++;
    memory.confidence = calculateOverallConfidence(memory);

    db.run(`
    UPDATE vendor_memories 
    SET field_mappings = ?, confidence = ?, usage_count = ?, last_used = ?, updated_at = ?
    WHERE vendor_name = ?
  `, [JSON.stringify(memory.fieldMappings), memory.confidence, memory.usageCount, now, now, vendorName]);

    saveDatabase();
}

export async function updateTaxBehavior(
    vendorName: string,
    isInclusive: boolean,
    defaultRate: number,
    success: boolean
): Promise<void> {
    const db = await getDatabase();
    let memory = await getVendorMemory(vendorName);

    if (!memory) {
        memory = await createVendorMemory(vendorName);
    }

    if (memory.taxBehavior) {
        const newConfidence = success
            ? Math.min(1.0, memory.taxBehavior.confidence + 0.1)
            : Math.max(0.1, memory.taxBehavior.confidence - 0.2);
        memory.taxBehavior.confidence = newConfidence;
    } else {
        memory.taxBehavior = {
            isInclusive,
            defaultRate,
            confidence: success ? 0.6 : 0.3,
        };
    }

    const now = new Date().toISOString();
    memory.usageCount++;
    memory.confidence = calculateOverallConfidence(memory);

    db.run(`
    UPDATE vendor_memories 
    SET tax_behavior = ?, confidence = ?, usage_count = ?, last_used = ?, updated_at = ?
    WHERE vendor_name = ?
  `, [JSON.stringify(memory.taxBehavior), memory.confidence, memory.usageCount, now, now, vendorName]);

    saveDatabase();
}

export async function updateDefaultCurrency(vendorName: string, currency: string): Promise<void> {
    const db = await getDatabase();
    let memory = await getVendorMemory(vendorName);

    if (!memory) {
        memory = await createVendorMemory(vendorName);
    }

    const now = new Date().toISOString();
    memory.usageCount++;

    db.run(`
    UPDATE vendor_memories 
    SET default_currency = ?, usage_count = ?, last_used = ?, updated_at = ?
    WHERE vendor_name = ?
  `, [currency, memory.usageCount, now, now, vendorName]);

    saveDatabase();
}

export async function updateSkuMapping(
    vendorName: string,
    description: string,
    sku: string,
    success: boolean
): Promise<void> {
    const db = await getDatabase();
    let memory = await getVendorMemory(vendorName);

    if (!memory) {
        memory = await createVendorMemory(vendorName);
    }

    const normalizedDesc = description.toLowerCase().trim();
    const existingMapping = memory.skuMappings.find(
        m => m.description.toLowerCase().includes(normalizedDesc) || normalizedDesc.includes(m.description.toLowerCase())
    );

    if (existingMapping) {
        if (success) {
            existingMapping.usageCount++;
            existingMapping.confidence = Math.min(1.0, existingMapping.confidence + 0.1);
        } else {
            existingMapping.confidence = Math.max(0.1, existingMapping.confidence - 0.2);
        }
    } else {
        memory.skuMappings.push({
            description: normalizedDesc,
            sku,
            confidence: success ? 0.6 : 0.3,
            usageCount: 1,
        });
    }

    const now = new Date().toISOString();
    memory.usageCount++;
    memory.confidence = calculateOverallConfidence(memory);

    db.run(`
    UPDATE vendor_memories 
    SET sku_mappings = ?, confidence = ?, usage_count = ?, last_used = ?, updated_at = ?
    WHERE vendor_name = ?
  `, [JSON.stringify(memory.skuMappings), memory.confidence, memory.usageCount, now, now, vendorName]);

    saveDatabase();
}

export async function updatePaymentTerms(vendorName: string, terms: string): Promise<void> {
    const db = await getDatabase();
    let memory = await getVendorMemory(vendorName);

    if (!memory) {
        memory = await createVendorMemory(vendorName);
    }

    const now = new Date().toISOString();
    memory.usageCount++;

    db.run(`
    UPDATE vendor_memories 
    SET payment_terms = ?, usage_count = ?, last_used = ?, updated_at = ?
    WHERE vendor_name = ?
  `, [terms, memory.usageCount, now, now, vendorName]);

    saveDatabase();
}

export async function recordVendorUsage(vendorName: string): Promise<void> {
    const db = await getDatabase();
    const memory = await getVendorMemory(vendorName);

    if (memory) {
        const now = new Date().toISOString();
        db.run(`
      UPDATE vendor_memories 
      SET usage_count = usage_count + 1, last_used = ?, updated_at = ?
      WHERE vendor_name = ?
    `, [now, now, vendorName]);
        saveDatabase();
    }
}

function calculateConfidence(successCount: number, failureCount: number): number {
    const total = successCount + failureCount;
    if (total === 0) return 0.5;

    // Base confidence on success rate with minimum observations requirement
    const successRate = successCount / total;

    // Reduce confidence if we have few observations
    const observationFactor = Math.min(1.0, total / 3);

    return Math.min(0.95, 0.3 + (successRate * 0.65 * observationFactor));
}

function calculateOverallConfidence(memory: VendorMemory): number {
    const confidences: number[] = [];

    // Add field mapping confidences
    memory.fieldMappings.forEach(m => confidences.push(m.confidence));

    // Add tax behavior confidence
    if (memory.taxBehavior) {
        confidences.push(memory.taxBehavior.confidence);
    }

    // Add SKU mapping confidences
    memory.skuMappings.forEach(m => confidences.push(m.confidence));

    if (confidences.length === 0) return 0.5;

    // Weighted average with usage count
    const avg = confidences.reduce((a, b) => a + b, 0) / confidences.length;
    const usageFactor = Math.min(1.0, memory.usageCount / 5);

    return 0.3 + (avg * 0.7 * usageFactor);
}

export async function getAllVendorMemories(): Promise<VendorMemory[]> {
    const db = await getDatabase();
    const result = db.exec(`SELECT * FROM vendor_memories`);

    if (result.length === 0) return [];

    const columns = result[0].columns;
    const getCol = (row: unknown[], name: string) => {
        const idx = columns.indexOf(name);
        return idx >= 0 ? row[idx] : null;
    };

    return result[0].values.map(row => ({
        id: getCol(row, 'id') as string,
        vendorName: getCol(row, 'vendor_name') as string,
        fieldMappings: JSON.parse((getCol(row, 'field_mappings') as string) || '[]'),
        taxBehavior: getCol(row, 'tax_behavior') ? JSON.parse(getCol(row, 'tax_behavior') as string) : undefined,
        defaultCurrency: getCol(row, 'default_currency') as string | undefined,
        skuMappings: JSON.parse((getCol(row, 'sku_mappings') as string) || '[]'),
        paymentTerms: getCol(row, 'payment_terms') as string | undefined,
        confidence: getCol(row, 'confidence') as number,
        usageCount: getCol(row, 'usage_count') as number,
        lastUsed: getCol(row, 'last_used') as string,
        createdAt: getCol(row, 'created_at') as string,
        updatedAt: getCol(row, 'updated_at') as string,
    }));
}
