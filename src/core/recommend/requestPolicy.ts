import { recommendationConfig } from './config.ts'

export interface RequestPolicy {
  timeoutMs: number
  retryCount: number
  backoffBaseMs: number
  backoffMaxMs: number
}

export const defaultRequestPolicy: RequestPolicy = {
  timeoutMs: recommendationConfig.request.timeoutMs,
  retryCount: recommendationConfig.request.retryCount,
  backoffBaseMs: recommendationConfig.request.backoffBaseMs,
  backoffMaxMs: recommendationConfig.request.backoffMaxMs,
}

export const computeBackoffMs = (
  attempt: number,
  policy: RequestPolicy = defaultRequestPolicy,
  random: () => number = Math.random,
) => {
  const base = Math.min(policy.backoffMaxMs, policy.backoffBaseMs * Math.pow(2, Math.max(0, attempt)))
  // 加入 0~25% 抖动，避免多路请求同时重试。
  return Math.round(base * (1 + random() * 0.25))
}

export class RequestTimeoutError extends Error {
  constructor(message = 'request_timeout') {
    super(message)
    this.name = 'RequestTimeoutError'
  }
}

export const withTimeout = async <T,>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout?: () => void,
): Promise<T> => {
  if (timeoutMs <= 0) return promise
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.()
      reject(new RequestTimeoutError())
    }, timeoutMs)
    promise.then(
      value => { clearTimeout(timer); resolve(value) },
      error => { clearTimeout(timer); reject(error) },
    )
  })
}

export interface RunRequestOptions {
  policy?: RequestPolicy
  sleep?: (ms: number) => Promise<void>
  random?: () => number
  shouldRetry?: (error: unknown, attempt: number) => boolean
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void
  timeoutMs?: number
  signal?: { cancelled: boolean }
}

const defaultSleep = async(ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/**
 * 请求超时、有限重试、指数退避；失败次数达到上限后向上抛出，由源级冷却兜底。
 */
export const runWithRetry = async <T,>(
  request: () => Promise<T>,
  options: RunRequestOptions = {},
): Promise<T> => {
  const policy = options.policy ?? defaultRequestPolicy
  const sleep = options.sleep ?? defaultSleep
  const random = options.random ?? Math.random
  const timeoutMs = options.timeoutMs ?? policy.timeoutMs
  let lastError: unknown
  for (let attempt = 0; attempt <= policy.retryCount; attempt++) {
    if (options.signal?.cancelled) throw new Error('request_cancelled')
    try {
      return await withTimeout(request(), timeoutMs)
    } catch (error) {
      lastError = error
      if (attempt >= policy.retryCount) break
      if (options.shouldRetry && !options.shouldRetry(error, attempt)) break
      const delay = computeBackoffMs(attempt, policy, random)
      options.onRetry?.(error, attempt, delay)
      await sleep(delay)
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

export const isLikelyNetworkError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  return /timeout|network|fail|fetch|request_cancelled|socket|connect|ENOTFOUND|ECONN/i.test(message) ||
    (error instanceof RequestTimeoutError)
}

export const createCancellationToken = () => {
  const token = { cancelled: false }
  return {
    token,
    cancel: () => { token.cancelled = true },
  }
}
