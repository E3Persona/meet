// components/analytics/metric-cards-grid.tsx

import { MetricCard } from "./metric-card";
import type { MetricCardDef } from "@/types/components";

interface MetricCardsGridProps {
  cards: MetricCardDef[];
  columns?: 2 | 3 | 4 | 5;
}

const COL_CLASSES: Record<number, string> = {
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
  4: "grid-cols-2 lg:grid-cols-4",
  5: "grid-cols-2 md:grid-cols-3 lg:grid-cols-5",
};

export function MetricCardsGrid({ cards, columns = 4 }: MetricCardsGridProps) {
  const colClass = COL_CLASSES[columns] ?? COL_CLASSES[4];

  return (
    <div className={`grid gap-4 ${colClass}`}>
      {cards.map((card) => (
        <MetricCard key={card.id} {...card} />
      ))}
    </div>
  );
}