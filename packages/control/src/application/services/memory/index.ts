export { MemoryExtractor, createMemoryExtractor, shouldAutoExtract } from './extractor';
export { MemoryConsolidator, createMemoryConsolidator } from './consolidation';
export {
  listMemories,
  bumpMemoryAccess,
  searchMemories,
  getMemoryById,
  createMemory,
  updateMemory,
  deleteMemory,
  listReminders,
  getReminderById,
  createReminder,
  updateReminder,
  deleteReminder,
  triggerReminder,
} from './memories';

// Multi-agent exports
export { MemoryExtractionAgent, createMemoryExtractionAgent, type ExtractionInput, type ExtractionOutput } from './extraction-agent';
export { MemoryConsolidationAgent, createMemoryConsolidationAgent, type ConsolidationInput, type ConsolidationOutput } from './consolidation-agent';
