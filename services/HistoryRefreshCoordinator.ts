import { DataSyncService } from "@/services/DataSyncService";
import { HistoricalDataService } from "@/services/HistoricalDataService";
import { UnifiedUsageService } from "@/services/UnifiedUsageService";
import { database } from "@/services/database";

type HistoryRefreshRequest = {
  source: string;
  days: number;
  prioritizeDates: string[];
  syncToday: boolean;
};

export type HistoryRefreshState = {
  inFlight: boolean;
  queued: boolean;
  activeSource: string | null;
  lastCompletedAt: number | null;
};

export type HistoryRefreshEvent =
  | { type: "started"; state: HistoryRefreshState; request: HistoryRefreshRequest }
  | {
      type: "completed";
      state: HistoryRefreshState;
      request: HistoryRefreshRequest;
      refreshedDates: string[];
    }
  | {
      type: "failed";
      state: HistoryRefreshState;
      request: HistoryRefreshRequest;
      error: unknown;
    };

type HistoryRefreshOptions = Partial<HistoryRefreshRequest> & {
  source: string;
};

export class HistoryRefreshCoordinator {
  private static instance: HistoryRefreshCoordinator;

  private readonly listeners = new Set<(event: HistoryRefreshEvent) => void>();
  private inFlight = false;
  private pendingRequest: HistoryRefreshRequest | null = null;
  private lastCompletedAt: number | null = null;
  private activeSource: string | null = null;

  static getInstance(): HistoryRefreshCoordinator {
    if (!this.instance) {
      this.instance = new HistoryRefreshCoordinator();
    }
    return this.instance;
  }

  subscribe(listener: (event: HistoryRefreshEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(): HistoryRefreshState {
    return {
      inFlight: this.inFlight,
      queued: this.pendingRequest !== null,
      activeSource: this.activeSource,
      lastCompletedAt: this.lastCompletedAt,
    };
  }

  async requestRefresh(options: HistoryRefreshOptions): Promise<void> {
    const request = this.normalizeRequest(options);

    if (this.inFlight) {
      this.pendingRequest = this.mergeRequests(this.pendingRequest, request);
      return;
    }

    await this.runRequest(request);
  }

  private normalizeRequest(options: HistoryRefreshOptions): HistoryRefreshRequest {
    return {
      source: options.source,
      days: Math.max(1, options.days ?? 30),
      prioritizeDates: Array.from(new Set(options.prioritizeDates ?? [])).sort(),
      syncToday: options.syncToday ?? true,
    };
  }

  private mergeRequests(
    existing: HistoryRefreshRequest | null,
    next: HistoryRefreshRequest
  ): HistoryRefreshRequest {
    if (!existing) {
      return next;
    }

    return {
      source: `${existing.source}+${next.source}`,
      days: Math.max(existing.days, next.days),
      prioritizeDates: Array.from(
        new Set([...existing.prioritizeDates, ...next.prioritizeDates])
      ).sort(),
      syncToday: existing.syncToday || next.syncToday,
    };
  }

  private emit(event: HistoryRefreshEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.warn("HistoryRefreshCoordinator listener failed:", error);
      }
    }
  }

  private async runRequest(request: HistoryRefreshRequest): Promise<void> {
    this.inFlight = true;
    this.activeSource = request.source;
    this.emit({ type: "started", state: this.getState(), request });

    const refreshedDates: string[] = [];

    try {
      if (request.syncToday && UnifiedUsageService.isNativeModuleAvailable()) {
        try {
          const hasPermission = await UnifiedUsageService.isUsageAccessGranted();
          if (hasPermission) {
            await DataSyncService.getInstance().syncUsageData();
          }
        } catch (error) {
          console.warn("HistoryRefreshCoordinator sync failed:", error);
        }
      }

      const historicalService = HistoricalDataService.getInstance();

      for (let index = 0; index < request.prioritizeDates.length; index += 1) {
        const date = request.prioritizeDates[index];
        try {
          await historicalService.refreshDailySummary(date);
          refreshedDates.push(date);
        } catch (error) {
          console.warn(`HistoryRefreshCoordinator failed for ${date}:`, error);
        }

        if ((index + 1) % 2 === 0) {
          await yieldToUI();
        }
      }

      await database.backfillSummaries(request.days);

      this.lastCompletedAt = Date.now();
      this.emit({
        type: "completed",
        state: this.getState(),
        request,
        refreshedDates,
      });
    } catch (error) {
      this.emit({
        type: "failed",
        state: this.getState(),
        request,
        error,
      });
    } finally {
      this.inFlight = false;
      this.activeSource = null;

      if (this.pendingRequest) {
        const nextRequest = this.pendingRequest;
        this.pendingRequest = null;
        await this.runRequest(nextRequest);
      }
    }
  }
}

function yieldToUI(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
