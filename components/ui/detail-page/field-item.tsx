import { cn } from "@/lib/utils";
import { DetailField } from "@/types/components";

type FieldItemProps = DetailField & {
  className?: string;
};

export function FieldItem({ label, value, metadata, className }: FieldItemProps) {
  return (
    <div className={cn("space-y-0.5", className)}>
      <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </dt>
      <dd className="text-sm text-foreground">
        {value ?? <span className="text-muted-foreground/60 italic">—</span>}
      </dd>
      {metadata && (
        <span className="text-xs text-muted-foreground/70">{metadata}</span>
      )}
    </div>
  );
}