"use client"

import React, { useState } from "react"
import { cn } from "@/lib/utils"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../card"
import { ChevronDown, ChevronUp, Pencil } from "lucide-react"
import {
  FormSection as FormSectionType,
  WizardStep,
  FormMode,
  FormVariant,
} from "@/types/components"
import { FormSectionBlock } from "./form-section"
import { FormFooter } from "./form-footer"
import { WizardStepIndicator } from "./wizard-step-indicator"

// ─── Base Props ───────────────────────────────────────────────────────────────

interface UniversalFormBaseProps {
  title: string
  description?: string
  mode?: FormMode
  isLoading?: boolean
  onCancel?: () => void

  values: Record<string, unknown>
  errors?: Record<string, string>
  onChange: (name: string, value: unknown) => void

  primaryLabel?: string
  sticky?: boolean
  className?: string
  children?: React.ReactNode
  formClassName?: string
  primaryFullWidth?: boolean
  /** Remove Card wrapper — renders form content directly */
  bare?: boolean
}

// ─── Variant: Standard ────────────────────────────────────────────────────────

interface StandardFormProps extends UniversalFormBaseProps {
  variant?: "standard"
  sections: FormSectionType[]
  onSubmit: (values: Record<string, unknown>) => void
}

// ─── Variant: Wizard ──────────────────────────────────────────────────────────

interface WizardFormProps extends UniversalFormBaseProps {
  variant: "wizard"
  steps: WizardStep[]
  onSubmit: (values: Record<string, unknown>) => void
  /** Called on step change for per-step validation */
  onValidateStep?: (
    stepIndex: number,
    values: Record<string, unknown>
  ) => Record<string, string>
  /** Render custom content per step (replaces children inside step area) */
  renderStepContent?: (stepIndex: number) => React.ReactNode
}

// ─── Variant: Section Edit ────────────────────────────────────────────────────

interface SectionEditFormProps extends UniversalFormBaseProps {
  variant: "section-edit"
  sections: FormSectionType[]
  /** Which section ids are open by default */
  defaultOpenSections?: string[]
  onSectionSave?: (
    sectionId: string,
    values: Record<string, unknown>
  ) => void | Promise<void>
}

export type UniversalFormProps =
  | StandardFormProps
  | WizardFormProps
  | SectionEditFormProps

// ─── Form Header ──────────────────────────────────────────────────────────────

function FormHeader({
  title,
  description,
}: {
  title: string
  description?: string
}) {
  return (
    <CardHeader className="pb-4">
      <CardTitle className="text-base font-semibold">{title}</CardTitle>
      {description && (
        <CardDescription className="text-sm">{description}</CardDescription>
      )}
    </CardHeader>
  )
}

// ─── Standard Form ────────────────────────────────────────────────────────────

function StandardForm(props: StandardFormProps) {
  const formContent = (
    <>
      {props.children}
      {!props.bare && (
        <FormHeader title={props.title} description={props.description} />
      )}
      <CardContent className="space-y-8">
        {props.sections.map((section) => (
          <FormSectionBlock
            key={section.id}
            section={section}
            values={props.values}
            errors={props.errors ?? {}}
            onChange={props.onChange}
          />
        ))}
        <FormFooter
          primaryLabel={
            props.primaryLabel ?? (props.mode === "edit" ? "Update" : "Create")
          }
          onPrimary={() => props.onSubmit(props.values)}
          onSecondary={props.onCancel}
          isLoading={props.isLoading}
          sticky={props.sticky}
          primaryFullWidth={props.primaryFullWidth ?? true}
        />
      </CardContent>
    </>
  )

  return (
    <form
      encType="multipart/form-data"
      onSubmit={(e) => {
        e.preventDefault()
        props.onSubmit(props.values)
      }}
      className={cn(!props.bare && "w-full max-w-xl mx-auto", props.bare && props.formClassName)}
    >
      {props.bare ? (
        formContent
      ) : (
        <Card className={cn("w-full max-w-xl mx-auto", props.formClassName)}>
          {formContent}
        </Card>
      )}
    </form>
  )
}

// ─── Wizard Form ──────────────────────────────────────────────────────────────

function WizardForm(props: WizardFormProps) {
  const [step, setStep] = useState(0)
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({})
  const isLast = step === props.steps.length - 1

  const handleNext = () => {
    const errs = props.onValidateStep?.(step, props.values) ?? {}
    if (Object.keys(errs).length > 0) {
      setLocalErrors(errs)
      return
    }
    setLocalErrors({})
    setStep((s) => s + 1)
  }

  const currentStep = props.steps[step]

  const formContent = (
    <>
      {!props.bare && (
        <FormHeader title={props.title} description={props.description} />
      )}
      <CardContent className="space-y-6">
        <WizardStepIndicator steps={props.steps} currentStep={step} />

        {/* Step header */}
        <div>
          <p className="text-sm font-semibold text-foreground">
            {currentStep?.title}
          </p>
          {currentStep?.description && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {currentStep?.description}
            </p>
          )}
        </div>

        {/* Step sections */}
        <div className="space-y-8">
          {currentStep?.sections.map((section) => (
            <FormSectionBlock
              key={section.id}
              section={section}
              values={props.values}
              errors={{ ...props.errors, ...localErrors }}
              onChange={props.onChange}
            />
          ))}
        </div>

        {props.renderStepContent?.(step)}

        <FormFooter
          primaryLabel={isLast ? (props.primaryLabel ?? "Submit") : undefined}
          onSecondary={props.onCancel}
          isLoading={props.isLoading}
          sticky={props.sticky}
          showBack={step > 0}
          onBack={() => setStep((s) => s - 1)}
          showNext={!isLast}
          onNext={handleNext}
          onPrimary={isLast ? () => props.onSubmit(props.values) : undefined}
          primaryFullWidth={props.primaryFullWidth ?? true}
        />
      </CardContent>
    </>
  )

  return (
    <form
      encType="multipart/form-data"
      onSubmit={(e) => {
        e.preventDefault()
        isLast && props.onSubmit(props.values)
      }}
      className={cn(!props.bare && "w-full max-w-xl mx-auto", props.bare && props.formClassName)}
    >
      {props.bare ? (
        formContent
      ) : (
        <Card className={cn("w-full max-w-xl mx-auto", props.formClassName)}>
          {formContent}
        </Card>
      )}
    </form>
  )
}

// ─── Section Edit Form ────────────────────────────────────────────────────────

function SectionEditForm(props: SectionEditFormProps) {
  const defaultOpen = new Set(props.defaultOpenSections ?? [])
  const [openSections, setOpenSections] = useState<Set<string>>(defaultOpen)
  const [savingSection, setSavingSection] = useState<string | null>(null)

  const toggle = (id: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const handleSave = async (sectionId: string) => {
    setSavingSection(sectionId)
    await props.onSectionSave?.(sectionId, props.values)
    setSavingSection(null)
    setOpenSections((prev) => {
      const next = new Set(prev)
      next.delete(sectionId)
      return next
    })
  }

  const SectionWrapper = props.bare ? "div" : Card

  return (
    <div className={cn("w-full space-y-3", props.formClassName)}>
      {props.children}
      {/* Page header */}
      <div className="mb-4">
        <h2 className="text-base font-semibold text-foreground">
          {props.title}
        </h2>
        {props.description && (
          <p className="mt-0.5 text-sm text-muted-foreground">
            {props.description}
          </p>
        )}
      </div>

      {props.sections.map((section) => {
        const isOpen = openSections.has(section.id)
        const isSaving = savingSection === section.id

        return (
          <SectionWrapper
            key={section.id}
            className={cn(!props.bare && "overflow-hidden")}
          >
            <form
              encType="multipart/form-data"
              onSubmit={(e) => {
                e.preventDefault()
                handleSave(section.id)
              }}
            >
              {/* Section header (always visible) */}
              <button
                type="button"
                onClick={() => toggle(section.id)}
                className="flex w-full items-center justify-between px-5 py-4 text-left transition-colors hover:bg-muted/30"
              >
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {section.title}
                  </p>
                  {section.description && !isOpen && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {section.description}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  {!isOpen && <Pencil className="h-3.5 w-3.5" />}
                  {isOpen ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </div>
              </button>

              {/* Collapsible content */}
              {isOpen && (
                <CardContent className="space-y-4 border-t border-border pt-5 pb-5">
                  <FormSectionBlock
                    section={section}
                    values={props.values}
                    errors={props.errors ?? {}}
                    onChange={props.onChange}
                  />
                  <FormFooter
                    primaryLabel="Save Section"
                    secondaryLabel="Discard"
                    onPrimary={() => handleSave(section.id)}
                    onSecondary={() => toggle(section.id)}
                    isLoading={isSaving}
                    primaryFullWidth={props.primaryFullWidth}
                  />
                </CardContent>
              )}
            </form>
          </SectionWrapper>
        )
      })}
    </div>
  )
}

// ─── Unified Export ───────────────────────────────────────────────────────────

export function UniversalForm(props: UniversalFormProps) {
  if (props.variant === "wizard") return <WizardForm {...props} />
  if (props.variant === "section-edit") return <SectionEditForm {...props} />
  return <StandardForm {...(props as StandardFormProps)} />
}
