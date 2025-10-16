#!/usr/bin/env bun
import { createNotesTable } from "./index.js";

async function inspectAllClusters() {
  console.log("🔍 Comprehensive cluster inspection...\n");
  
  try {
    const { notesTable } = await createNotesTable();
    
    // Get ALL chunks and see their cluster assignments
    console.log("📊 Getting all chunks...");
    const allChunks = await notesTable.search("").toArray();
    
    console.log(`📄 Total chunks in database: ${allChunks.length}`);
    
    // Group by cluster_id to see all clusters
    const clusterMap = new Map();
    const noteMap = new Map(); // Track unique notes
    
    for (const chunk of allChunks) {
      const clusterId = chunk.cluster_id || 'null';
      const noteKey = `${chunk.title}|||${chunk.creation_date}`;
      
      // Track notes
      noteMap.set(noteKey, chunk.title);
      
      // Track clusters
      if (!clusterMap.has(clusterId)) {
        clusterMap.set(clusterId, {
          label: chunk.cluster_label || 'Unknown',
          summary: chunk.cluster_summary || '',
          chunks: 0,
          notes: new Set()
        });
      }
      
      clusterMap.get(clusterId).chunks++;
      clusterMap.get(clusterId).notes.add(noteKey);
    }
    
    console.log(`📝 Total unique notes: ${noteMap.size}`);
    console.log(`🏷️ Total clusters found: ${clusterMap.size}`);
    
    console.log("\n📋 All cluster details:");
    
    // Sort clusters by number of notes (descending)
    const sortedClusters = Array.from(clusterMap.entries())
      .sort(([a,], [b,]) => {
        // Put -1 (outliers) last, then sort by note count
        if (a === '-1') return 1;
        if (b === '-1') return -1;
        return clusterMap.get(b).notes.size - clusterMap.get(a).notes.size;
      });
    
    sortedClusters.forEach(([clusterId, data], idx) => {
      const isOutlier = clusterId === '-1' || clusterId === 'null';
      const emoji = isOutlier ? '📌' : '🎯';
      
      console.log(`\n${emoji} ${idx + 1}. ${data.label} (ID: ${clusterId})`);
      console.log(`   📊 ${data.notes.size} notes, ${data.chunks} chunks`);
      console.log(`   📝 ${data.summary}`);
      
      if (data.notes.size <= 10 || isOutlier) {
        console.log(`   📖 Notes:`);
        Array.from(data.notes).slice(0, 10).forEach((noteKey, noteIdx) => {
          const title = String(noteKey).split('|||')[0];
          console.log(`      ${noteIdx + 1}. "${title}"`);
        });
        if (data.notes.size > 10) {
          console.log(`      ... and ${data.notes.size - 10} more notes`);
        }
      }
    });
    
  } catch (error) {
    console.error("❌ Error:", error);
  }
  
  process.exit(0);
}

inspectAllClusters();