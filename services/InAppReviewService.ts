import * as StoreReview from "expo-store-review";

import { database } from "./database";
import { TelemetryService } from "./TelemetryService";

type ReviewPromptSource = "morning_replay" | "dev_button";
type ReviewPromptReason =
	| "prompt_requested"
	| "not_due_yet"
	| "already_processed_today"
	| "max_prompts_reached"
	| "no_review_action"
	| "request_failed";

type ReviewPromptResult = {
	prompted: boolean;
	reason: ReviewPromptReason;
	qualifyingVisitCount?: number;
	promptAttemptNumber?: number;
	daysSinceLastPrompt?: number;
};

function formatLocalDate(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function parsePositiveInteger(value: string | null): number {
	const parsed = Number.parseInt(value || "", 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export class InAppReviewService {
	private static readonly MORNING_REPLAY_VISIT_DATES_KEY =
		"review_prompt_morning_replay_visit_dates";
	private static readonly LAST_PROCESSED_VISIT_DATE_KEY =
		"review_prompt_last_processed_visit_date";
	private static readonly PROMPT_COUNT_KEY = "review_prompt_count";
	private static readonly LAST_PROMPT_VISIT_COUNT_KEY =
		"review_prompt_last_visit_count";
	private static readonly LAST_PROMPT_DATE_KEY = "review_prompt_last_date";
	private static readonly FIRST_PROMPT_THRESHOLD = 3;
	private static readonly RETRY_THRESHOLD_AFTER_PROMPT = 8;
	private static readonly MAX_PROMPT_COUNT = 2;

	static async registerMorningReplayVisit(): Promise<ReviewPromptResult> {
		const today = formatLocalDate(new Date());
		const lastProcessedDate = await database.getMeta(
			this.LAST_PROCESSED_VISIT_DATE_KEY,
		);
		if (lastProcessedDate === today) {
			return {
				prompted: false,
				reason: "already_processed_today",
			};
		}

		const visitDates = await this.getMorningReplayVisitDates();
		const nextVisitDates = visitDates.includes(today)
			? visitDates
			: [...visitDates, today];
		if (nextVisitDates !== visitDates) {
			await database.setMeta(
				this.MORNING_REPLAY_VISIT_DATES_KEY,
				JSON.stringify(nextVisitDates),
			);
		}
		await database.setMeta(this.LAST_PROCESSED_VISIT_DATE_KEY, today);

		const qualifyingVisitCount = nextVisitDates.length;
		const promptCount = parsePositiveInteger(
			await database.getMeta(this.PROMPT_COUNT_KEY),
		);
		if (promptCount >= this.MAX_PROMPT_COUNT) {
			return {
				prompted: false,
				reason: "max_prompts_reached",
				qualifyingVisitCount,
			};
		}

		const lastPromptVisitCount = parsePositiveInteger(
			await database.getMeta(this.LAST_PROMPT_VISIT_COUNT_KEY),
		);
		const daysSinceLastPrompt =
			lastPromptVisitCount > 0
				? qualifyingVisitCount - lastPromptVisitCount
				: undefined;
		const promptAttemptNumber = promptCount + 1;
		const shouldPrompt =
			promptCount === 0
				? qualifyingVisitCount >= this.FIRST_PROMPT_THRESHOLD
				: qualifyingVisitCount - lastPromptVisitCount >=
					this.RETRY_THRESHOLD_AFTER_PROMPT;

		if (!shouldPrompt) {
			return {
				prompted: false,
				reason: "not_due_yet",
				qualifyingVisitCount,
				promptAttemptNumber,
				daysSinceLastPrompt,
			};
		}

		return this.requestReview({
			source: "morning_replay",
			localDate: today,
			qualifyingVisitCount,
			promptAttemptNumber,
			daysSinceLastPrompt,
			persistPromptState: true,
		});
	}

	static async requestReviewFromDebug(): Promise<ReviewPromptResult> {
		return this.requestReview({
			source: "dev_button",
			localDate: formatLocalDate(new Date()),
			persistPromptState: false,
		});
	}

	private static async requestReview({
		source,
		localDate,
		qualifyingVisitCount,
		promptAttemptNumber,
		daysSinceLastPrompt,
		persistPromptState,
	}: {
		source: ReviewPromptSource;
		localDate: string;
		qualifyingVisitCount?: number;
		promptAttemptNumber?: number;
		daysSinceLastPrompt?: number;
		persistPromptState: boolean;
	}): Promise<ReviewPromptResult> {
		try {
			const [hasAction, isAvailable] = await Promise.all([
				StoreReview.hasAction(),
				StoreReview.isAvailableAsync(),
			]);

			if (!hasAction || !isAvailable) {
				TelemetryService.track("review_prompt_unavailable", {
					source,
					reason: hasAction ? "not_available" : "no_action",
					qualifying_visit_count: qualifyingVisitCount,
					prompt_attempt_number: promptAttemptNumber,
				});
				return {
					prompted: false,
					reason: "no_review_action",
					qualifyingVisitCount,
					promptAttemptNumber,
					daysSinceLastPrompt,
				};
			}

			await StoreReview.requestReview();
			if (persistPromptState && promptAttemptNumber && qualifyingVisitCount) {
				await Promise.all([
					database.setMeta(this.PROMPT_COUNT_KEY, String(promptAttemptNumber)),
					database.setMeta(
						this.LAST_PROMPT_VISIT_COUNT_KEY,
						String(qualifyingVisitCount),
					),
					database.setMeta(this.LAST_PROMPT_DATE_KEY, localDate),
				]);
			}

			TelemetryService.track("review_prompt_requested", {
				source,
				qualifying_visit_count: qualifyingVisitCount,
				prompt_attempt_number: promptAttemptNumber,
				days_since_last_prompt: daysSinceLastPrompt,
			});

			return {
				prompted: true,
				reason: "prompt_requested",
				qualifyingVisitCount,
				promptAttemptNumber,
				daysSinceLastPrompt,
			};
		} catch (error) {
			console.warn("Failed to request in-app review:", error);
			TelemetryService.track("review_prompt_unavailable", {
				source,
				reason: "request_failed",
				qualifying_visit_count: qualifyingVisitCount,
				prompt_attempt_number: promptAttemptNumber,
			});
			return {
				prompted: false,
				reason: "request_failed",
				qualifyingVisitCount,
				promptAttemptNumber,
				daysSinceLastPrompt,
			};
		}
	}

	private static async getMorningReplayVisitDates(): Promise<string[]> {
		const raw = await database.getMeta(this.MORNING_REPLAY_VISIT_DATES_KEY);
		if (!raw) {
			return [];
		}

		try {
			const parsed = JSON.parse(raw);
			if (!Array.isArray(parsed)) {
				return [];
			}
			return parsed.filter((value): value is string => typeof value === "string");
		} catch (error) {
			console.warn("Failed to parse stored review prompt visit dates:", error);
			return [];
		}
	}
}
