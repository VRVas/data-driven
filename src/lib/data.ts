import datasetJson from "@/data/dataset.json";
import dqJson from "@/data/data-quality.json";
import type { Dataset, Brand, IndustryStat, DataQualityIssue, Agent } from "./types";
import { getBrandStore } from "./store/brands";
import { getAgentStore } from "./store/agents";

/**
 * Data-access seam.
 *
 * - Brands are LIVE (Cosmos in production, seeded file store in dev) and editable.
 * - Reference data (industries, playbook, market sizing, agents, meta) comes from
 *   the cleaned ETL snapshot until those entities become editable too.
 */
const dataset = datasetJson as unknown as Dataset;
const dq = dqJson as unknown as { issues: DataQualityIssue[]; count: number };

/** Seed reference data (industries, playbook, market sizing, agents, meta). */
export function getDataset(): Dataset {
  return dataset;
}

export async function getBrands(): Promise<Brand[]> {
  const brands = await getBrandStore().list();
  return brands.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getScoredBrands(): Promise<Brand[]> {
  return (await getBrands()).filter((b) => b.scored && b.scores);
}

export async function getBrand(id: string): Promise<Brand | null> {
  return getBrandStore().get(id);
}

export async function getAgents(): Promise<Agent[]> {
  const agents = await getAgentStore().list();
  return agents.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getAgent(id: string): Promise<Agent | null> {
  return getAgentStore().get(id);
}

export function getIndustries(): IndustryStat[] {
  return dataset.industries;
}

export function getDataQuality(): { issues: DataQualityIssue[]; count: number } {
  return dq;
}

