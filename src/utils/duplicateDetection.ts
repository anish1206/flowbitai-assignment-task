import { v4 as uuidv4 } from 'uuid';
import { getDatabase, saveDatabase } from '../db/connection.js';
import { ProcessedInvoice } from '../types/memory.js';
import { Invoice } from '../types/invoice.js';
import * as crypto from 'crypto';

export function generateInvoiceHash(invoice: Invoice): string {
    const hashData = `${invoice.vendor}|${invoice.fields.invoiceNumber}|${invoice.fields.grossTotal}`;
    return crypto.createHash('md5').update(hashData).digest('hex');
}

export async function checkDuplicate(invoice: Invoice): Promise<ProcessedInvoice | null> {
    const db = await getDatabase();

    // Look for invoices with same vendor and invoice number
    const result = db.exec(`
    SELECT * FROM processed_invoices 
    WHERE vendor_name = ? AND invoice_number = ?
    ORDER BY processed_at DESC
  `, [invoice.vendor, invoice.fields.invoiceNumber]);

    if (result.length === 0 || result[0].values.length === 0) {
        return null;
    }

    const columns = result[0].columns;
    const getCol = (row: unknown[], name: string) => {
        const idx = columns.indexOf(name);
        return idx >= 0 ? row[idx] : null;
    };

    const row = result[0].values[0];
    const existingInvoice: ProcessedInvoice = {
        id: getCol(row, 'id') as string,
        invoiceNumber: getCol(row, 'invoice_number') as string,
        vendorName: getCol(row, 'vendor_name') as string,
        invoiceDate: getCol(row, 'invoice_date') as string,
        grossTotal: getCol(row, 'gross_total') as number,
        processedAt: getCol(row, 'processed_at') as string,
        hash: getCol(row, 'hash') as string,
    };

    // Check if dates are within 7 days
    const existingDate = parseDate(existingInvoice.invoiceDate);
    const newDate = parseDate(invoice.fields.invoiceDate);

    if (existingDate && newDate) {
        const daysDiff = Math.abs((newDate.getTime() - existingDate.getTime()) / (1000 * 60 * 60 * 24));

        if (daysDiff <= 7) {
            // Check if amounts are within 1% tolerance
            const amountDiff = Math.abs(existingInvoice.grossTotal - invoice.fields.grossTotal);
            const tolerance = existingInvoice.grossTotal * 0.01;

            if (amountDiff <= tolerance) {
                return existingInvoice;
            }
        }
    }

    // Also check by hash for exact matches
    const hash = generateInvoiceHash(invoice);
    if (existingInvoice.hash === hash) {
        return existingInvoice;
    }

    return null;
}

export async function recordProcessedInvoice(invoice: Invoice): Promise<void> {
    const db = await getDatabase();
    const now = new Date().toISOString();
    const id = uuidv4();
    const hash = generateInvoiceHash(invoice);

    db.run(`
    INSERT INTO processed_invoices 
    (id, invoice_number, vendor_name, invoice_date, gross_total, processed_at, hash)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
        id,
        invoice.fields.invoiceNumber,
        invoice.vendor,
        invoice.fields.invoiceDate,
        invoice.fields.grossTotal,
        now,
        hash
    ]);

    saveDatabase();
}

function parseDate(dateStr: string): Date | null {
    // Handle different date formats: DD.MM.YYYY, DD-MM-YYYY, YYYY-MM-DD
    if (!dateStr) return null;

    // Try DD.MM.YYYY format
    let match = dateStr.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (match) {
        return new Date(parseInt(match[3]), parseInt(match[2]) - 1, parseInt(match[1]));
    }

    // Try DD-MM-YYYY format
    match = dateStr.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (match) {
        return new Date(parseInt(match[3]), parseInt(match[2]) - 1, parseInt(match[1]));
    }

    // Try YYYY-MM-DD format
    match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
        return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
    }

    return null;
}

export async function getAllProcessedInvoices(): Promise<ProcessedInvoice[]> {
    const db = await getDatabase();
    const result = db.exec(`SELECT * FROM processed_invoices ORDER BY processed_at DESC`);

    if (result.length === 0) return [];

    const columns = result[0].columns;
    const getCol = (row: unknown[], name: string) => {
        const idx = columns.indexOf(name);
        return idx >= 0 ? row[idx] : null;
    };

    return result[0].values.map(row => ({
        id: getCol(row, 'id') as string,
        invoiceNumber: getCol(row, 'invoice_number') as string,
        vendorName: getCol(row, 'vendor_name') as string,
        invoiceDate: getCol(row, 'invoice_date') as string,
        grossTotal: getCol(row, 'gross_total') as number,
        processedAt: getCol(row, 'processed_at') as string,
        hash: getCol(row, 'hash') as string,
    }));
}
