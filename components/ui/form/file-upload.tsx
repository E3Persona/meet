"use client"

import React, { useCallback, useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { Button } from "../button"
import { Progress } from "../progress"
import {
  UploadCloud,
  X,
  FileText,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
} from "lucide-react"
import { AppIcon, IconText } from "../icon"
import { Text } from "../text"
import {
  genId,
  formatBytes,
  isImageFile,
  isImageUrl,
  DEFAULT_MAX_FILES,
  DEFAULT_MAX_SIZE_MB,
} from "@/lib/constants/form"
import { UploadedFile } from "@/types/components/forms"

// ─── Existing URL card (edit mode) ────────────────────────────────────────────

interface ExistingFileCardProps {
  url: string
  onRemove: (url: string) => void
}

const ExistingFileCard = React.memo(function ExistingFileCard({ url, onRemove }: ExistingFileCardProps) {
  const isImage = isImageUrl(url)
  const filename = url.split("/").pop()?.split("?")[0] ?? "file"

  return (
    <div className="group relative overflow-hidden rounded-lg border border-border bg-muted/30">
      {isImage ? (
        <img src={url} alt={filename} className="h-24 w-full object-cover" />
      ) : (
        <div className="flex h-24 flex-col items-center justify-center gap-1 px-2">
          <AppIcon
            icon={FileText}
            size="lg"
            className="text-muted-foreground"
          />
          <Text
            variant="bodyMuted"
            className="w-full truncate text-center text-xs"
          >
            {filename}
          </Text>
        </div>
      )}
      <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="rounded-full bg-white/20 p-1.5 transition-colors hover:bg-white/40"
          onClick={(e) => e.stopPropagation()}
        >
          <AppIcon icon={ExternalLink} size="sm" className="text-white" />
        </a>
        <Button
          type="button"
          onClick={() => onRemove(url)}
          size="sm"
          className="rounded-full bg-white/20 p-1.5 transition-colors hover:bg-red-500/80"
        >
          <AppIcon icon={X} size="sm" className="text-white" />
        </Button>
      </div>
    </div>
  )
})

// ─── New file card (progress / preview) ──────────────────────────────────────

interface NewFileCardProps {
  file: UploadedFile
  onRemove: (id: string) => void
}

const NewFileCard = React.memo(function NewFileCard({ file, onRemove }: NewFileCardProps) {
  const isImage = !!file.url

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-lg border bg-muted/30",
        file.status === "error" && "border-destructive/50",
        file.status === "success" && "border-green-500/50",
        file.status === "uploading" && "border-border"
      )}
    >
      {isImage ? (
        <img
          src={file.url ?? ""}
          alt={file.name}
          className="h-24 w-full object-cover"
          draggable={false}
        />
      ) : (
        <div className="flex h-24 flex-col items-center justify-center gap-1 px-2">
          <AppIcon
            icon={FileText}
            size="lg"
            className="text-muted-foreground"
          />
          <Text
            variant="bodyMuted"
            className="w-full truncate text-center text-xs"
          >
            {file.name}
          </Text>
          <Text variant="bodyMuted" className="text-[10px] opacity-60">
            {formatBytes(file.size ?? 0)}
          </Text>
        </div>
      )}

      {file.status === "uploading" && (
        <div className="absolute right-0 bottom-0 left-0 bg-linear-to-t from-black/60 to-transparent px-2 pb-2">
          <Progress value={file.progress} className="h-1" />
        </div>
      )}

      {file.status === "success" && (
        <div className="absolute right-1.5 bottom-1.5">
          <AppIcon
            icon={CheckCircle2}
            size="sm"
            className="text-green-400 drop-shadow"
          />
        </div>
      )}
      {file.status === "error" && (
        <div className="absolute right-1.5 bottom-1.5">
          <AppIcon
            icon={AlertCircle}
            size="sm"
            className="text-destructive drop-shadow"
          />
        </div>
      )}

      <Button
        type="button"
        onClick={() => onRemove(file.id)}
        size="sm"
        className="absolute top-1.5 right-1.5 rounded-full bg-black/40 p-1 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-red-500/80"
      >
        <AppIcon icon={X} size="xs" className="text-white" />
      </Button>
    </div>
  )
})

// ─── Drop Zone ────────────────────────────────────────────────────────────────

interface DropZoneProps {
  isDragging: boolean
  onClick: () => void
  multiple?: boolean
  accept?: string
  compact?: boolean
  label?: string
  disabled?: boolean
}

function DropZone({
  isDragging,
  onClick,
  multiple,
  accept,
  compact,
  label,
  disabled,
}: DropZoneProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed text-center transition-all",
        compact ? "p-4" : "p-6",
        disabled
          ? "cursor-not-allowed border-border/50 bg-muted/30 opacity-60"
          : isDragging
            ? "scale-[1.01] border-primary bg-primary/5"
            : "border-border hover:border-primary/40 hover:bg-muted/30"
      )}
    >
      <div
        className={cn(
          "rounded-full transition-colors",
          compact ? "p-2" : "p-3",
          isDragging ? "bg-primary/10" : "bg-muted"
        )}
      >
        <AppIcon
          icon={UploadCloud}
          size={compact ? "md" : "lg"}
          className={cn(
            "transition-colors",
            isDragging ? "text-primary" : "text-muted-foreground"
          )}
        />
      </div>
      <div>
        <Text variant="body" className="text-sm font-medium text-foreground">
          {disabled ? (
            "Maximum files reached"
          ) : label ?? (
            <>
              Drop files here or{" "}
              <span className="text-primary underline-offset-2 hover:underline">
                browse
              </span>
            </>
          )}
        </Text>
        {!compact && (
          <Text variant="bodyMuted" className="mt-0.5 text-xs">
            {disabled
              ? `Remove a file to add more`
              : accept
                ? `Accepted: ${accept}`
                : "Any file type"
            }
            {!disabled && multiple ? " · Multiple files allowed" : ""}
          </Text>
        )}
      </div>
    </button>
  )
}

// ─── Main FileUpload Component ────────────────────────────────────────────────

export interface FileUploadProps {
  existingUrls?: string[]
  onExistingUrlsChange?: (urls: string[]) => void
  files?: UploadedFile[]
  onFilesChange?: (files: UploadedFile[]) => void
  accept?: string
  multiple?: boolean
  maxFiles?: number
  maxSizeMB?: number
  disabled?: boolean
  onUpload?: (file: File, onProgress: (pct: number) => void) => Promise<string>
  error?: string
  className?: string
  /** Label displayed above the dropzone */
  label?: string
  /** Compact dropzone with smaller padding */
  compact?: boolean
  /** Hide the dropzone entirely (files can still be managed via existing cards) */
  hideDropZone?: boolean
}

// Module-level counter as a tiebreaker in case genId() ever collides
// (e.g. time-based ids generated within the same tick).
let localIdCounter = 0

export function FileUpload({
  existingUrls = [],
  onExistingUrlsChange,
  files: controlledFiles,
  onFilesChange,
  accept,
  multiple = true,
  maxFiles = DEFAULT_MAX_FILES,
  maxSizeMB = DEFAULT_MAX_SIZE_MB,
  disabled,
  onUpload,
  error,
  className,
  label,
  compact = false,
  hideDropZone = false,
}: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [internalFiles, setInternalFiles] = useState<UploadedFile[]>([])

  const isControlled = controlledFiles !== undefined
  const files = isControlled ? controlledFiles : internalFiles

  // Keep a ref always pointing to latest files to avoid stale closures in async upload
  const filesRef = useRef<UploadedFile[]>(files)
  useEffect(() => {
    filesRef.current = files
  }, [files])

  // Guards against setState calls (and the re-renders/reconciliation they
  // trigger) firing after this component has been unmounted — e.g. a wizard
  // step switch happening while an upload promise is still in flight.
  const isMountedRef = useRef(true)
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      // Defer blob URL revocation so it doesn't run inside the same
      // synchronous unmount commit that's already detaching the <img>
      // nodes — revoking mid-commit is what produces the stray
      // "removeChild: not a child of this node" crash.
      const toRevoke = filesRef.current
        .filter((f) => f.url?.startsWith("blob:"))
        .map((f) => f.url!)
      if (toRevoke.length > 0) {
        setTimeout(() => {
          toRevoke.forEach((url) => URL.revokeObjectURL(url))
        }, 0)
      }
    }
  }, [])

  const setFiles = useCallback(
    (updater: UploadedFile[] | ((prev: UploadedFile[]) => UploadedFile[])) => {
      if (!isMountedRef.current) return
      const next =
        typeof updater === "function" ? updater(filesRef.current) : updater
      filesRef.current = next
      if (isControlled) {
        onFilesChange?.(next)
      } else {
        setInternalFiles(next)
      }
    },
    [isControlled, onFilesChange]
  )

  const totalCount = existingUrls.length + files.length

  // ── Add files ───────────────────────────────────────────────────────────────
  const addFiles = useCallback(
    async (incoming: File[]) => {
      const maxBytes = maxSizeMB * 1024 * 1024
      // When maxFiles is 1 (e.g. a logo field) and a file already exists,
      // treat a new selection as a REPLACEMENT rather than silently
      // dropping it because "available" computed to 0.
      const isSingleReplace = maxFiles === 1 && !multiple
      const available = isSingleReplace
        ? 1
        : maxFiles - (existingUrls.length + filesRef.current.length)
      const slice = incoming.slice(0, Math.max(available, 0))

      if (slice.length === 0) return

      const newEntries: UploadedFile[] = slice
        .filter((f) => f.size <= maxBytes)
        .map(
          (f) =>
            ({
              id: `${genId()}-${localIdCounter++}`,
              name: f.name,
              file: f,
              size: f.size,
              url: isImageFile(f) ? URL.createObjectURL(f) : undefined,
              progress: onUpload ? 0 : 100,
              status: onUpload ? "uploading" : "success",
            }) as UploadedFile
        )

      if (newEntries.length === 0) return

      // For single-file fields, clear out the old entry first (revoking its
      // blob URL) instead of letting old + new coexist momentarily — this
      // avoids a brief state where two cards occupy a "max 1" slot, which
      // can confuse the grid's reconciliation.
      if (isSingleReplace) {
        for (const old of filesRef.current) {
          if (old.url && old.url.startsWith("blob:")) {
            URL.revokeObjectURL(old.url)
          }
        }
        setFiles(newEntries)
      } else {
        setFiles((prev) => [...prev, ...newEntries])
      }

      if (!onUpload) return

      for (const entry of newEntries) {
        try {
          const url = await onUpload(entry.file, (pct) => {
            if (!isMountedRef.current) return
            setFiles((prev) =>
              prev.map((f) => (f.id === entry.id ? { ...f, progress: pct } : f))
            )
          })
          if (!isMountedRef.current) return
          setFiles((prev) =>
            prev.map((f) =>
              f.id === entry.id
                ? { ...f, status: "success", progress: 100, remoteUrl: url }
                : f
            )
          )
        } catch {
          if (!isMountedRef.current) return
          setFiles((prev) =>
            prev.map((f) =>
              f.id === entry.id
                ? { ...f, status: "error", errorMessage: "Upload failed" }
                : f
            )
          )
        }
      }
    },
    [existingUrls.length, maxFiles, multiple, maxSizeMB, onUpload, setFiles]
  )

  // ── Drag handlers ────────────────────────────────────────────────────────────
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }
  const handleDragLeave = () => setIsDragging(false)
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    if (disabled || isFull) return
    addFiles(Array.from(e.dataTransfer.files))
  }

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files
    if (fileList && fileList.length > 0) {
      addFiles(Array.from(fileList))
    }
    // Reset so selecting the same file again still fires onChange
    e.target.value = ""
  }

  const removeExisting = (url: string) => {
    onExistingUrlsChange?.(existingUrls.filter((u) => u !== url))
  }

  const removeNew = (id: string) => {
    const f = filesRef.current.find((f) => f.id === id)
    if (f?.url && f.url.startsWith("blob:")) URL.revokeObjectURL(f.url)
    setFiles((prev) => prev.filter((f) => f.id !== id))
    if (inputRef.current) inputRef.current.value = ""
  }

  const hasFiles = existingUrls.length > 0 || files.length > 0
  const isFull = totalCount >= maxFiles && !(maxFiles === 1 && !multiple)
  const showDropZone = !disabled && !hideDropZone

  return (
    <div
      className={cn("space-y-3", className)}
      onDragOver={!isFull ? handleDragOver : undefined}
      onDragLeave={!isFull ? handleDragLeave : undefined}
      onDrop={!isFull ? handleDrop : undefined}
    >
      {label && showDropZone && (
        <Text variant="label" className="text-sm font-medium text-foreground">
          {label}
        </Text>
      )}

      {showDropZone && (
        <DropZone
          isDragging={isDragging}
          onClick={() => !isFull && inputRef.current?.click()}
          multiple={multiple}
          accept={accept}
          compact={compact}
          disabled={isFull}
        />
      )}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={handleInput}
      />

      {error && (
        <IconText
          icon={AlertCircle}
          iconSize="xs"
          spacing="xs"
          className="text-xs text-destructive"
        >
          {error}
        </IconText>
      )}

      <div
        className={cn(
          "grid gap-2",
          compact ? "grid-cols-3 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4",
          !hasFiles && "hidden"
        )}
      >
        {Array.isArray(existingUrls) && existingUrls.map((url) => (
          <ExistingFileCard key={url} url={url} onRemove={removeExisting} />
        ))}
        {Array.isArray(files) && files.map((f) => (
          <NewFileCard key={f.id} file={f} onRemove={removeNew} />
        ))}
      </div>

      <Text variant="bodyMuted" className={cn("text-xs", !hasFiles && "hidden")}>
        {totalCount} / {maxFiles} files
      </Text>
    </div>
  )
}