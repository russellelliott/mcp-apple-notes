#!/usr/bin/env bun
import { connect } from '@lancedb/lancedb';
import * as path from 'path';
import * as os from 'os';

async function debugClusters() {
  const dbPath = path.join(os.homedir(), '.mcp-apple-notes', 'data');
  const db = await connect(dbPath);
  const notesTable = await db.openTable('notes');

  console.log('🔍 Debugging cluster assignments...\n');

  // Get all records with cluster assignments
  const results = await notesTable
    .search("")
    .limit(100000)
    .toArray();

  // Filter for records with cluster_id
  const clusteredResults = results.filter((r: any) => r.cluster_id !== null && r.cluster_id !== undefined);

  console.log(`📊 Total records with cluster_id: ${clusteredResults.length}\n`);

  // Group by cluster ID
  const clusterGroups = new Map();
  
  clusteredResults.forEach((r: any) => {
    if (!clusterGroups.has(r.cluster_id)) {
      clusterGroups.set(r.cluster_id, {
        label: r.cluster_label || 'Unknown',
        notes: new Set()
      });
    }
    clusterGroups.get(r.cluster_id).notes.add(`${r.title}|||${r.creation_date}`);
  });

  console.log(`🎯 Unique cluster IDs found: ${clusterGroups.size}\n`);

  // Display each cluster
  Array.from(clusterGroups.keys()).sort().forEach(clusterId => {
    const cluster = clusterGroups.get(clusterId);
    console.log(`Cluster ${clusterId}: "${cluster.label}"`);
    console.log(`  📊 ${cluster.notes.size} unique notes`);
    
    const notesList = Array.from(cluster.notes).map(noteStr => {
      const [title] = (noteStr as string).split('|||');
      return title;
    });
    
    notesList.forEach((note, i) => {
      console.log(`    ${i+1}. "${note}"`);
    });
    console.log();
  });
}

debugClusters().catch(console.error);