export type InsightInvalidationEvent =
  | {
      type: 'focus_session_changed';
      source: 'focus' | 'insight_action';
    }
  | {
      type: 'protected_apps_changed';
      source: 'focus' | 'insight_action';
      packageName?: string;
    }
  | {
      type: 'insight_action_applied';
      source: 'insight_action';
      actionKey: string;
    }
  | {
      type: 'permissions_changed';
      source: 'focus' | 'insight_action';
    };

type Listener = (event: InsightInvalidationEvent) => void;

export class InsightInvalidationService {
  private static listeners = new Set<Listener>();

  static subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  static emit(event: InsightInvalidationEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
