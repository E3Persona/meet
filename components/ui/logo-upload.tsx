"use client"

import { useState, useRef } from "react"
import { Button } from "./button"
import { Upload, X, Building2 } from "lucide-react"

interface LogoUploadProps {
  value: string | null
  onChange: (url: string | null) => void
  label?: string
  className?: string
}

export function LogoUpload({ value, onChange, label, className }: LogoUploadProps) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file type
    if (!file.type.startsWith("image/")) {
      setError("Please upload an image file")
      return
    }

    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      setError("Image must be less than 2MB")
      return
    }

    setUploading(true)
    setError("")

    try {
      // Convert to base64 data URL for now
      // In production, upload to Supabase Storage
      const reader = new FileReader()
      reader.onload = () => {
        onChange(reader.result as string)
        setUploading(false)
      }
      reader.onerror = () => {
        setError("Failed to read file")
        setUploading(false)
      }
      reader.readAsDataURL(file)
    } catch {
      setError("Upload failed")
      setUploading(false)
    }
  }

  const handleRemove = () => {
    onChange(null)
    if (inputRef.current) {
      inputRef.current.value = ""
    }
  }

  return (
    <div className={className}>
      {label && (
        <label className="mb-1.5 block text-sm font-medium text-foreground">
          {label}
        </label>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={handleUpload}
        className="hidden"
      />

      {value ? (
        <div className="relative inline-block">
          <div className="relative h-24 w-24 overflow-hidden rounded-lg border border-border">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={value}
              alt="Logo preview"
              className="h-full w-full object-cover"
            />
          </div>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="absolute -right-2 -top-2 h-6 w-6 rounded-full p-0"
            onClick={handleRemove}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex h-24 w-24 flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted/30 transition-colors hover:border-primary/50 hover:bg-muted/50"
        >
          {uploading ? (
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          ) : (
            <>
              <Building2 className="h-8 w-8 text-muted-foreground/50" />
              <Upload className="mt-1 h-3 w-3 text-muted-foreground/50" />
            </>
          )}
        </button>
      )}

      {error && (
        <p className="mt-1 text-xs text-destructive">{error}</p>
      )}
    </div>
  )
}
