#!/usr/bin/env bun
import * as lancedb from "@lancedb/lancedb";
import path from "node:path";
import os from "node:os";

async function inspectDatabaseTables() {
  console.log("🔍 Inspecting database tables and contents...\n");
  
  try {
    const db = await lancedb.connect(
      path.join(os.homedir(), ".mcp-apple-notes", "data")
    );
    
    // List all tables
    const tables = await db.tableNames();
    console.log(`📊 Found ${tables.length} tables in database:`);
    
    for (const tableName of tables) {
      console.log(`\n📋 Table: "${tableName}"`);
      try {
        const table = await db.openTable(tableName);
        const count = await table.countRows();
        console.log(`   📄 Total rows: ${count}`);
        
        if (count > 0 && count < 50) {
          // Show sample data for small tables
          const sample = await table.search("").limit(3).toArray();
          console.log(`   📝 Sample data (first 3 rows):`);
          sample.forEach((row, idx) => {
            console.log(`      ${idx + 1}. Title: "${row.title || 'N/A'}"`);
            console.log(`         Cluster ID: ${row.cluster_id || 'null'}`);
            console.log(`         Created: ${row.creation_date || 'N/A'}`);
          });
        } else if (count > 0) {
          // For large tables, show summary
          const sample = await table.search("").limit(1).toArray();
          console.log(`   📝 Schema preview:`);
          if (sample.length > 0) {
            const keys = Object.keys(sample[0]);
            console.log(`      Fields: ${keys.join(', ')}`);
          }
          
          // Check cluster distribution
          const allRows = await table.search("").toArray();
          const clusterMap = new Map();
          allRows.forEach(row => {
            const clusterId = row.cluster_id || 'null';
            clusterMap.set(clusterId, (clusterMap.get(clusterId) || 0) + 1);
          });
          
          console.log(`   🏷️ Cluster distribution:`);
          for (const [clusterId, count] of clusterMap.entries()) {
            console.log(`      Cluster ${clusterId}: ${count} chunks`);
          }
        }
      } catch (error) {
        console.log(`   ❌ Error reading table: ${String(error)}`);
      }
    }
    
  } catch (error) {
    console.error("❌ Error:", error);
  }
  
  process.exit(0);
}

inspectDatabaseTables();