import { prisma, withRetry } from "./prisma"

export interface IngestRunContext {
  runId: string | null
  trigger: "manual" | "scheduled"
}

export async function startIngestRun(trigger: "manual" | "scheduled" = "manual"): Promise<IngestRunContext> {
  const run = await withRetry(() =>
    prisma.ingestionRun.create({
      data: { trigger, status: "running" },
    }),
  )
  return { runId: run.id, trigger }
}

export async function finishIngestRun(
  ctx: IngestRunContext,
  result: { recordsFound: number; recordsNew: number; errorMessage?: string },
) {
  if (!ctx.runId) return
  await withRetry(() =>
    prisma.ingestionRun.update({
      where: { id: ctx.runId! },
      data: {
        status: result.errorMessage ? "failed" : "success",
        finishedAt: new Date(),
        recordsFound: result.recordsFound,
        recordsNew: result.recordsNew,
        ...(result.errorMessage && { errorMessage: result.errorMessage }),
      },
    }),
  )
}
