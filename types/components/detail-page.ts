import { ReactNode } from "react";

export type BadgeVariant =
  | "success"
  | "warning"
  | "error"
  | "neutral"
  | "info"
  | "outline";

export interface StatusBadge {
  label: string;
  variant?: BadgeVariant;
}

export interface DetailAction {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  variant?: "default" | "outline" | "ghost" | "destructive";
  disabled?: boolean;
}

export interface DetailField {
  label: string;
  value: ReactNode;
  metadata?: string;
  span?: 1 | 2; // grid column span
}

export interface DetailSectionConfig {
  id: string;
  title: string;
  description?: string;
  action?: DetailAction;
  fields?: DetailField[];
  children?: ReactNode;
}

export interface SummaryMetric {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  trend?: {
    value: string;
    direction: "up" | "down" | "neutral";
  };
}

export interface ActivityEvent {
  id: string;
  actor: string;
  actorAvatar?: string;
  action: string;
  detail?: string;
  timestamp: string | Date;
  icon?: ReactNode;
  type?: "message" | "event" | "update" | "note";
}

export interface RelatedItem {
  id: string;
  title: string;
  subtitle?: string;
  meta?: string;
  badge?: StatusBadge;
  onClick?: () => void;
  icon?: ReactNode;
}

export interface DetailUploadedFile {
  id: string;
  name: string;
  size?: number;
  type?: string;
  url?: string;
  status: "uploading" | "success" | "error";
  progress?: number;
  error?: string;
}

export interface SidePanelSection {
  id: string;
  title: string;
  children: ReactNode;
}

export type DetailPageWidth = "sm" | "md" | "lg" | "xl" | "full" | number;

export interface DetailPageConfig {
  /** Page width preset or custom px value */
  width?: DetailPageWidth;
  /** Hide the side panel */
  hideSidePanel?: boolean;
  /** Hide the activity section */
  hideActivity?: boolean;
}