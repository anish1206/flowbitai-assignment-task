import * as fs from 'fs';
import * as path from 'path';
import {
    processInvoice,
    applyHumanCorrection,
    getAllMemories,
    resetAllMemories,
    shutdown
} from '../src/index.js';
import { Invoice, PurchaseOrder, HumanCorrection } from '../src/types/invoice.js';

// Simple test without colors
async function runTest() {
    console.log('=== INVOICE MEMORY LAYER - SIMPLE TEST ===\n');

    // Reset for clean test
    resetAllMemories();

    const dataDir = path.join(process.cwd(), 'data');
    const invoices: Invoice[] = JSON.parse(fs.readFileSync(path.join(dataDir, 'invoices.json'), 'utf-8'));
    const purchaseOrders: PurchaseOrder[] = JSON.parse(fs.readFileSync(path.join(dataDir, 'purchase_orders.json'), 'utf-8'));
    const corrections: HumanCorrection[] = JSON.parse(fs.readFileSync(path.join(dataDir, 'human_corrections.json'), 'utf-8'));

    // Test 1: Process first invoice (no memory)
    console.log('TEST 1: First invoice processing (no memory)');
    const inv1 = invoices.find(i => i.invoiceId === 'INV-A-001')!;
    const result1 = await processInvoice(inv1, { purchaseOrders });
    console.log(`  - Invoice: ${result1.normalizedInvoice.invoiceId}`);
    console.log(`  - Requires Review: ${result1.requiresHumanReview}`);
    console.log(`  - Confidence: ${(result1.confidenceScore * 100).toFixed(1)}%`);
    console.log(`  - ServiceDate: ${result1.normalizedInvoice.serviceDate || 'NULL (expected)'}`);
    console.log('');

    // Test 2: Apply human correction
    console.log('TEST 2: Applying human correction');
    const correction1 = corrections.find(c => c.invoiceId === 'INV-A-001')!;
    const updates = await applyHumanCorrection(inv1, correction1);
    console.log(`  - Memory updates: ${updates.length}`);
    updates.forEach(u => console.log(`    * ${u.type}: ${u.details}`));
    console.log('');

    // Test 3: Process second invoice (with memory)
    console.log('TEST 3: Second invoice (with memory)');
    const inv2 = invoices.find(i => i.invoiceId === 'INV-A-002')!;
    const result2 = await processInvoice(inv2, { purchaseOrders });
    console.log(`  - Invoice: ${result2.normalizedInvoice.invoiceId}`);
    console.log(`  - Requires Review: ${result2.requiresHumanReview}`);
    console.log(`  - Confidence: ${(result2.confidenceScore * 100).toFixed(1)}%`);
    console.log(`  - ServiceDate: ${result2.normalizedInvoice.serviceDate || 'NULL'}`);

    const serviceDateCorrection = result2.proposedCorrections.find(c => c.field === 'serviceDate');
    if (serviceDateCorrection) {
        console.log(`  - LEARNED: serviceDate proposed as ${serviceDateCorrection.proposedValue}`);
        console.log(`    Reasoning: ${serviceDateCorrection.reasoning.substring(0, 80)}...`);
    }
    console.log('');

    // Test 4: VAT Learning (Parts AG)
    console.log('TEST 4: VAT Inclusive Learning (Parts AG)');
    const partsInv = invoices.find(i => i.invoiceId === 'INV-B-001')!;
    await processInvoice(partsInv, { purchaseOrders });
    const partsCorrection = corrections.find(c => c.invoiceId === 'INV-B-001')!;
    await applyHumanCorrection(partsInv, partsCorrection);
    console.log('  - Applied VAT correction');

    const partsInv2 = invoices.find(i => i.invoiceId === 'INV-B-002')!;
    const partsResult2 = await processInvoice(partsInv2, { purchaseOrders });
    console.log(`  - Second invoice confidence: ${(partsResult2.confidenceScore * 100).toFixed(1)}%`);
    console.log('');

    // Test 5: Duplicate Detection
    console.log('TEST 5: Duplicate Detection');
    const inv3 = invoices.find(i => i.invoiceId === 'INV-A-003')!;
    await processInvoice(inv3, { purchaseOrders });
    const corr3 = corrections.find(c => c.invoiceId === 'INV-A-003')!;
    await applyHumanCorrection(inv3, corr3);

    const inv4 = invoices.find(i => i.invoiceId === 'INV-A-004')!;
    const result4 = await processInvoice(inv4, { purchaseOrders });
    console.log(`  - Invoice: ${result4.normalizedInvoice.invoiceId}`);
    console.log(`  - Requires Review (expected): ${result4.requiresHumanReview}`);
    console.log(`  - Duplicate warning in reasoning: ${result4.reasoning.includes('DUPLICATE') ? 'YES' : 'NO'}`);
    console.log('');

    // Print final memory state
    console.log('=== FINAL MEMORY STATE ===');
    const memories = await getAllMemories();
    console.log(`Vendor Memories: ${memories.vendorMemories.length}`);
    memories.vendorMemories.forEach(vm => {
        console.log(`  - ${vm.vendorName}: ${vm.fieldMappings.length} field mappings, confidence ${(vm.confidence * 100).toFixed(1)}%`);
    });
    console.log(`Correction Memories: ${memories.correctionMemories.length}`);
    console.log(`Resolution Memories: ${memories.resolutionMemories.length}`);

    // Print sample JSON output
    console.log('\n=== SAMPLE JSON OUTPUT (INV-A-002) ===');
    console.log(JSON.stringify(result2, null, 2));

    shutdown();
    console.log('\n=== TEST COMPLETE ===');
}

runTest().catch(err => {
    console.error('Test failed:', err);
    shutdown();
    process.exit(1);
});
