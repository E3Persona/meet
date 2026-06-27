# Loader Component Documentation

## Overview

The `Loader` component is a centralized, reusable loading spinner for all inline loading states across the enterprise application. It provides consistent visual feedback without creating layout shifts.

## API Reference

```tsx
<Loader size="sm | md | lg" className?: string />
```

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `size` | `"sm" \| "md" \| "lg"` | `"md"` | Loader size variant |
| `className` | `string` | - | Additional CSS classes |

### Size Specifications

| Size | Dimensions | Use Case |
|------|------------|----------|
| `sm` | `w-3 h-3` | Buttons and inline text |
| `md` | `w-4 h-4` | Default inline usage |
| `lg` | `w-6 h-6` | Emphasis (rare) |

## Usage Rules

### DO Use Loader For:
- **Buttons**: Inline spinner during loading state
- **Input actions**: Inline loading indicators
- **Inline contexts**: Small, contained loading states

### DO NOT Use Loader For:
- **Tables**: Use `Skeleton` component instead
- **Pages**: Use `Skeleton` component instead  
- **Cards**: Use `Skeleton` component instead

## Examples

### Button Loading State
```tsx
import { Loader } from "@/components/ui/loader"
import { Button } from "@/components/ui/button"

function SubmitButton() {
  const [isLoading, setIsLoading] = useState(false)

  return (
    <Button disabled={isLoading}>
      {isLoading ? (
        <>
          <Loader size="sm" className="mr-2" />
          Submitting...
        </>
      ) : (
        "Submit"
      )}
    </Button>
  )
}
```

### Inline Loading
```tsx
function StatusIndicator() {
  const [loading, setLoading] = useState(false)

  return (
    <div className="flex items-center gap-2">
      {loading && <Loader size="sm" />}
      <span>{loading ? "Updating..." : "Updated"}</span>
    </div>
  )
}
```

### Default Inline Usage
```tsx
function LoadingText() {
  return (
    <div className="flex items-center gap-2">
      <Loader />
      <span>Loading data...</span>
    </div>
  )
}
```

### Emphasis Loading
```tsx
function CriticalAction() {
  return (
    <div className="flex items-center gap-3">
      <Loader size="lg" />
      <span className="text-lg">Processing critical operation...</span>
    </div>
  )
}
```

## Design Principles

### Visual Design
- **Circular spinner**: Border-based animation
- **Minimal**: No fancy animations or effects
- **System colors**: Uses `text-current` to adapt to context
- **Lightweight**: Fast rendering with minimal CSS

### Behavior
- **No layout shift**: Inline-friendly sizing
- **Inline alignment**: Works with text and icons
- **Contextual color**: Adapts to parent text color
- **Accessibility**: Includes screen reader support

## System Integration

The Loader is exported from the main UI barrel:
```tsx
import { Loader } from "@/components/ui"
```

## Implementation Details

### CSS Classes
```css
/* Base spinner */
.animate-spin rounded-full border-2 border-transparent border-t-current

/* Size variants */
.sm: w-3 h-3
.md: w-4 h-4  
.lg: w-6 h-6
```

### Accessibility
- `role="status"` for screen readers
- `aria-label="Loading"` for semantic meaning
- `sr-only` text for visual-only content

## Migration Guide

### From Loader2 (Lucide)
```tsx
// Old
<Loader2 className="h-4 w-4 animate-spin" />

// New  
<Loader size="sm" />
```

### From Custom Spinners
```tsx
// Old
<div className="animate-spin border-2 border-t-blue-500 w-4 h-4 rounded-full" />

// New
<Loader size="md" className="text-blue-500" />
```

## Best Practices

1. **Consistent sizing**: Use the appropriate size for the context
2. **Inline usage**: Keep loaders inline with their content
3. **Semantic meaning**: Pair with descriptive text when possible
4. **Avoid overuse**: Don't use for large content areas (use Skeleton instead)
5. **Color consistency**: Let the loader inherit text color unless specific coloring is needed
