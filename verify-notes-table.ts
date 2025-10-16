#!/usr/bin/env bun
import { createNotesTable } from "./index.js";

async function verifyNotesTable() {
  console.log("🔍 Verifying the main 'notes' table...\n");
  
  try {
    const { notesTable } = await createNotesTable();
    
    // Get all chunks
    console.log("📊 Getting all chunks from 'notes' table...");
    const allChunks = await notesTable.search("").toArray();
    
    console.log(`📄 Total chunks: ${allChunks.length}`);
    
    // Count unique notes
    const uniqueNotes = new Set();
    const clusterMap = new Map();
    
    allChunks.forEach(chunk => {
      const noteKey = `${chunk.title}|||${chunk.creation_date}`;
      uniqueNotes.add(noteKey);
      
      const clusterId = chunk.cluster_id;
      if (clusterId !== undefined && clusterId !== null) {
        clusterMap.set(clusterId, (clusterMap.get(clusterId) || 0) + 1);
      }
    });
    
    console.log(`📝 Unique notes: ${uniqueNotes.size}`);
    console.log(`🏷️ Cluster distribution:`);
    
    if (clusterMap.size === 0) {
      console.log("   ⚠️ No cluster assignments found - clustering may not have been saved properly");
    } else {
      // Sort clusters by ID
      const sortedClusters = Array.from(clusterMap.entries()).sort(([a], [b]) => {
        if (a === '-1') return 1; // Put outliers last
        if (b === '-1') return -1;
        return parseInt(a) - parseInt(b);
      });
      
      sortedClusters.forEach(([clusterId, count]) => {
        const label = clusterId === '-1' ? 'Outliers' : `Cluster ${clusterId}`;
        console.log(`   ${label}: ${count} chunks`);
      });
    }
    
    // Show sample data
    console.log(`\n📋 Sample chunks (first 5):`);
    allChunks.slice(0, 5).forEach((chunk, idx) => {
      console.log(`   ${idx + 1}. "${chunk.title}"`);
      console.log(`      Cluster: ${chunk.cluster_id || 'null'}`);
      console.log(`      Label: ${chunk.cluster_label || 'null'}`);
      console.log(`      Created: ${chunk.creation_date}`);
    });
    
  } catch (error) {
    console.error("❌ Error:", error);
  }
  
  process.exit(0);
}

verifyNotesTable();