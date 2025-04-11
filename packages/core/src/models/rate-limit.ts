export interface RateLimitConfig {
  requestsPerMinute?: number;
  requestsPerHour?: number;
  requestsPerDay?: number;
  maxConcurrent?: number;
}

interface RateLimitState {
  lastRequest: Date;
  requestsInLastMinute: number;
  requestsInLastHour: number;
  requestsInLastDay: number;
  currentConcurrent: number;
  backoffUntil?: Date;
}

const rateLimitStates = new Map<string, RateLimitState>();

const DEFAULT_CONFIG: RateLimitConfig = {
  requestsPerMinute: 60,
  requestsPerHour: 1000,
  requestsPerDay: 10000,
  maxConcurrent: 5
};

function getDefaultState(): RateLimitState {
  return {
    lastRequest: new Date(),
    requestsInLastMinute: 0,
    requestsInLastHour: 0,
    requestsInLastDay: 0,
    currentConcurrent: 0
  };
}

function cleanupOldRequests(state: RateLimitState) {
  const now = new Date();
  const oneMinuteAgo = new Date(now.getTime() - 60 * 1000);
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  if (state.lastRequest < oneMinuteAgo) {
    state.requestsInLastMinute = 0;
  }
  if (state.lastRequest < oneHourAgo) {
    state.requestsInLastHour = 0;
  }
  if (state.lastRequest < oneDayAgo) {
    state.requestsInLastDay = 0;
  }
}

export function shouldAllowRequest(modelId: string, config?: RateLimitConfig): boolean {
  const effectiveConfig = { ...DEFAULT_CONFIG, ...config };
  let state = rateLimitStates.get(modelId);

  if (!state) {
    state = getDefaultState();
    rateLimitStates.set(modelId, state);
  }

  cleanupOldRequests(state);

  const now = new Date();

  // Check backoff
  if (state.backoffUntil && state.backoffUntil > now) {
    return false;
  }

  // Check rate limits
  if (state.requestsInLastMinute >= effectiveConfig.requestsPerMinute!) {
    return false;
  }
  if (state.requestsInLastHour >= effectiveConfig.requestsPerHour!) {
    return false;
  }
  if (state.requestsInLastDay >= effectiveConfig.requestsPerDay!) {
    return false;
  }
  if (state.currentConcurrent >= effectiveConfig.maxConcurrent!) {
    return false;
  }

  return true;
}

export function updateRateLimitState(
  modelId: string,
  success: boolean,
  backoffDuration?: number,
  config?: RateLimitConfig
) {
  const state = rateLimitStates.get(modelId) || getDefaultState();
  const now = new Date();

  if (success) {
    state.requestsInLastMinute++;
    state.requestsInLastHour++;
    state.requestsInLastDay++;
    state.currentConcurrent++;
    state.lastRequest = now;
  } else {
    if (backoffDuration) {
      state.backoffUntil = new Date(now.getTime() + backoffDuration);
    }
    state.currentConcurrent = Math.max(0, state.currentConcurrent - 1);
  }

  rateLimitStates.set(modelId, state);
} 