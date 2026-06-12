import { database } from './database';
import type {
  InsightCard,
  PersistedDailyInsights,
  RecentInsightActionMemory,
  RecentInsightMemory,
  RecentInsightMemoryEntry,
} from './InsightTypes';

const RECENT_INSIGHT_MEMORY_KEY = 'recent_insight_memory_v2';
const MAX_DAYS = 10;
const MAX_ACTIONS = 30;

export class InsightMemoryService {
  static async load(): Promise<RecentInsightMemory> {
    try {
      const raw = await database.getMeta(RECENT_INSIGHT_MEMORY_KEY);
      if (!raw) {
        return this.empty();
      }

      const parsed = JSON.parse(raw) as Partial<RecentInsightMemory>;
      return {
        shownByDate: parsed.shownByDate || {},
        acted: Array.isArray(parsed.acted) ? parsed.acted : [],
        persistedByDate: this.sanitizePersistedByDate(parsed.persistedByDate),
      };
    } catch (error) {
      console.warn('Failed to load recent insight memory:', error);
      return this.empty();
    }
  }

  static async recordShownInsights(date: string, insights: InsightCard[]): Promise<void> {
    const memory = await this.load();
    const nextShownByDate = {
      ...memory.shownByDate,
      [date]: insights.slice(0, 3).map((insight) => this.toEntry(insight)),
    };

    const keptDates = Object.keys(nextShownByDate)
      .sort((a, b) => b.localeCompare(a))
      .slice(0, MAX_DAYS);
    const prunedShownByDate = keptDates.reduce<Record<string, RecentInsightMemoryEntry[]>>(
      (acc, key) => {
        acc[key] = nextShownByDate[key];
        return acc;
      },
      {}
    );

    await this.save({
      shownByDate: prunedShownByDate,
      acted: memory.acted.slice(-MAX_ACTIONS),
      persistedByDate: this.prunePersistedByDate(memory.persistedByDate),
    });
  }

  static async recordAction(actionKey: string): Promise<void> {
    const memory = await this.load();
    const acted: RecentInsightActionMemory[] = [
      ...memory.acted.filter((entry) => entry.actionKey !== actionKey),
      { actionKey, actedAt: Date.now() },
    ].slice(-MAX_ACTIONS);

    await this.save({
      shownByDate: memory.shownByDate,
      acted,
      persistedByDate: memory.persistedByDate,
    });
  }

  static async getPersistedInsights(date: string): Promise<PersistedDailyInsights | null> {
    const memory = await this.load();
    const persisted = memory.persistedByDate[date];
    return persisted && persisted.rankedInsights.length > 0 ? persisted : null;
  }

  static async savePersistedInsights(date: string, insights: InsightCard[]): Promise<void> {
    if (insights.length === 0) {
      return;
    }

    const memory = await this.load();
    const persistedByDate = this.prunePersistedByDate({
      ...memory.persistedByDate,
      [date]: {
        date,
        savedAt: Date.now(),
        rankedInsights: insights,
      },
    });

    await this.save({
      shownByDate: memory.shownByDate,
      acted: memory.acted,
      persistedByDate,
    });
  }

  private static toEntry(insight: InsightCard): RecentInsightMemoryEntry {
    return {
      id: insight.id,
      insightType: insight.insightType,
      category: insight.category,
      subjectAppPackage: insight.subjectAppPackage,
      subjectMoment: insight.subjectMoment,
      actionKey: insight.actionKey,
    };
  }

  private static async save(memory: RecentInsightMemory): Promise<void> {
    await database.setMeta(RECENT_INSIGHT_MEMORY_KEY, JSON.stringify(memory));
  }

  private static prunePersistedByDate(
    persistedByDate: Record<string, PersistedDailyInsights>
  ): Record<string, PersistedDailyInsights> {
    const keptDates = Object.keys(persistedByDate)
      .sort((a, b) => b.localeCompare(a))
      .slice(0, MAX_DAYS);

    return keptDates.reduce<Record<string, PersistedDailyInsights>>((acc, key) => {
      acc[key] = persistedByDate[key];
      return acc;
    }, {});
  }

  private static sanitizePersistedByDate(
    persistedByDate: Partial<Record<string, PersistedDailyInsights>> | undefined
  ): Record<string, PersistedDailyInsights> {
    if (!persistedByDate || typeof persistedByDate !== 'object') {
      return {};
    }

    return Object.entries(persistedByDate).reduce<Record<string, PersistedDailyInsights>>(
      (acc, [date, value]) => {
        if (!value || !Array.isArray(value.rankedInsights)) {
          return acc;
        }

        acc[date] = {
          date,
          savedAt:
            typeof value.savedAt === 'number' && Number.isFinite(value.savedAt)
              ? value.savedAt
              : 0,
          rankedInsights: value.rankedInsights,
        };
        return acc;
      },
      {}
    );
  }

  private static empty(): RecentInsightMemory {
    return {
      shownByDate: {},
      acted: [],
      persistedByDate: {},
    };
  }
}
