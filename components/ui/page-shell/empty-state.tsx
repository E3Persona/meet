// lib/page-shell/empty-state.tsx

import { Inbox } from "lucide-react";
import { Button } from "../button";
import { AppIcon } from "../icon";
import { Text } from "../text";

interface EmptyStateProps {
  title?: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  action?: { label: string; onClick: () => void };
  secondaryAction?: { label: string; onClick: () => void };
}

export function EmptyState({
  title = "No data found",
  description = "There's nothing here yet.",
  icon: Icon = Inbox,
  action,
  secondaryAction,
}: EmptyStateProps) {
  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center gap-5 px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
        <AppIcon icon={Icon} size="lg" className="text-muted-foreground" />
      </div>

      <div className="flex flex-col gap-1.5 max-w-sm">
        <Text variant="h3" className="text-base font-semibold text-foreground">
          {title}
        </Text>
        <Text variant="bodyMuted" className="text-sm">
          {description}
        </Text>
      </div>

      {(action || secondaryAction) && (
        <div className="flex items-center gap-3">
          {action && (
            <Button onClick={action.onClick} size="sm">
              {action.label}
            </Button>
          )}
          {secondaryAction && (
            <Button
              onClick={secondaryAction.onClick}
              variant="ghost"
              size="sm"
            >
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}