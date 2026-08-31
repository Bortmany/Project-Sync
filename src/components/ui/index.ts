// One import point for the shared UI kit.

export { Button, Field, Input, DateInput, Textarea, Select, Card, Badge, Spinner } from "@/components/ui/primitives";
export type { ButtonVariant } from "@/components/ui/primitives";
export {
  StatusBadge,
  PriorityFlag,
  DisciplineDot,
  ProgressBar,
  StatTile,
  Avatar,
  CompanyBadge,
  initialsOf,
  statusColor,
  statusLabel,
} from "@/components/ui/indicators";
export { EmptyState } from "@/components/ui/empty-state";
export { Tabs } from "@/components/ui/tabs";
export type { TabItem } from "@/components/ui/tabs";
export { Modal } from "@/components/ui/modal";
export { ToastProvider, useToast } from "@/components/ui/toast";
export { Skeleton, SkeletonRows } from "@/components/ui/skeleton";
export { Breadcrumb } from "@/components/ui/breadcrumb";
export type { Crumb } from "@/components/ui/breadcrumb";
export { ErrorBanner } from "@/components/ui/error-banner";
export { FilterChips, hasActiveFilters } from "@/components/ui/filter-chips";
export type { ActiveFilters, FilterDimension, FilterOption } from "@/components/ui/filter-chips";
