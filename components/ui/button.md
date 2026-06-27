# Button Component Documentation

## Overview

The `Button` component is a standardized, reusable button system built on shadcn UI with improved sizing, icon support, and built-in loading state. It enforces consistency while providing better usability and visual balance.

## API Reference

```tsx
<Button
  variant="primary | secondary | outline | subtle | destructive | text"
  size="sm | md | lg | icon"
  loading={boolean}
  leftIcon={ReactNode}
  rightIcon={ReactNode}
  disabled={boolean}
  onClick={function}
  type="button | submit | reset"
  asChild={boolean}
>
  Label
</Button>
```

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `"primary" \| "secondary" \| "outline" \| "subtle" \| "destructive" \| "text"` | `"primary"` | Button style variant |
| `size` | `"sm" \| "md" \| "lg" \| "icon"` | `"md"` | Button size |
| `loading` | `boolean` | `false` | Show loading state |
| `leftIcon` | `ReactNode` | - | Icon on the left side |
| `rightIcon` | `ReactNode` | - | Icon on the right side |
| `disabled` | `boolean` | `false` | Disable button |
| `asChild` | `boolean` | `false` | Render as child component |

### Size System (Improved)

| Size | Height | Use Case |
|------|--------|----------|
| `sm` | `36px` (h-9) | Compact actions, table rows |
| `md` | `44px` (h-11) | Default usage, forms |
| `lg` | `52px` (h-13) | Primary actions, emphasis |
| `icon` | `44px × 44px` (h-11 w-11) | Icon-only buttons |

## Variants

### Primary
Main action button with accent color.
```tsx
<Button variant="primary">Save</Button>
```

### Secondary
Subtle background for secondary actions.
```tsx
<Button variant="secondary">Cancel</Button>
```

### Outline
Bordered button for less prominent actions.
```tsx
<Button variant="outline">Edit</Button>
```

### Subtle
Minimal hover effect for tertiary actions.
```tsx
<Button variant="subtle">More</Button>
```

### Destructive
Red styling for destructive actions.
```tsx
<Button variant="destructive">Delete</Button>
```

### Text
Text-only button for inline actions.
```tsx
<Button variant="text">Learn More</Button>
```

## Icon Support

### Left Icon
```tsx
import { Plus } from "lucide-react"

<Button leftIcon={<Plus className="w-4 h-4" />}>
  Add Item
</Button>
```

### Right Icon
```tsx
import { ArrowRight } from "lucide-react"

<Button rightIcon={<ArrowRight className="w-4 h-4" />}>
  Continue
</Button>
```

### Icon-Only
```tsx
import { Settings } from "lucide-react"

<Button variant="outline" size="icon">
  <Settings className="w-4 h-4" />
</Button>
```

## Loading State

### Built-in Loading
The `loading` prop automatically:
- Disables the button
- Replaces left icon with loader or shows loader if no icon
- Preserves text and layout
- Uses the centralized Loader component

```tsx
<Button loading={isLoading}>
  Submit
</Button>
```

### Loading with Icon
```tsx
<Button loading={isLoading} leftIcon={<Send className="w-4 h-4" />}>
  Send Message
</Button>
```

## Interaction States

- **Hover**: Subtle color shift
- **Active**: Slight press effect
- **Focus**: Visible ring with offset
- **Disabled**: Reduced opacity, no interactions
- **Loading**: Disabled with spinner

## Usage Examples

### Form Actions
```tsx
<div className="flex gap-2">
  <Button variant="outline" onClick={handleCancel}>
    Cancel
  </Button>
  <Button loading={isLoading} onClick={handleSubmit}>
    Save Changes
  </Button>
</div>
```

### Navigation
```tsx
<Button variant="text" leftIcon={<ArrowLeft className="w-4 h-4" />}>
  Back
</Button>
```

### Primary Action
```tsx
<Button size="lg" loading={isSubmitting}>
  Create Account
</Button>
```

### Icon Buttons
```tsx
<div className="flex gap-1">
  <Button variant="outline" size="icon">
    <Edit className="w-4 h-4" />
  </Button>
  <Button variant="outline" size="icon">
    <Trash className="w-4 h-4" />
  </Button>
</div>
```

### Wizard Navigation
```tsx
<div className="flex justify-between">
  <Button variant="text" leftIcon={<ArrowLeft className="w-4 h-4" />}>
    Previous
  </Button>
  <Button rightIcon={<ArrowRight className="w-4 h-4" />}>
    Next
  </Button>
</div>
```

## System Rules

### DO
- Use defined variants only
- Use appropriate sizes for context
- Include loading states for async actions
- Use icons consistently (4x4 size)
- Pair with descriptive text

### DON'T
- Override padding or height with custom styles
- Create custom button variants
- Use inline styling
- Mix icon sizes arbitrarily
- Use for navigation links (use Link component)

## Design Principles

### Visual Consistency
- **Rounded corners**: `rounded-lg` (8px)
- **Spacing**: Consistent gap between icon and text
- **Typography**: `font-medium` weight
- **Focus states**: 2px ring with 2px offset

### Accessibility
- **Keyboard navigation**: Full keyboard support
- **Screen readers**: Semantic button element
- **Focus management**: Visible focus indicators
- **Loading states**: Clear feedback during async operations

### Performance
- **Minimal re-renders**: Optimized with React.forwardRef
- **CSS containment**: Efficient layout calculations
- **Icon handling**: No unnecessary icon rendering during loading

## Migration Guide

### From Old Button API
```tsx
// Old
<Button className="h-10 px-4 bg-primary">
  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
  {isLoading ? "Loading..." : "Submit"}
</Button>

// New
<Button loading={isLoading}>
  Submit
</Button>
```

### From Custom Icon Buttons
```tsx
// Old
<button className="p-2 rounded-lg border">
  <Settings className="w-4 h-4" />
</button>

// New
<Button variant="outline" size="icon">
  <Settings className="w-4 h-4" />
</Button>
```

## Integration

The Button component integrates with:
- **Loader**: Built-in loading states
- **Form**: Form submission handling
- **Dialog**: Modal actions
- **Card**: Action buttons
- **Table**: Row actions

## Best Practices

1. **Consistent sizing**: Use `md` for most cases, `lg` for primary actions
2. **Clear actions**: Use descriptive text labels
3. **Loading feedback**: Always show loading state for async operations
4. **Icon consistency**: Use 4x4 icons with consistent styling
5. **Variant hierarchy**: Primary > Secondary > Outline > Subtle > Text
