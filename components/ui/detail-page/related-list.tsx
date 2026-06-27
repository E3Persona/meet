import { Badge } from "../badge";
import { RelatedItem } from "@/types/components";
import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";

interface RelatedListProps {
  items: RelatedItem[];
  emptyMessage?: string;
  className?: string;
}

export function RelatedList({
  items,
  emptyMessage = "No related items.",
  className,
}: RelatedListProps) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className={cn("divide-y divide-border/50", className)}>
      {items.map((item) => (
        <div
          key={item.id}
          className={cn(
            "flex items-center gap-3 py-2.5 px-1",
            item.onClick &&
              "cursor-pointer hover:bg-muted/50 rounded-md px-2 transition-colors"
          )}
          onClick={item.onClick}
          role={item.onClick ? "button" : undefined}
          tabIndex={item.onClick ? 0 : undefined}
        >
          {item.icon && (
            <span className="shrink-0 text-muted-foreground">{item.icon}</span>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground truncate">
              {item.title}
            </p>
            {item.subtitle && (
              <p className="text-xs text-muted-foreground truncate">
                {item.subtitle}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {item.meta && (
              <span className="text-xs text-muted-foreground">{item.meta}</span>
            )}
            {item.badge && (
              <Badge variant={item.badge.variant ?? "neutral"} className="text-xs">
                {item.badge.label}
              </Badge>
            )}
            {item.onClick && (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}