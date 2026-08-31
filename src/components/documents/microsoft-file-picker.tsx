// Browsing the company's OneDrive and SharePoint from inside the upload dialog.
//
// There is no Microsoft file-picker script anywhere in this app: every list comes from our own
// server, which asks Microsoft on our behalf and checks first that this person could upload to this
// task anyway. That is what keeps the strict Content-Security-Policy untouched — nothing loads from
// another domain, in either direction.

"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { formatDate } from "@/components/format";
import { formatFileSize } from "@/components/documents/file-icon";
import { readRoute } from "@/components/hooks/use-api";
import { Button, EmptyState, ErrorBanner, Input, Spinner } from "@/components/ui";
import {
  MicrosoftDriveDTO,
  MicrosoftItemDTO,
  MicrosoftListingDTO,
  type MicrosoftTargetInput,
} from "@/lib/zod-schemas";

/** A file the person has picked, in the two ids the attach route needs plus its name. */
export type PickedFile = { driveId: string; itemId: string; name: string };

const DriveList = z.array(MicrosoftDriveDTO);

/** The upload target, as query parameters. The server checks it before it lists a single name. */
function targetParams(target: MicrosoftTargetInput): URLSearchParams {
  const params = new URLSearchParams();
  params.set("projectId", target.projectId);
  if (target.mainTaskId) params.set("mainTaskId", target.mainTaskId);
  if (target.disciplineTaskId) params.set("disciplineTaskId", target.disciplineTaskId);
  if (target.documentId) params.set("documentId", target.documentId);
  if (target.requiredDocumentId) params.set("requiredDocumentId", target.requiredDocumentId);
  return params;
}

type Crumb = { id: string | null; name: string };

export function MicrosoftFilePicker({
  target,
  picked,
  onPick,
}: {
  target: MicrosoftTargetInput;
  picked: PickedFile | null;
  onPick: (file: PickedFile | null) => void;
}) {
  const [drive, setDrive] = useState<{ id: string; name: string } | null>(null);
  const [trail, setTrail] = useState<Crumb[]>([]);
  const [term, setTerm] = useState("");
  const [search, setSearch] = useState("");

  const key = targetParams(target).toString();
  const folderId = trail.length > 0 ? trail[trail.length - 1].id : null;

  const drives = useQuery({
    queryKey: ["microsoft-drives", key],
    queryFn: () => readRoute(`/api/integrations/microsoft/drives?${key}`, DriveList),
    enabled: drive === null,
    retry: false,
  });

  const listing = useQuery({
    queryKey: ["microsoft-items", key, drive?.id, folderId, search],
    queryFn: () => {
      const params = targetParams(target);
      params.set("driveId", drive?.id ?? "");
      if (search) {
        params.set("q", search);
        return readRoute(`/api/integrations/microsoft/search?${params}`, MicrosoftListingDTO);
      }
      if (folderId) params.set("itemId", folderId);
      return readRoute(`/api/integrations/microsoft/items?${params}`, MicrosoftListingDTO);
    },
    enabled: drive !== null,
    retry: false,
  });

  function openDrive(next: MicrosoftDriveDTO) {
    setDrive({ id: next.id, name: next.name });
    setTrail([]);
    setTerm("");
    setSearch("");
    onPick(null);
  }

  function openFolder(item: MicrosoftItemDTO) {
    setTrail((current) => [...current, { id: item.id, name: item.name }]);
    setTerm("");
    setSearch("");
    onPick(null);
  }

  function goTo(index: number) {
    setTrail((current) => current.slice(0, index));
    setSearch("");
    setTerm("");
    onPick(null);
  }

  function backToDrives() {
    setDrive(null);
    setTrail([]);
    setTerm("");
    setSearch("");
    onPick(null);
  }

  /* ---------------- the list of drives ---------------- */

  if (drive === null) {
    if (drives.isPending) return <Loading />;
    if (drives.isError) return <ErrorBanner message={messageOf(drives.error)} />;

    const items = drives.data ?? [];
    if (items.length === 0) {
      return (
        <EmptyState
          compact
          message="The connected Microsoft account has no file libraries we can see. Ask your administrator to connect an account with access to the files you need."
        />
      );
    }

    return (
      <ul className="divide-y divide-[var(--border)] rounded-[var(--radius)] border border-[var(--border)]">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => openDrive(item)}
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-[var(--page-bg)]"
            >
              <span className="font-medium text-[var(--brand-ink)]">{item.name}</span>
              <span className="text-xs text-[var(--brand-gray)]">{item.location}</span>
            </button>
          </li>
        ))}
      </ul>
    );
  }

  /* ---------------- inside one drive ---------------- */

  const items = listing.data?.items ?? [];

  return (
    <div className="space-y-3">
      <nav className="flex flex-wrap items-center gap-1 text-xs text-[var(--brand-text)]">
        <button
          type="button"
          onClick={backToDrives}
          className="font-semibold text-[var(--brand-primary)] hover:underline"
        >
          All libraries
        </button>
        <span aria-hidden="true">/</span>
        <button
          type="button"
          onClick={() => goTo(0)}
          className="font-semibold text-[var(--brand-primary)] hover:underline"
        >
          {drive.name}
        </button>
        {trail.map((crumb, index) => (
          <span key={crumb.id ?? index} className="flex items-center gap-1">
            <span aria-hidden="true">/</span>
            <button
              type="button"
              onClick={() => goTo(index + 1)}
              className="font-semibold text-[var(--brand-primary)] hover:underline"
            >
              {crumb.name}
            </button>
          </span>
        ))}
      </nav>

      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(term.trim());
          onPick(null);
        }}
      >
        <Input
          value={term}
          placeholder="Search this library by file name"
          aria-label="Search this library by file name"
          onChange={(event) => setTerm(event.target.value)}
        />
        <Button variant="secondary" type="submit" disabled={term.trim().length < 2}>
          Search
        </Button>
        {search ? (
          <Button
            variant="ghost"
            type="button"
            onClick={() => {
              setSearch("");
              setTerm("");
            }}
          >
            Clear
          </Button>
        ) : null}
      </form>

      {listing.isPending ? <Loading /> : null}
      {listing.isError ? <ErrorBanner message={messageOf(listing.error)} /> : null}

      {!listing.isPending && !listing.isError ? (
        items.length === 0 ? (
          <EmptyState
            compact
            message={search ? "No files match that search." : "This folder is empty."}
          />
        ) : (
          <ul className="max-h-72 divide-y divide-[var(--border)] overflow-y-auto rounded-[var(--radius)] border border-[var(--border)]">
            {items.map((item) => {
              const isPicked = picked?.itemId === item.id;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    disabled={item.tooLarge}
                    onClick={() =>
                      item.isFolder
                        ? openFolder(item)
                        : onPick({ driveId: drive.id, itemId: item.id, name: item.name })
                    }
                    className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:text-[var(--brand-gray)] ${
                      isPicked ? "bg-[var(--brand-accent)]/15" : "hover:bg-[var(--page-bg)]"
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-[var(--brand-ink)]">
                        {item.isFolder ? "📁 " : ""}
                        {item.name}
                      </span>
                      <span className="block text-xs text-[var(--brand-gray)]">
                        {item.tooLarge
                          ? "Larger than the 25 MB limit"
                          : [
                              item.isFolder ? "Folder" : null,
                              item.sizeBytes !== null && !item.isFolder
                                ? formatFileSize(item.sizeBytes)
                                : null,
                              item.lastModifiedAt ? formatDate(item.lastModifiedAt) : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                      </span>
                    </span>
                    {isPicked ? (
                      <span className="text-xs font-semibold text-[var(--brand-primary)]">Chosen</span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )
      ) : null}

      {listing.data?.truncated ? (
        <p className="text-xs text-[var(--brand-gray)]">
          Only the first 100 items are shown. Use the search box to find the rest.
        </p>
      ) : null}
    </div>
  );
}

function Loading() {
  return (
    <div className="flex justify-center py-6 text-[var(--brand-gray)]">
      <Spinner />
    </div>
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "We could not reach Microsoft 365 just now.";
}
