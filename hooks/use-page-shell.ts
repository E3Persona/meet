// lib/page-shell/use-page-shell.ts

import { useCallback, useEffect, useRef, useState } from "react"
import type {
  PageShellError,
  PageShellState,
} from "@/types/components/page-shell"

interface UsePageShellOptions<T> {
  fetcher: () => Promise<T>
  /** Return true if data should be treated as "empty" */
  isEmpty?: (data: T) => boolean
  /** Auto-fetch on mount */
  immediate?: boolean
}

export function usePageShell<T>({
  fetcher,
  isEmpty,
  immediate = true,
}: UsePageShellOptions<T>) {
  const [state, setState] = useState<PageShellState<T>>({
    status: "loading",
    data: null,
    error: null,
    lastFetchedAt: null,
  })

  const isMountedRef = useRef(true)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  const fetch = useCallback(
    async (isRefresh = false) => {
      if (!isMountedRef.current) return

      setState((prev) => ({
        ...prev,
        status: isRefresh ? "refreshing" : "loading",
        error: null,
      }))

      try {
        const data = await fetcher()
        if (!isMountedRef.current) return

        const empty = isEmpty ? isEmpty(data) : isEmptyDefault(data)

        setState({
          status: empty ? "empty" : "success",
          data,
          error: null,
          lastFetchedAt: new Date(),
        })
      } catch (err) {
        if (!isMountedRef.current) return

        const pageError = normalizeError(err)
        setState((prev) => ({
          ...prev,
          status: "error",
          error: pageError,
        }))
      }
    },
    [fetcher, isEmpty]
  )

  const refresh = useCallback(() => fetch(true), [fetch])
  const retry = useCallback(() => fetch(false), [fetch])

  useEffect(() => {
    if (immediate) fetch(false)
  }, [immediate]) // eslint-disable-line react-hooks/exhaustive-deps

  return { state, refresh, retry, fetch }
}

function isEmptyDefault(data: unknown): boolean {
  if (data === null || data === undefined) return true
  if (Array.isArray(data)) return data.length === 0
  if (typeof data === "object") return Object.keys(data as object).length === 0
  return false
}

function normalizeError(err: unknown): PageShellError {
  if (err instanceof Error) {
    return { message: err.message, retryable: true }
  }
  if (typeof err === "object" && err !== null) {
    const e = err as Record<string, unknown>
    return {
      code: e.code as string | number,
      message: (e.message as string) ?? "Something went wrong.",
      detail: e.detail as string,
      retryable: (e.retryable as boolean) ?? true,
    }
  }
  return { message: "An unexpected error occurred.", retryable: true }
}
