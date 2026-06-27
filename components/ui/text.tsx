import React from "react"

// 🔥 Controlled text contract - minimum viable typography system
// Not a design system. A controlled text contract.

export const TEXT_VARIANTS = {
  // Headings
  h1: "text-2xl font-semibold",
  h2: "text-xl font-semibold", 
  h3: "text-lg font-medium",

  // Body
  body: "text-sm text-gray-700 dark:text-gray-300",
  bodyMuted: "text-sm text-gray-500 dark:text-gray-400",

  // Labels
  label: "text-xs font-medium text-gray-600 dark:text-gray-400",

  // UI states
  error: "text-sm text-red-600 dark:text-red-400",
  success: "text-sm text-green-600 dark:text-green-400", 
  warning: "text-sm text-yellow-600 dark:text-yellow-400",

  // Buttons
  button: "text-sm font-medium",

  // Table
  tableHeader: "text-xs font-semibold text-gray-500 uppercase dark:text-gray-400",
  tableCell: "text-sm text-gray-700 dark:text-gray-300"
} as const

type TextProps = {
  variant?: keyof typeof TEXT_VARIANTS
  as?: React.ElementType
  children: React.ReactNode
  className?: string
}

export function Text({
  variant = "body",
  as: Component = "p",
  children,
  className = ""
}: TextProps) {
  const ComponentToRender = Component
  
  return (
    <ComponentToRender className={`${TEXT_VARIANTS[variant]} ${className}`}>
      {children}
    </ComponentToRender>
  )
}
