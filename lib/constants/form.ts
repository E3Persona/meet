import { ColSpan, UploadedFile } from "@/types/components/forms"

// ─── Brand ────────────────────────────────────────────────────────────────────
export const BRAND = {
  primary: "hsl(142 72% 29%)", // WhatsApp green
  danger: "hsl(0 72% 51%)", // Cherry red
} as const

// ─── Column span → Tailwind class ─────────────────────────────────────────────
export const COL_SPAN_CLASS: Record<ColSpan, string> = {
  1: "col-span-1",
  2: "col-span-2",
  3: "col-span-3",
  4: "col-span-4",
  full: "col-span-full",
}

// ─── Grid columns → Tailwind class ───────────────────────────────────────────
export const GRID_COLS_CLASS: Record<2 | 4, string> = {
  2: "grid-cols-2",
  4: "grid-cols-4",
}

// ─── File upload limits ───────────────────────────────────────────────────────
export const DEFAULT_MAX_FILES = 10
export const DEFAULT_MAX_SIZE_MB = 10

// ─── Image extensions (for preview thumbnails) ────────────────────────────────
export const IMAGE_EXTENSIONS = [
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "svg",
  "avif",
]

export function isImageUrl(url: string): boolean {
  const parts = url.split("?")[0]?.split(".")
  if (!parts) return false
  const ext = parts.pop()?.toLowerCase() ?? ""
  return IMAGE_EXTENSIONS.includes(ext)
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/")
}

// ─── Generate a stable local ID ───────────────────────────────────────────────
export function genId(): string {
  return Math.random().toString(36).slice(2, 10)
}

// ─── Human-readable file size ─────────────────────────────────────────────────
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ─── FormData conversion ──────────────────────────────────────────────────────

/**
 * Converts form values to a FormData object.
 * Handles UploadedFile[] fields by appending the File objects.
 * Non-file values are appended as strings (objects are JSON-stringified).
 */
export function toFormData(
  values: Record<string, unknown>,
  fileFieldNames?: string[]
): FormData {
  const formData = new FormData()

  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue

    // Handle file uploads — UploadedFile[]
    if (fileFieldNames?.includes(key) && Array.isArray(value)) {
      const files = value as UploadedFile[]
      for (const uploaded of files) {
        if (uploaded.file instanceof File) {
          formData.append(key, uploaded.file, uploaded.name)
        }
      }
      continue
    }

    // Handle arrays (non-file)
    if (Array.isArray(value)) {
      for (const item of value) {
        formData.append(key, String(item))
      }
      continue
    }

    // Handle objects (JSON)
    if (typeof value === "object") {
      formData.append(key, JSON.stringify(value))
      continue
    }

    // Primitives
    formData.append(key, String(value))
  }

  return formData
}
