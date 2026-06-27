import React from 'react';

/**
 * Icon System - Standardized icon sizes and spacing
 * 
 * This prevents "death by 1,000 inconsistencies" by enforcing:
 * - Fixed icon scale (no random sizes)
 * - Context-based size mapping
 * - Consistent spacing rhythm
 */

// 1. Fixed icon scale - DO NOT improvise
export const ICON_SIZES = {
  xs: "w-3 h-3",   // 12px → tiny indicators
  sm: "w-4 h-4",   // 16px → inline text, tables
  md: "w-5 h-5",   // 20px → default UI
  lg: "w-6 h-6",   // 24px → sidebar, primary actions
  xl: "w-7 h-7",   // 28px ← collapsed sidebar
  xxl: "w-8 h-8"   // 32px → hero / empty states
} as const;

// 2. Context-based size mapping (enforced usage)
export const ICON_CONTEXT_SIZES = {
  // Navigation contexts
  sidebar_expanded: "lg" as const,      // 24px
  sidebar_collapsed: "xl" as const,    // 28px
  top_navigation: "md" as const,       // 20px
  
  // Interactive elements
  button_primary: "md" as const,        // 20px
  button_secondary: "sm" as const,      // 16px
  
  // Content contexts
  table_actions: "sm" as const,         // 16px
  inline_text: "sm" as const,           // 16px
  status_indicator: "xs" as const,      // 12px
  
  // Visual hierarchy
  empty_state: "xxl" as const,         // 32px
  hero_section: "xxl" as const         // 32px
} as const;

// 3. Spacing system (critical for rhythm)
export const SPACING = {
  xs: "gap-1 p-1",    // 4px gaps/padding
  sm: "gap-2 p-2",    // 8px gaps/padding
  md: "gap-3 p-3",    // 12px gaps/padding
  lg: "gap-4 p-4",    // 16px gaps/padding
  xl: "gap-6 p-6",    // 24px gaps/padding
  xxl: "gap-8 p-8"    // 32px gaps/padding
} as const;

// 4. Context-based spacing mapping
export const SPACING_CONTEXT = {
  button_content: "sm" as const,        // 8px gap between icon and text
  sidebar_item: "sm" as const,          // 8px padding
  card_content: "md" as const,          // 12px padding
  section_spacing: "lg" as const,      // 16px gap between sections
  container_padding: "xl" as const      // 24px padding for containers
} as const;

// 5. Types for strict enforcement
export type IconSize = keyof typeof ICON_SIZES;
export type IconContext = keyof typeof ICON_CONTEXT_SIZES;
export type SpacingSize = keyof typeof SPACING;
export type SpacingContext = keyof typeof SPACING_CONTEXT;

// 6. AppIcon wrapper component (non-negotiable enforcement)
export interface AppIconProps {
  icon: React.ElementType;
  size?: IconSize;
  context?: IconContext;
  className?: string;
}

export function AppIcon({ 
  icon: Icon, 
  size = "md", 
  context,
  className = "" 
}: AppIconProps) {
  // Use context-based size if provided, otherwise use explicit size
  const finalSize = context ? ICON_CONTEXT_SIZES[context] : size;
  const sizeClasses = ICON_SIZES[finalSize];
  
  return <Icon className={`${sizeClasses} ${className}`} />;
}

// 7. Helper for consistent icon + text combinations
export interface IconTextProps {
  icon: React.ElementType;
  children: React.ReactNode;
  iconSize?: IconSize;
  iconContext?: IconContext;
  spacing?: SpacingSize;
  spacingContext?: SpacingContext;
  className?: string;
  as?: React.ElementType;
}

export function IconText({
  icon,
  children,
  iconSize = "sm",
  iconContext,
  spacing = "sm",
  spacingContext,
  className = "",
  as: Component = "div"
}: IconTextProps) {
  const spacingClasses = spacingContext 
    ? SPACING[SPACING_CONTEXT[spacingContext]]
    : SPACING[spacing];
  
  return (
    <Component className={`flex items-center ${spacingClasses} ${className}`}>
      <AppIcon icon={icon} size={iconSize} context={iconContext} />
      {children}
    </Component>
  );
}
