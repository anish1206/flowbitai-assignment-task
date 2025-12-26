import initSqlJs, { Database } from 'sql.js';
import * as fs from 'fs';
import * as path from 'path';

let db: Database | null = null;
const DB_PATH = path.join(process.cwd(), 'data', 'memory.db');

export async function getDatabase(): Promise<Database> {
    if (db) return db;

    const SQL = await initSqlJs();

    // Ensure data directory exists
    const dataDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    // Load existing database or create new
    if (fs.existsSync(DB_PATH)) {
        const buffer = fs.readFileSync(DB_PATH);
        db = new SQL.Database(buffer);
    } else {
        db = new SQL.Database();
        initializeSchema(db);
    }

    return db;
}

export function saveDatabase(): void {
    if (db) {
        const data = db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(DB_PATH, buffer);
    }
}

export function closeDatabase(): void {
    if (db) {
        saveDatabase();
        db.close();
        db = null;
    }
}

export function resetDatabase(): void {
    if (fs.existsSync(DB_PATH)) {
        fs.unlinkSync(DB_PATH);
    }
    db = null;
}

function initializeSchema(database: Database): void {
    // Vendor Memories Table
    database.run(`
    CREATE TABLE IF NOT EXISTS vendor_memories (
      id TEXT PRIMARY KEY,
      vendor_name TEXT NOT NULL UNIQUE,
      field_mappings TEXT DEFAULT '[]',
      tax_behavior TEXT,
      default_currency TEXT,
      sku_mappings TEXT DEFAULT '[]',
      payment_terms TEXT,
      confidence REAL DEFAULT 0.5,
      usage_count INTEGER DEFAULT 0,
      last_used TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

    // Correction Memories Table
    database.run(`
    CREATE TABLE IF NOT EXISTS correction_memories (
      id TEXT PRIMARY KEY,
      vendor_name TEXT NOT NULL,
      field_name TEXT NOT NULL,
      pattern TEXT NOT NULL,
      correction_type TEXT NOT NULL,
      correction_value TEXT,
      confidence REAL DEFAULT 0.5,
      success_count INTEGER DEFAULT 0,
      failure_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

    // Resolution Memories Table
    database.run(`
    CREATE TABLE IF NOT EXISTS resolution_memories (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL,
      vendor_name TEXT NOT NULL,
      discrepancy_type TEXT NOT NULL,
      original_value TEXT,
      corrected_value TEXT,
      resolution TEXT NOT NULL,
      human_feedback TEXT,
      created_at TEXT NOT NULL
    )
  `);

    // Processed Invoices Table (for duplicate detection)
    database.run(`
    CREATE TABLE IF NOT EXISTS processed_invoices (
      id TEXT PRIMARY KEY,
      invoice_number TEXT NOT NULL,
      vendor_name TEXT NOT NULL,
      invoice_date TEXT NOT NULL,
      gross_total REAL NOT NULL,
      processed_at TEXT NOT NULL,
      hash TEXT NOT NULL
    )
  `);

    // Audit Logs Table
    database.run(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL,
      step TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      details TEXT NOT NULL,
      memory_ids TEXT
    )
  `);

    // Create indexes
    database.run(`CREATE INDEX IF NOT EXISTS idx_vendor_memories_name ON vendor_memories(vendor_name)`);
    database.run(`CREATE INDEX IF NOT EXISTS idx_correction_memories_vendor ON correction_memories(vendor_name)`);
    database.run(`CREATE INDEX IF NOT EXISTS idx_resolution_memories_vendor ON resolution_memories(vendor_name)`);
    database.run(`CREATE INDEX IF NOT EXISTS idx_processed_invoices_vendor ON processed_invoices(vendor_name, invoice_number)`);
}
