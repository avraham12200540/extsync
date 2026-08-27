"use client";

import { useTranslation } from "@/lib/use-translation";

export interface PaginationControlsProps {
  page: number;
  pageSize: number;
  totalCount: number;
  onPageChange: (page: number) => void;
}

export function PaginationControls({ page, pageSize, totalCount, onPageChange }: PaginationControlsProps) {
  const t = useTranslation();
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  return (
    <div className="flex items-center justify-between border-t border-line pt-3 text-sm text-ink-muted">
      <span>{t("admin.state.pagination", { page, totalPages })}</span>
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="underline decoration-line underline-offset-4 transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:no-underline"
        >
          {t("admin.state.previousPage")}
        </button>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="underline decoration-line underline-offset-4 transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:no-underline"
        >
          {t("admin.state.nextPage")}
        </button>
      </div>
    </div>
  );
}

export interface SortableColumnHeaderProps {
  label: string;
  active: boolean;
  direction: "asc" | "desc";
  onClick: () => void;
}

/** A <th> with a button trigger for column sorting - aria-sort communicates state to assistive tech, the arrow glyph is plain text (never an icon asset), and correctness is never signaled by color alone. */
export function SortableColumnHeader({ label, active, direction, onClick }: SortableColumnHeaderProps) {
  const t = useTranslation();
  return (
    <th scope="col" aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"} className="px-3 py-2 text-start font-medium text-ink-muted">
      <button
        type="button"
        onClick={onClick}
        title={direction === "asc" ? t("admin.state.sortAscending") : t("admin.state.sortDescending")}
        className="inline-flex items-center gap-1 text-start transition-colors hover:text-ink"
      >
        <span>{label}</span>
        {active && <span aria-hidden="true">{direction === "asc" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
}
