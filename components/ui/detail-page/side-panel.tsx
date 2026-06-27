import { Card, CardContent, CardHeader, CardTitle } from "../card";
import { Separator } from "../separator";
import { SidePanelSection } from "@/types/components";
import { cn } from "@/lib/utils";

interface SidePanelProps {
  sections: SidePanelSection[];
  className?: string;
}

export function SidePanel({ sections, className }: SidePanelProps) {
  return (
    <Card className={cn("h-fit", className)}>
      <CardContent className="p-0">
        {sections.map((section, i) => (
          <div key={section.id}>
            {i > 0 && <Separator />}
            <div className="p-4 space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {section.title}
              </p>
              <div>{section.children}</div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}