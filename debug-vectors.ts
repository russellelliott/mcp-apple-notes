#!/usr/bin/env bun
import { createNotesTable } from "./index.js";

async function debugVectors() {
  console.log("🔍 Debug vector field names...\n");
  
  try {
    const { notesTable } = await createNotesTable();
    
    // Get one chunk to see all field names
    const chunks = await notesTable.search("").limit(1).toArray();
    
    if (chunks.length > 0) {
      const chunk = chunks[0];
      console.log("🔍 All fields in chunk:");
      Object.keys(chunk).forEach(key => {
        const value = chunk[key];
        const type = Array.isArray(value) ? `array[${value.length}]` : typeof value;
        console.log(`   ${key}: ${type}`);
        
        if (key.includes('vector') || key.includes('embedding')) {
          console.log(`      ↳ ${key} sample: ${Array.isArray(value) ? `[${value.slice(0,3).join(', ')}...]` : value}`);
        }
      });
    }
    
  } catch (error) {
    console.error("❌ Error:", error);
  }
  
  process.exit(0);
}

debugVectors();