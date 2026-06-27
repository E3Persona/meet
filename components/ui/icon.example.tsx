/**
 * Icon System Usage Examples
 * 
 * This file demonstrates how to use the standardized icon system
 * to prevent "death by 1,000 inconsistencies"
 */

import { AppIcon, IconText, ICON_SIZES, ICON_CONTEXT_SIZES, SPACING_CONTEXT } from "./icon"

// Example: Using Lucide React icons (you'd install @lucide/react)
// import { PlusIcon, HomeIcon, SettingsIcon, UserIcon } from "lucide-react"

// Mock icons for demonstration (replace with actual icon library)
const PlusIcon = () => <span>+</span>
const HomeIcon = () => <span>🏠</span>
const SettingsIcon = () => <span>⚙️</span>
const UserIcon = () => <span>👤</span>

export function IconExamples() {
  return (
    <div className="space-y-8 p-6">
      <h2 className="text-2xl font-bold">Icon System Examples</h2>
      
      {/* 1. Basic AppIcon usage */}
      <section>
        <h3 className="text-lg font-semibold mb-4">Basic AppIcon Usage</h3>
        <div className="flex gap-4 items-center">
          <AppIcon icon={PlusIcon} size="xs" />
          <AppIcon icon={HomeIcon} size="sm" />
          <AppIcon icon={SettingsIcon} size="md" />
          <AppIcon icon={UserIcon} size="lg" />
          <AppIcon icon={PlusIcon} size="xl" />
          <AppIcon icon={HomeIcon} size="xxl" />
        </div>
        <p className="text-sm text-muted-foreground mt-2">
          xs(12px) sm(16px) md(20px) lg(24px) xl(28px) xxl(32px)
        </p>
      </section>

      {/* 2. Context-based sizing (recommended) */}
      <section>
        <h3 className="text-lg font-semibold mb-4">Context-based Sizing</h3>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <AppIcon icon={HomeIcon} context="sidebar_expanded" />
            <span>Sidebar Expanded (24px)</span>
          </div>
          <div className="flex items-center gap-2">
            <AppIcon icon={HomeIcon} context="sidebar_collapsed" />
            <span>Sidebar Collapsed (28px)</span>
          </div>
          <div className="flex items-center gap-2">
            <AppIcon icon={PlusIcon} context="button_primary" />
            <span>Button Primary (20px)</span>
          </div>
          <div className="flex items-center gap-2">
            <AppIcon icon={SettingsIcon} context="table_actions" />
            <span>Table Actions (16px)</span>
          </div>
        </div>
      </section>

      {/* 3. IconText for consistent icon + text combinations */}
      <section>
        <h3 className="text-lg font-semibold mb-4">IconText Component</h3>
        <div className="space-y-2">
          <IconText icon={HomeIcon} spacingContext="button_content">
            Dashboard
          </IconText>
          <IconText icon={UserIcon} spacingContext="sidebar_item">
            Users
          </IconText>
          <IconText icon={SettingsIcon} spacingContext="card_content">
            Settings
          </IconText>
        </div>
      </section>

      {/* 4. Button integration */}
      <section>
        <h3 className="text-lg font-semibold mb-4">Button Integration</h3>
        <div className="flex gap-2">
          {/* 
          // Example usage with actual Button component:
          <Button leftIcon={PlusIcon}>Add User</Button>
          <Button size="sm" leftIcon={HomeIcon}>Home</Button>
          <Button variant="outline" leftIcon={SettingsIcon}>Settings</Button>
          <Button size="icon">
            <UserIcon />
          </Button>
          */}
          
          {/* Mock buttons for demonstration */}
          <button className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded">
            <AppIcon icon={PlusIcon} context="button_primary" />
            Add User
          </button>
          <button className="flex items-center gap-2 px-3 py-1.5 bg-gray-200 text-gray-800 rounded text-sm">
            <AppIcon icon={HomeIcon} context="button_secondary" />
            Home
          </button>
        </div>
      </section>

      {/* 5. Spacing examples */}
      <section>
        <h3 className="text-lg font-semibold mb-4">Spacing Context</h3>
        <div className="space-y-4">
          <div className={`p-2 border rounded ${SPACING_CONTEXT.button_content}`}>
            <AppIcon icon={HomeIcon} context="button_secondary" />
            <span>Button Content Spacing (8px)</span>
          </div>
          <div className={`p-3 border rounded ${SPACING_CONTEXT.card_content}`}>
            <AppIcon icon={UserIcon} context="sidebar_expanded" />
            <span>Card Content Spacing (12px)</span>
          </div>
        </div>
      </section>
    </div>
  )
}

/**
 * BEST PRACTICES:
 * 
 * 1. ALWAYS use context-based sizing when possible
 *    - AppIcon icon={icon} context="sidebar_expanded"
 *    - This ensures consistency across the app
 * 
 * 2. Use IconText for icon + text combinations
 *    - IconText icon={icon} spacingContext="button_content"
 *    - Guarantees consistent spacing
 * 
 * 3. NEVER use arbitrary sizes
 *    - ❌ <AppIcon icon={icon} className="w-7 h-7" />
 *    - ✅ <AppIcon icon={icon} context="sidebar_collapsed" />
 * 
 * 4. Follow the size mapping:
 *    - Sidebar: lg (expanded), xl (collapsed)
 *    - Buttons: md (primary), sm (secondary)
 *    - Tables: sm
 *    - Inline text: sm
 *    - Status indicators: xs
 *    - Empty states: xxl
 */
