"use client";

import { Pencil } from "lucide-react";
import type { ClientProfileEdit } from "./use-client-profile-edit";

/**
 * The Client rail's edit action.
 *
 * This file used to carry the inline-edit primitives too — a light input, a
 * light select and dark variants of both, because the fields lived inside the
 * Overview's two cards and one of those cards sits on #0f2027. Editing moved
 * into the details sheet, which is a normal white surface, so those four are
 * gone: the sheet uses the `ui/` primitives directly, which is what the design
 * system asks for anyway.
 *
 * Save and discard went with them. They belong to the sheet's footer now, and
 * with them the start-edit confirm — which mounts beside the commit rather
 * than in a host, so no future host can mount the form and forget the guard.
 */
export function EditRailActions({ edit }: { edit: ClientProfileEdit }) {
  return (
    <button
      type="button"
      onClick={edit.start}
      aria-label="Edit client details"
      title="Edit client details"
      className="shrink-0 rounded p-1 text-[#93b0b4] transition-colors hover:text-[#0d9488]"
    >
      <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
    </button>
  );
}
