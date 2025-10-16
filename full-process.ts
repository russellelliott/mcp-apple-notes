#!/usr/bin/env bun
import { createNotesTable, fetchAndIndexAllNotes, clusterNotes, listClusters, getNotesInCluster } from "./index.js";

async function fullProcessing() {
  console.log("🚀 Complete notes processing: Index + Cluster + Display\n");
  
  // Parse command line arguments
  const args = process.argv.slice(2);
  const maxNotes = args[0] ? parseInt(args[0]) : undefined;
  const mode = (args[1] as 'fresh' | 'incremental') || 'fresh';
  
  console.log(`📊 Configuration:`);
  console.log(`   📝 Max notes: ${maxNotes || 'unlimited'}`);
  console.log(`   🔄 Mode: ${mode}`);
  console.log();
  
  try {
    // Step 1: Create/open the notes table
    console.log("📂 Opening notes table...");
    const { notesTable } = await createNotesTable();
    
    // Step 2: Index ALL notes from Apple Notes
    console.log("\n📥 Indexing notes from Apple Notes...");
    const indexResult = await fetchAndIndexAllNotes(notesTable, maxNotes, mode);
    
    console.log(`✅ Indexed ${indexResult.processed} notes into ${indexResult.totalChunks} chunks`);
    console.log(`   ⏱️ Indexing time: ${indexResult.timeSeconds.toFixed(1)}s`);
    
    if (indexResult.processed < 50) {
      console.log("⚠️ Fewer notes indexed than expected. You may need to run this again.");
    }
    
    // Step 3: Run clustering on all indexed notes
    console.log("\n🔬 Running clustering on all indexed notes...");
    const clusterResult = await clusterNotes(
      notesTable, 
      2,   // min_cluster_size = 2 
      0.6  // epsilon = 0.6 (optimal value we found)
    );
    
    console.log(`✅ Clustering complete: ${clusterResult.totalClusters} clusters, ${clusterResult.outliers} outliers`);
    console.log(`   ⏱️ Clustering time: ${clusterResult.timeSeconds.toFixed(1)}s`);
    
    // Step 4: Display all clusters
    console.log("\n📋 All clusters found:");
    const clusters = await listClusters(notesTable);
    
    let totalNotesInClusters = 0;
    
    for (const cluster of clusters) {
      const isOutlier = cluster.cluster_id === '-1';
      const emoji = isOutlier ? '📌' : '🎯';
      
      console.log(`\n${emoji} ${cluster.cluster_label} (ID: ${cluster.cluster_id})`);
      console.log(`   📊 ${cluster.note_count} notes`);
      console.log(`   📝 ${cluster.cluster_summary}`);
      
      totalNotesInClusters += cluster.note_count;
      
      // Show notes in cluster (limit to 5 for readability)
      const notesInCluster = await getNotesInCluster(notesTable, cluster.cluster_id);
      console.log(`   📖 Notes (showing ${Math.min(5, notesInCluster.length)} of ${notesInCluster.length}):`);
      
      notesInCluster.slice(0, 5).forEach((note, idx) => {
        console.log(`      ${idx + 1}. "${note.title}"`);
      });
      
      if (notesInCluster.length > 5) {
        console.log(`      ... and ${notesInCluster.length - 5} more notes`);
      }
    }
    
    // Summary
    const realClusters = clusters.filter(c => c.cluster_id !== '-1');
    const outlierCluster = clusters.find(c => c.cluster_id === '-1');
    
    console.log("\n📊 FINAL SUMMARY:");
    console.log(`   📝 Total notes processed: ${totalNotesInClusters}`);
    console.log(`   🎯 Clusters found: ${realClusters.length}`);
    console.log(`   📌 Outlier notes: ${outlierCluster?.note_count || 0}`);
    console.log(`   ⏱️ Total processing time: ${(indexResult.timeSeconds + clusterResult.timeSeconds).toFixed(1)}s`);
    
    console.log("\n✨ SUCCESS: All your notes have been indexed and clustered!");
    
  } catch (error) {
    console.error("❌ Error during processing:", error);
  }
  
  process.exit(0);
}

// Show usage if no arguments provided
if (process.argv.length === 2) {
  console.log("🚀 Full Process: Index all notes + cluster + display");
  console.log("\nUsage:");
  console.log("  bun full-process.ts [maxNotes] [mode]");
  console.log("\nArguments:");
  console.log("  maxNotes  - Maximum number of notes to process (optional, default: unlimited)");
  console.log("  mode      - Processing mode: 'fresh' or 'incremental' (default: 'fresh')");
  console.log("\nExamples:");
  console.log("  bun full-process.ts 100 fresh    # Process up to 100 notes in fresh mode");
  console.log("  bun full-process.ts              # Process all notes in fresh mode");
  console.log("  bun full-process.ts 50 incremental # Process up to 50 notes incrementally");
  process.exit(0);
}

fullProcessing();