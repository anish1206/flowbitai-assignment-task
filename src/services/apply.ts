import { Invoice, PurchaseOrder } from '../types/invoice.js';
import { RecalledMemories, VendorMemory } from '../types/memory.js';
import { ProposedCorrection, AuditEntry, NormalizedInvoice, NormalizedLineItem } from '../types/output.js';
import { createAuditEntry } from '../utils/auditTrail.js';

// Confidence thresholds
const AUTO_APPLY_THRESHOLD = 0.85;
const PROPOSE_THRESHOLD = 0.60;
const ESCALATE_THRESHOLD = 0.40;

export interface ApplyResult {
    normalizedInvoice: NormalizedInvoice;
    proposedCorrections: ProposedCorrection[];
    auditEntry: AuditEntry;
}

/**
 * Apply Service - Applies memory-based corrections to normalize the invoice
 */
export async function applyMemories(
    invoice: Invoice,
    memories: RecalledMemories,
    purchaseOrders?: PurchaseOrder[]
): Promise<ApplyResult> {
    const corrections: ProposedCorrection[] = [];
    const details: string[] = [];
    const memoryIds: string[] = [];

    // Start with a copy of the original fields
    const normalized: NormalizedInvoice = {
        invoiceId: invoice.invoiceId,
        vendor: invoice.vendor,
        invoiceNumber: invoice.fields.invoiceNumber,
        invoiceDate: invoice.fields.invoiceDate,
        serviceDate: invoice.fields.serviceDate || undefined,
        currency: invoice.fields.currency || 'EUR',
        poNumber: invoice.fields.poNumber || undefined,
        netTotal: invoice.fields.netTotal,
        taxRate: invoice.fields.taxRate,
        taxTotal: invoice.fields.taxTotal,
        grossTotal: invoice.fields.grossTotal,
        lineItems: normalizeLineItems(invoice.fields.lineItems),
        discountTerms: invoice.fields.discountTerms || undefined,
    };

    const vendorMemory = memories.vendorMemory;

    // 1. Apply field mappings (e.g., extract serviceDate from rawText using Leistungsdatum pattern)
    if (vendorMemory) {
        memoryIds.push(vendorMemory.id);

        // Check for serviceDate extraction
        if (!normalized.serviceDate) {
            const serviceDateMapping = vendorMemory.fieldMappings.find(m => m.targetField === 'serviceDate');
            if (serviceDateMapping) {
                const extractedDate = extractFromRawText(invoice.rawText, serviceDateMapping.sourceLabel);
                if (extractedDate) {
                    const correction: ProposedCorrection = {
                        field: 'serviceDate',
                        originalValue: null,
                        proposedValue: extractedDate,
                        confidence: serviceDateMapping.confidence,
                        reasoning: `Extracted from rawText using learned pattern "${serviceDateMapping.sourceLabel}" → serviceDate (confidence: ${(serviceDateMapping.confidence * 100).toFixed(1)}%)`,
                        autoApplied: serviceDateMapping.confidence >= AUTO_APPLY_THRESHOLD,
                    };
                    corrections.push(correction);

                    if (correction.autoApplied) {
                        normalized.serviceDate = extractedDate;
                        details.push(`Auto-applied: serviceDate = "${extractedDate}" from "${serviceDateMapping.sourceLabel}"`);
                    } else {
                        details.push(`Proposed: serviceDate = "${extractedDate}" (needs review)`);
                    }
                }
            }
        }

        // 2. Apply tax behavior corrections
        if (vendorMemory.taxBehavior && vendorMemory.taxBehavior.isInclusive) {
            // Check if rawText indicates VAT inclusive
            const vatInclusiveIndicators = ['inkl.', 'incl.', 'included', 'inclusive', 'mwst. inkl'];
            const hasVatInclusive = vatInclusiveIndicators.some(ind =>
                invoice.rawText.toLowerCase().includes(ind.toLowerCase())
            );

            if (hasVatInclusive) {
                // Recalculate tax and gross total
                const recalculatedGross = recalculateGrossFromRawText(invoice.rawText, normalized.grossTotal);
                if (recalculatedGross && recalculatedGross !== normalized.grossTotal) {
                    const recalculatedTax = recalculatedGross - normalized.netTotal;

                    const correction: ProposedCorrection = {
                        field: 'grossTotal',
                        originalValue: normalized.grossTotal,
                        proposedValue: recalculatedGross,
                        confidence: vendorMemory.taxBehavior.confidence,
                        reasoning: `VAT inclusive pricing detected. Recalculated from rawText (confidence: ${(vendorMemory.taxBehavior.confidence * 100).toFixed(1)}%)`,
                        autoApplied: vendorMemory.taxBehavior.confidence >= AUTO_APPLY_THRESHOLD,
                    };
                    corrections.push(correction);

                    const taxCorrection: ProposedCorrection = {
                        field: 'taxTotal',
                        originalValue: normalized.taxTotal,
                        proposedValue: recalculatedTax,
                        confidence: vendorMemory.taxBehavior.confidence,
                        reasoning: `Tax recalculated based on VAT inclusive grossTotal`,
                        autoApplied: vendorMemory.taxBehavior.confidence >= AUTO_APPLY_THRESHOLD,
                    };
                    corrections.push(taxCorrection);

                    if (correction.autoApplied) {
                        normalized.grossTotal = recalculatedGross;
                        normalized.taxTotal = recalculatedTax;
                        details.push(`Auto-applied: VAT recalculation (gross: ${recalculatedGross}, tax: ${recalculatedTax.toFixed(2)})`);
                    } else {
                        details.push(`Proposed: VAT recalculation needs review`);
                    }
                }
            }
        }

        // 3. Apply currency from memory or rawText
        if (!invoice.fields.currency) {
            if (vendorMemory.defaultCurrency) {
                const correction: ProposedCorrection = {
                    field: 'currency',
                    originalValue: null,
                    proposedValue: vendorMemory.defaultCurrency,
                    confidence: 0.75,
                    reasoning: `Currency recovered from vendor memory (default currency)`,
                    autoApplied: false,
                };
                corrections.push(correction);
                details.push(`Proposed: currency = "${vendorMemory.defaultCurrency}" from vendor memory`);
            } else {
                // Try to extract from rawText
                const extractedCurrency = extractCurrencyFromRawText(invoice.rawText);
                if (extractedCurrency) {
                    const correction: ProposedCorrection = {
                        field: 'currency',
                        originalValue: null,
                        proposedValue: extractedCurrency,
                        confidence: 0.7,
                        reasoning: `Currency recovered from rawText`,
                        autoApplied: false,
                    };
                    corrections.push(correction);
                    normalized.currency = extractedCurrency;
                    details.push(`Proposed: currency = "${extractedCurrency}" from rawText`);
                }
            }
        }

        // 4. Apply SKU mappings
        for (let i = 0; i < normalized.lineItems.length; i++) {
            const item = normalized.lineItems[i];
            if (!item.sku || item.sku === 'UNKNOWN') {
                const skuMapping = vendorMemory.skuMappings.find(m =>
                    item.description.toLowerCase().includes(m.description.toLowerCase()) ||
                    m.description.toLowerCase().includes(item.description.toLowerCase())
                );

                if (skuMapping) {
                    const correction: ProposedCorrection = {
                        field: `lineItems[${i}].sku`,
                        originalValue: item.sku || null,
                        proposedValue: skuMapping.sku,
                        confidence: skuMapping.confidence,
                        reasoning: `SKU mapped from description "${item.description}" → "${skuMapping.sku}" (confidence: ${(skuMapping.confidence * 100).toFixed(1)}%)`,
                        autoApplied: skuMapping.confidence >= AUTO_APPLY_THRESHOLD,
                    };
                    corrections.push(correction);

                    if (correction.autoApplied) {
                        item.sku = skuMapping.sku;
                        details.push(`Auto-applied: SKU mapping "${item.description}" → "${skuMapping.sku}"`);
                    } else {
                        details.push(`Proposed: SKU mapping needs review`);
                    }
                }
            }
        }

        // 5. Apply payment terms
        if (vendorMemory.paymentTerms && !normalized.discountTerms) {
            normalized.discountTerms = vendorMemory.paymentTerms;
            details.push(`Applied known payment terms: "${vendorMemory.paymentTerms}"`);
        }
    }

    // 6. Try to extract payment terms from rawText (Skonto detection)
    if (!normalized.discountTerms) {
        const extractedTerms = extractPaymentTerms(invoice.rawText);
        if (extractedTerms) {
            const correction: ProposedCorrection = {
                field: 'discountTerms',
                originalValue: null,
                proposedValue: extractedTerms,
                confidence: 0.8,
                reasoning: `Payment/discount terms extracted from rawText`,
                autoApplied: false,
            };
            corrections.push(correction);
            normalized.discountTerms = extractedTerms;
            details.push(`Detected payment terms: "${extractedTerms}"`);
        }
    }

    // 7. Try to match PO if missing
    if (!normalized.poNumber && purchaseOrders && purchaseOrders.length > 0) {
        const matchedPO = matchPurchaseOrder(invoice, purchaseOrders);
        if (matchedPO) {
            const correction: ProposedCorrection = {
                field: 'poNumber',
                originalValue: null,
                proposedValue: matchedPO.poNumber,
                confidence: matchedPO.confidence,
                reasoning: matchedPO.reasoning,
                autoApplied: matchedPO.confidence >= AUTO_APPLY_THRESHOLD,
            };
            corrections.push(correction);

            if (correction.autoApplied) {
                normalized.poNumber = matchedPO.poNumber;
                details.push(`Auto-applied: PO match "${matchedPO.poNumber}"`);
            } else {
                details.push(`Proposed: PO match "${matchedPO.poNumber}" needs review`);
            }
        }
    }

    const auditEntry = createAuditEntry(
        'apply',
        details.length > 0 ? details.join('; ') : 'No corrections applied',
        memoryIds.length > 0 ? memoryIds : undefined
    );

    return {
        normalizedInvoice: normalized,
        proposedCorrections: corrections,
        auditEntry,
    };
}

function normalizeLineItems(items: Invoice['fields']['lineItems']): NormalizedLineItem[] {
    return items.map(item => ({
        sku: item.sku || 'UNKNOWN',
        description: item.description || '',
        qty: item.qty,
        unitPrice: item.unitPrice,
        amount: item.qty * item.unitPrice,
    }));
}

function extractFromRawText(rawText: string, label: string): string | null {
    // Common patterns: "Label: Value" or "Label Value"
    const patterns = [
        new RegExp(`${label}[:\\s]+([\\d]{1,2}[./][\\d]{1,2}[./][\\d]{2,4})`, 'i'),
        new RegExp(`${label}[:\\s]+([\\d]{4}-[\\d]{2}-[\\d]{2})`, 'i'),
    ];

    for (const pattern of patterns) {
        const match = rawText.match(pattern);
        if (match) {
            return convertToISODate(match[1]);
        }
    }

    return null;
}

function convertToISODate(dateStr: string): string {
    // DD.MM.YYYY or DD/MM/YYYY
    let match = dateStr.match(/(\d{1,2})[./](\d{1,2})[./](\d{2,4})/);
    if (match) {
        const day = match[1].padStart(2, '0');
        const month = match[2].padStart(2, '0');
        let year = match[3];
        if (year.length === 2) {
            year = '20' + year;
        }
        return `${year}-${month}-${day}`;
    }
    return dateStr;
}

function extractCurrencyFromRawText(rawText: string): string | null {
    const currencyPatterns = [
        /Currency[:\s]+([A-Z]{3})/i,
        /\b(EUR|USD|GBP|CHF)\b/i,
    ];

    for (const pattern of currencyPatterns) {
        const match = rawText.match(pattern);
        if (match) {
            return match[1].toUpperCase();
        }
    }

    return null;
}

function extractPaymentTerms(rawText: string): string | null {
    // Look for Skonto/discount patterns
    const patterns = [
        /(\d+%\s*Skonto\s*(?:if|within|bei)\s*(?:paid\s*)?(?:within\s*)?\d+\s*(?:days|Tage)?)/i,
        /(Skonto[:\s]+\d+%[^.]*)/i,
        /(\d+%\s*discount\s*(?:if|within)\s*\d+\s*days)/i,
    ];

    for (const pattern of patterns) {
        const match = rawText.match(pattern);
        if (match) {
            return match[1].trim();
        }
    }

    return null;
}

function recalculateGrossFromRawText(rawText: string, currentGross: number): number | null {
    // Look for total amount in rawText
    const patterns = [
        /Total[:\s]+([0-9,.]+)\s*(?:EUR)?/i,
        /Gesamt[:\s]+([0-9,.]+)\s*(?:EUR)?/i,
        /Brutto[:\s]+([0-9,.]+)\s*(?:EUR)?/i,
    ];

    for (const pattern of patterns) {
        const match = rawText.match(pattern);
        if (match) {
            const amount = parseFloat(match[1].replace(',', '.'));
            if (!isNaN(amount) && amount !== currentGross) {
                return amount;
            }
        }
    }

    return null;
}

interface POMatch {
    poNumber: string;
    confidence: number;
    reasoning: string;
}

function matchPurchaseOrder(invoice: Invoice, purchaseOrders: PurchaseOrder[]): POMatch | null {
    // Filter POs for this vendor
    const vendorPOs = purchaseOrders.filter(po => po.vendor === invoice.vendor);

    if (vendorPOs.length === 0) return null;

    // Try to find matching PO based on line items
    const invoiceSKUs = invoice.fields.lineItems.map(i => i.sku).filter(Boolean);

    let bestMatch: POMatch | null = null;

    for (const po of vendorPOs) {
        const poSKUs = po.lineItems.map(i => i.sku);
        const matchingSKUs = invoiceSKUs.filter(sku => poSKUs.includes(sku));

        if (matchingSKUs.length > 0) {
            // Calculate match confidence based on SKU overlap and date proximity
            const skuMatchRatio = matchingSKUs.length / Math.max(invoiceSKUs.length, poSKUs.length);

            // If only one matching PO, higher confidence
            const uniquenessBonus = vendorPOs.length === 1 ? 0.2 : 0;

            const confidence = Math.min(0.95, 0.5 + skuMatchRatio * 0.3 + uniquenessBonus);

            if (!bestMatch || confidence > bestMatch.confidence) {
                bestMatch = {
                    poNumber: po.poNumber,
                    confidence,
                    reasoning: `Matched PO ${po.poNumber} based on SKU overlap (${matchingSKUs.join(', ')})${vendorPOs.length === 1 ? ' - only matching PO for vendor' : ''}`,
                };
            }
        }
    }

    // If we have exactly one PO and any line item matches, suggest it
    if (!bestMatch && vendorPOs.length === 1) {
        bestMatch = {
            poNumber: vendorPOs[0].poNumber,
            confidence: 0.6,
            reasoning: `Only one PO (${vendorPOs[0].poNumber}) exists for vendor "${invoice.vendor}" within recent timeframe`,
        };
    }

    return bestMatch;
}
