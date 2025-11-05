#!/usr/bin/env bun
import { clusterNotes, listClusters, getNotesInCluster } from "./index.js";
import * as lancedb from "@lancedb/lancedb";

/**
 * Improved Two-Pass Clustering:
 * 
 * Pass 1: HDBSCAN with min_cluster_size=2 for initial clustering
 * Pass 1.5: Intelligent Outlier Reassignment
 *   - Outliers are matched to nearest existing cluster centroids
 *   - Only reassigned if within distance threshold
 * Pass 2: Secondary HDBSCAN on remaining isolated outliers
 *   - Uses minClusterSize=1 for more permissive clustering
 *   - Respects variable cluster shapes and sizes
 * 
 * Benefits over K-means:
 * - HDBSCAN doesn't assume spherical clusters
 * - Respects variable cluster densities
 * - Better handles outliers semantically
 * - Consistent methodology across all passes
 * 
 * Usage:
 *   bun two-pass-clustering-improved.ts
 */

async function improvedTwoPassClustering() {
  console.log("🎯 Improved Two-Pass Clustering with Intelligent Outlier Refinement\n");
  console.log("Pass 1: Initial HDBSCAN clustering (min_cluster_size=2)");
  console.log("Pass 1.5: Intelligent outlier reassignment to nearest clusters");
  console.log("Pass 2: Secondary HDBSCAN on remaining isolated notes\n");
  
  try {
    const db = await lancedb.connect(`${process.env.HOME}/.mcp-apple-notes/data`);
    const notesTable = await db.openTable("notes");
    
    const allChunks = await notesTable.search("").limit(100000).toArray();
    const uniqueNotes = new Set(allChunks.map(chunk => `${chunk.title}|||${chunk.creation_date}`));
    
    console.log(`📊 Database: ${uniqueNotes.size} notes (${allChunks.length} chunks)\n`);
    
    // ===== RUN CLUSTERING WITH BUILT-IN TWO-PASS REFINEMENT =====
    console.log("════════════════════════════════════════");
    console.log("🚀 Starting Improved Two-Pass Clustering");
    console.log("════════════════════════════════════════\n");
    
    const clusterResult = await clusterNotes(notesTable, 2, true);
    
    console.log(`\n✅ Clustering Results:`);
    console.log(`   • Primary clusters: ${clusterResult.totalClusters}`);
    console.log(`   • Total notes clustered: ${clusterResult.totalNotes - clusterResult.outliers}`);
    console.log(`   • Remaining outliers: ${clusterResult.outliers}`);
    console.log(`   • Time: ${clusterResult.timeSeconds.toFixed(1)}s\n`);
    
    // ===== UNIFIED DISPLAY =====
    console.log("════════════════════════════════════════");
    console.log("📊 FINAL CLUSTER COMPOSITION");
    console.log("════════════════════════════════════════\n");
    
    const finalClusters = await listClusters(notesTable);
    const finalRealClusters = finalClusters.filter(c => c.cluster_id !== '-1');
    
    console.log("🎯 ALL CLUSTERS:\n");
    let totalClustered = 0;
    
    for (let i = 0; i < finalRealClusters.length; i++) {
      const cluster = finalRealClusters[i];
      const notesInCluster = await getNotesInCluster(notesTable, cluster.cluster_id);
      totalClustered += notesInCluster.length;
      
      console.log(`📌 Cluster ${i + 1}: "${cluster.cluster_label}"`);
      console.log(`   📊 ${notesInCluster.length} notes`);
      console.log(`   💭 ${cluster.cluster_summary}`);
      console.log(`   📖 Notes:`);
      notesInCluster.forEach((note, idx) => {
        console.log(`      ${idx + 1}. "${note.title}"`);
      });
      console.log();
    }
    
    // Display remaining outliers
    const outlierCluster = await getNotesInCluster(notesTable, '-1');
    if (outlierCluster.length > 0) {
      console.log(`📌 OUTLIERS (${outlierCluster.length} notes):`);
      console.log(`   Genuinely isolated notes (no nearby clusters):`);
      outlierCluster.forEach((note, idx) => {
        console.log(`      ${idx + 1}. "${note.title}"`);
      });
      console.log();
    }
    
    // ===== FINAL SUMMARY =====
    console.log("════════════════════════════════════════");
    console.log("📈 FINAL SUMMARY");
    console.log("════════════════════════════════════════\n");
    
    console.log(`Total notes: ${clusterResult.totalNotes}`);
    console.log(`Total clusters: ${finalRealClusters.length}`);
    console.log(`Notes in clusters: ${totalClustered} (${((totalClustered / clusterResult.totalNotes) * 100).toFixed(1)}%)`);
    console.log(`Remaining outliers: ${outlierCluster.length} (${((outlierCluster.length / clusterResult.totalNotes) * 100).toFixed(1)}%)`);
    console.log(`Processing time: ${clusterResult.timeSeconds.toFixed(1)}s`);
    
    console.log(`\n✨ Improved two-pass clustering complete!`);
    console.log(`   💾 All changes persisted to database`);
    console.log(`   🎯 Using density-based clustering (HDBSCAN) throughout`);
    console.log(`   🔧 Smart outlier reassignment + secondary clustering`);
    
    if (outlierCluster.length === 0) {
      console.log("\n🎉 SUCCESS: All notes are now clustered!");
    } else {
      console.log(`\n💡 Note: ${outlierCluster.length} notes remain as true outliers`);
      console.log(`   These are semantically isolated from all clusters`);
    }
    
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
  
  process.exit(0);
}

improvedTwoPassClustering();
