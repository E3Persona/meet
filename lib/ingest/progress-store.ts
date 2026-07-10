const store = new Map<string, string[]>()

export function getRunProgress(runId: string): string[] {
  return store.get(runId) ?? []
}

export function appendRunProgress(runId: string, message: string): void {
  const logs = store.get(runId) ?? []
  logs.push(message)
  store.set(runId, logs)
  if (logs.length > 2000) logs.splice(0, logs.length - 2000)
}

export function clearRunProgress(runId: string): void {
  store.delete(runId)
}

export function createProgressCallback(runId: string): (message: string) => void {
  return (message: string) => appendRunProgress(runId, message)
}
