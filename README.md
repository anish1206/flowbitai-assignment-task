# Invoice Memory Layer System

A memory-driven learning layer for invoice automation that stores reusable insights from past invoices and applies them to improve automation rates. Built with TypeScript and SQLite for persistence.

## 🎯 Problem Statement

A company processes hundreds of invoices daily. Many corrections repeat (vendor-specific labels, recurring tax issues, quantity mismatches). Currently, these corrections are wasted—the system does not learn.

## ✨ Solution

This **Memory Layer** sits on top of extraction and:

1. **Stores** reusable insights from past invoices
2. **Applies** them to future invoices to improve automation rates
3. **Remains** explainable and auditable

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    INVOICE PROCESSING PIPELINE                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐     │
│   │ RECALL  │ -> │  APPLY  │ -> │ DECIDE  │ -> │  LEARN  │     │
│   └────┬────┘    └────┬────┘    └────┬────┘    └────┬────┘     │
│        │              │              │              │           │
│   ┌────▼──────────────▼──────────────▼──────────────▼────┐     │
│   │                    MEMORY LAYER                       │     │
│   ├───────────────┬───────────────┬───────────────────────┤     │
│   │ Vendor Memory │  Correction   │   Resolution Memory   │     │
│   │               │    Memory     │                       │     │
│   └───────────────┴───────────────┴───────────────────────┘     │
│                              │                                   │
│                    ┌─────────▼─────────┐                        │
│                    │   SQLite Database  │                        │
│                    │   (Persistent)     │                        │
│                    └───────────────────┘                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 📦 Memory Types

### 1. Vendor Memory
Patterns tied to a specific vendor:
- **Field Mappings**: e.g., "Leistungsdatum" → serviceDate
- **Tax Behavior**: VAT inclusive/exclusive patterns
- **SKU Mappings**: Description to SKU translations
- **Default Currency**: Vendor's preferred currency
- **Payment Terms**: Skonto/discount patterns

### 2. Correction Memory
Learning from repeated corrections:
- Pattern recognition for recurring fixes
- Success/failure tracking for confidence
- Correction types: extract, recalculate, match, map

### 3. Resolution Memory
Track how discrepancies were resolved:
- Human approved vs rejected decisions
- Feedback for improving future decisions
- Approval rate statistics per vendor

## 🔧 Decision Logic

| Confidence | Action | Description |
|------------|--------|-------------|
| ≥ 85% | **Auto-accept** | High confidence from consistent patterns |
| 60-84% | **Auto-correct + Flag** | Moderate confidence, human should verify |
| 40-59% | **Propose** | Low confidence, requires explicit approval |
| < 40% | **Escalate** | Insufficient evidence for correction |

### Special Handling
- **New Vendor**: Always escalate first invoice
- **Conflicting Memories**: Escalate with reasoning
- **Duplicate Invoice**: Flag and prevent memory contamination

## 🚀 Quick Start

### Prerequisites
- Node.js >= 18.0.0
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/invoice-memory-layer.git
cd invoice-memory-layer

# Install dependencies
npm install
```

### Run the Demo

```bash
npm run demo
```

This runs an interactive demonstration showing:
1. Processing first invoice (no memory)
2. Applying human corrections
3. Processing second invoice (with learned memory)
4. Observing fewer flags and smarter decisions

## 📁 Project Structure

```
invoice-memory-layer/
├── src/
│   ├── types/           # TypeScript interfaces
│   │   ├── invoice.ts   # Invoice data types
│   │   ├── memory.ts    # Memory types
│   │   └── output.ts    # Output contract types
│   ├── db/
│   │   └── connection.ts # SQLite database layer
│   ├── memory/          # Memory modules
│   │   ├── vendorMemory.ts
│   │   ├── correctionMemory.ts
│   │   └── resolutionMemory.ts
│   ├── services/        # Core services
│   │   ├── recall.ts    # Memory retrieval
│   │   ├── apply.ts     # Apply corrections
│   │   ├── decide.ts    # Decision logic
│   │   └── learn.ts     # Learning from corrections
│   ├── utils/
│   │   ├── duplicateDetection.ts
│   │   └── auditTrail.ts
│   └── index.ts         # Main entry point
├── data/
│   ├── invoices.json    # Sample invoice data
│   ├── purchase_orders.json
│   └── human_corrections.json
├── demo/
│   └── runner.ts        # Demo script
├── package.json
├── tsconfig.json
└── README.md
```

## 📤 Output Contract

For each invoice, the system outputs:

```json
{
  "normalizedInvoice": {
    "invoiceId": "INV-A-002",
    "vendor": "Supplier GmbH",
    "invoiceNumber": "INV-2024-002",
    "serviceDate": "2024-01-15",
    "currency": "EUR",
    "grossTotal": 2826.25
  },
  "proposedCorrections": [
    {
      "field": "serviceDate",
      "originalValue": null,
      "proposedValue": "2024-01-15",
      "confidence": 0.65,
      "reasoning": "Extracted from rawText using learned pattern...",
      "autoApplied": false
    }
  ],
  "requiresHumanReview": true,
  "reasoning": "⚠️ REQUIRES HUMAN REVIEW (Overall confidence: 62.4%)...",
  "confidenceScore": 0.624,
  "memoryUpdates": [],
  "auditTrail": [
    {
      "step": "recall",
      "timestamp": "2024-01-20T10:30:00.000Z",
      "details": "Found vendor memory for \"Supplier GmbH\"..."
    }
  ]
}
```

## 📊 Expected Outcomes (Grading Criteria)

| Scenario | Expected Behavior | Status |
|----------|------------------|--------|
| Supplier GmbH INV-A-001 | Learn "Leistungsdatum" = serviceDate | ✅ |
| Supplier GmbH INV-A-003 | Auto-suggest PO-A-051 match | ✅ |
| Parts AG INV-B-001 | Learn VAT inclusive handling | ✅ |
| Parts AG missing currency | Recover from rawText | ✅ |
| Freight & Co Skonto | Detect and store payment terms | ✅ |
| Freight & Co descriptions | Map to SKU FREIGHT | ✅ |
| INV-A-004 + INV-B-004 | Flag as duplicates | ✅ |

## 🧪 Testing

Run the demo script which serves as an integration test:

```bash
npm run demo
```

The demo walks through all scenarios and validates expected behaviors.

## 🔐 Confidence System

### Reinforcement Formula
```
newConfidence = min(1.0, confidence + (1 - confidence) * 0.1 * successFactor)
```

### Decay Formula
```
decayedConfidence = confidence * (0.99 ^ daysSinceLastUse)
```

### Bad Learning Prevention
- Minimum 3 consistent observations before confidence > 60%
- Contradictory patterns reduce confidence by 50%
- Human rejections carry 2x weight vs approvals

## 🛡️ Duplicate Detection

Detects duplicates based on:
- Same vendor + invoice number
- Invoice dates within 7 days
- Total amount within 1% tolerance

When detected:
- Flags for human review
- Blocks memory updates to prevent contamination
- Presents both invoices for comparison

## 📝 API Usage

```typescript
import { 
  processInvoice, 
  applyHumanCorrection 
} from './src/index.js';

// Process an invoice
const result = await processInvoice(invoice, { purchaseOrders });

console.log(result.requiresHumanReview);  // true/false
console.log(result.confidenceScore);       // 0.0 - 1.0
console.log(result.proposedCorrections);   // Array of corrections
console.log(result.auditTrail);            // Processing steps

// Apply human correction to learn
const updates = await applyHumanCorrection(invoice, correction);
console.log(updates);  // What the system learned
```

## 🎥 Demo Video

[Link to demo video showing the system learning over time]

## 🔧 Technology Stack

| Component | Technology |
|-----------|------------|
| Language | TypeScript (strict mode) |
| Runtime | Node.js |
| Database | SQLite (sql.js) |
| CLI Colors | Chalk |

## 📄 License

MIT

## 👤 Author

Anish

---

Built for FlowbitAI Assignment - December 2024
