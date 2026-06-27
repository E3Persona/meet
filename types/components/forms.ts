import React from "react"

// ─── Field Column Span ────────────────────────────────────────────────────────
export type ColSpan = 1 | 2 | 3 | 4 | "full"

// ─── Field Types ──────────────────────────────────────────────────────────────
export type FieldType =
  | "text"
  | "email"
  | "phone"
  | "number"
  | "textarea"
  | "select"
  | "multi-select"
  | "radio"
  | "checkbox"
  | "toggle"
  | "date"
  | "datetime"
  | "file"
  | "password"
  | "custom"

// ─── Select Option ────────────────────────────────────────────────────────────
export interface SelectOption {
  label: string
  value: string
  icon?: React.ReactNode
  disabled?: boolean
}

// ─── Base Field Definition ────────────────────────────────────────────────────
export interface BaseFieldDef {
  name: string
  label: string
  type: FieldType
  placeholder?: string
  helperText?: string
  required?: boolean
  disabled?: boolean
  /** Grid column span (default: 2, i.e. half of a 4-col grid) */
  colSpan?: ColSpan
}

export interface TextField extends BaseFieldDef {
  type: "text" | "email" | "phone" | "number" | "password"
}

export interface TextareaField extends BaseFieldDef {
  type: "textarea"
  rows?: number
}

export interface SelectField extends BaseFieldDef {
  type: "select"
  options: SelectOption[]
}

export interface MultiSelectField extends BaseFieldDef {
  type: "multi-select"
  options: SelectOption[]
}

export interface RadioField extends BaseFieldDef {
  type: "radio"
  options: SelectOption[]
  inline?: boolean
}

export interface CheckboxField extends BaseFieldDef {
  type: "checkbox"
  checkboxLabel?: string
}

export interface ToggleField extends BaseFieldDef {
  type: "toggle"
  toggleLabel?: string
}

export interface DateField extends BaseFieldDef {
  type: "date" | "datetime"
}

export interface FileFieldDef extends BaseFieldDef {
  type: "file"
  accept?: string
  multiple?: boolean
  maxFiles?: number
  maxSizeMB?: number
  /** Existing URLs to show in edit mode */
  existingUrls?: string[]
}

export interface CustomField extends BaseFieldDef {
  type: "custom"
  render: (props: { value: unknown; onChange: (v: unknown) => void; error?: string }) => React.ReactNode
}

export type FieldDef =
  | TextField
  | TextareaField
  | SelectField
  | MultiSelectField
  | RadioField
  | CheckboxField
  | ToggleField
  | DateField
  | FileFieldDef
  | CustomField

// ─── Section ──────────────────────────────────────────────────────────────────
export interface FormSection {
  id: string
  title: string
  description?: string
  /** Number of columns in this section's grid (default: 4) */
  columns?: 2 | 4
  fields: FieldDef[]
}

// ─── Wizard Step ──────────────────────────────────────────────────────────────
export interface WizardStep {
  id: string
  title: string
  description?: string
  /** Emoji or icon shown in the step indicator (e.g. "🏢", "👥", "✨") */
  icon?: string
  /** Encouraging message shown when this step is completed */
  completionMessage?: string
  sections: FormSection[]
}

// ─── Form Mode ────────────────────────────────────────────────────────────────
export type FormMode = "create" | "edit" | "view"

// ─── Form Variant ─────────────────────────────────────────────────────────────
export type FormVariant = "standard" | "wizard" | "section-edit"

// ─── Uploaded File ────────────────────────────────────────────────────────────
export interface UploadedFile {
  id: string
  name: string
  size?: number
  type?: string
  file: File
  url?: string
  status: "pending" | "uploading" | "success" | "error"
  progress?: number
  errorMessage?: string
  /** Returned URL after upload */
  remoteUrl?: string
}